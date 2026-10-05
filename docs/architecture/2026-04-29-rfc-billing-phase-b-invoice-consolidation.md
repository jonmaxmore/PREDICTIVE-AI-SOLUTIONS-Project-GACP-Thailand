> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# RFC — Billing Phase B: dual-invoice → single-invoice with line items

**Status:** Foundation (design + draft migration); execution gated on
operator window confirmation (decision จ).
**Author:** Project team (2026-04-29)
**Reviewer:** project owner
**Depends on:** Phase A canonicalization (already shipped, PR #19/#23)
**Blocks:** future fee-customisation per organization, refund flow

---

## 1. Why this RFC exists

The 2026-04-28 billing-flow audit (`docs/architecture/2026-04-28-billing-flow-review.md`)
found that today the system creates **two separate `invoices` rows per
phase**: one for the state fee (5,000 baht) and one for the platform
fee + VAT (535 baht). The user described this as **"หลอนๆ"** —
hallucinatory — because:

- A single payment event creates two invoices that the user must
  reconcile mentally.
- The accounting team gets two ledger entries for what is
  conceptually one transaction.
- Refund flow has to handle pair-wise refunds (refund both or
  neither — never just one).
- Tax-invoice issuance has to bundle them again.

Phase A (canonicalization) fixed the *math* drift (PR #19 / #23). Phase
B fixes the *shape* — collapse the dual-invoice pattern into one
invoice with three line items: state fee, platform fee, VAT.

## 2. Target shape

```
Invoice (one row per phase)
├── id
├── invoiceNumber           ← single number, e.g. "INV-2569-04-29-0001"
├── totalAmount             ← grand total in THB (e.g. 5,535)
├── status                  ← PENDING / PAID / VOID / REFUNDED
└── lineItems[] (relation to new InvoiceLineItem table)
    ├── { code: 'STATE_FEE',    name: 'ค่าธรรมเนียมรัฐ',  amountThb: 5000 }
    ├── { code: 'PLATFORM_FEE', name: 'ค่าบริการแพลตฟอร์ม', amountThb:  500 }
    └── { code: 'VAT_7',        name: 'ภาษีมูลค่าเพิ่ม 7%',  amountThb:   35 }
```

The 3-line breakdown matches the user-visible invoice template
(privacy/terms pages already render line items the same way).

## 3. Migration plan (one-shot, low-load window)

### 3.1. Schema additions (Prisma)

```prisma
model InvoiceLineItem {
  id             String   @id @default(cuid())
  invoiceId      String
  code           String   // STATE_FEE / PLATFORM_FEE / VAT_7 / DISCOUNT / etc
  name           String   // human-readable Thai
  amountThb      Int      // baht (NOT satang — invoices are denominated in baht)
  sortOrder      Int      @default(0)
  organizationId String
  createdAt      DateTime @default(now())

  invoice        Invoice      @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)

  @@index([invoiceId, sortOrder])
  @@index([organizationId])
  @@map("invoice_line_items")
}

model Invoice {
  // ... existing fields ...
  lineItems      InvoiceLineItem[]
}
```

### 3.2. Backfill SQL

For every existing invoice row, derive the 3 line items from the
known constants + the row's totalAmount:

```sql
-- Phase 1 invoice (totalAmount = 5535 baht):
INSERT INTO invoice_line_items (id, "invoiceId", code, name, "amountThb", "sortOrder", "organizationId", "createdAt")
SELECT gen_random_uuid()::text, i.id, 'STATE_FEE', 'ค่าธรรมเนียมรัฐ', 5000, 0, i."organizationId", NOW()
FROM invoices i WHERE i."totalAmount" = 5535;

INSERT INTO invoice_line_items (...) ... 'PLATFORM_FEE', 'ค่าบริการแพลตฟอร์ม', 500, 1 ...;
INSERT INTO invoice_line_items (...) ... 'VAT_7', 'ภาษีมูลค่าเพิ่ม 7%', 35, 2 ...;

-- Phase 2 invoice (totalAmount = 27675 baht):
-- 25,000 + 2,500 + 175
... STATE_FEE 25000 ... PLATFORM_FEE 2500 ... VAT_7 175 ...
```

The backfill MUST run in a single transaction with the schema add to
keep paid-invoice reporting consistent during the migration.

### 3.3. Application changes

- `services/billing/invoice-issuer.js` — emit 3 line items on issuance
  instead of relying on the totalAmount-only pattern.
- `apps/backend/services/pdf/invoice-template-service.js` — render
  `lineItems` array instead of hard-coded 3 rows.
- `apps/backend/services/pdf/tax-invoice-service.js` — same.
- `apps/web-app` payment page — read `invoice.lineItems` instead of
  computing the breakdown client-side.

### 3.4. Removal — defer until N+1 release

The DUAL invoice pattern (two separate `invoices` rows per phase)
gets cleaned up in a follow-up migration ONLY after the application
has been writing single-invoice form for a full deploy cycle. We
keep the old rows; the cleanup is "delete platform-only-row invoices
that are now redundant".

## 4. Risk + window

**Why a window is needed:**
- Backfill writes ~3 rows per existing invoice. With ~10K invoices in
  prod (estimated), that's ~30K INSERTs. Postgres handles that easily
  in a single transaction (sub-minute) but during the migration the
  invoices table is locked.
- Application code that reads `invoice.lineItems` MUST be deployed
  AFTER the schema add, in the same maintenance window — otherwise
  the new code reads against the old schema (missing relation).

**Recommended window:** Same Sunday 02:00-04:00 ICT window used for
RLS rollout (Phase E.1). One window covers both because they touch
disjoint tables.

**Rollback:** drop the InvoiceLineItem table. The application keeps
working on the old totalAmount-only path because the dual-invoice
rows never disappeared.

## 5. Status of THIS commit

This commit is **foundation only**:
- ✅ RFC committed (this file)
- ✅ Draft Prisma migration written but **NOT yet placed in
  `prisma/migrations/`** — we wait for the operator window
  confirmation before adding it to the migration history
- ❌ Backfill SQL — outlined but not written end-to-end
- ❌ Application code change — out of scope for this commit
- ❌ Production execution — gated on operator decision จ + window

What lands NOW: this RFC + the link from the 2026-04-28 billing-flow
audit. Operator can read + comment + schedule.

## 6. Acceptance criteria (when fully shipped)

- All new invoices have ≥3 line items in `invoice_line_items`.
- All historical invoices (post-backfill) have 3 line items each.
- The PDF templates render line items by relation, not by hard-coded
  totalAmount slicing.
- The frontend payment page reads `invoice.lineItems` for breakdown
  display.
- The dual-invoice pattern has been deprecated for ≥1 release cycle.
- Removal migration drops platform-only-row invoices (separate PR
  after observation period).

## 7. Open questions for operator

1. **Window confirmation** — Sun 02:00-04:00 ICT alongside RLS
   Phase E.1, or different?
2. **Tax-invoice numbering** — should the consolidated invoice
   number replace the current pair-of-numbers pattern, or do we
   keep two numbers and just add line items to the state-fee
   invoice? (Recommended: one number per phase.)
3. **Refund flow** — out of scope for this PR but planning question:
   refund per line-item or per invoice? (Recommended: per invoice;
   line-item-level refunds are a Phase C feature.)
