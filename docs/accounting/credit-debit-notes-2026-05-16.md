> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Credit Note (ใบลดหนี้) + Debit Note (ใบเพิ่มหนี้)

**Batch:** B20-A · **Date:** 2026-05-16 · **Status:** scaffolding shipped

## Legal basis

| Document            | Section                | Direction          | Reports to ภ.พ.30      |
| ------------------- | ---------------------- | ------------------ | ---------------------- |
| ใบลดหนี้ (Credit Note) | ป.รัษฎากร **ม.86/10** | Reduce taxable + VAT | SUBTRACT from Output VAT |
| ใบเพิ่มหนี้ (Debit Note) | ป.รัษฎากร **ม.86/9**  | Increase taxable + VAT | ADD to Output VAT      |

Other anchors:
- ป.รัษฎากร ม.86/4 — sequential numbering + cross-reference to original
- ป.รัษฎากร ม.87/3 — 7-year retention applies to CN/DN evidence
- TFRS for NPAEs ch.18 (รายได้) — revenue corrections recognised at the
  period in which the CN/DN is POSTED, not the original invoice period.
- TAS 1 (Presentation of Financial Statements) — chronological audit
  trail with traceable references to source documents.

## Scope: PLATFORM only

CN/DN are issued by **Predictive AI Solution Co., Ltd.** (PLATFORM) only.
DTAM (state-fee) invoices are corrected via the **กรมบัญชีกลาง refund
process**, NOT via CN/DN on the platform's books — the platform never
holds state-fee cash (two-money-flow model, batch B16-C). The service
layer enforces this with `assertInvoiceEligible` rejecting any invoice
whose `serviceType` maps to ISSUER.DTAM.

## Flow diagram

```
                ┌───────────────────────────────────┐
                │  Original ใบกำกับภาษีเต็มรูป      │
                │  (TAX-PRD-{yearAD}-{seq6})        │
                │  status = paid                    │
                └───────────────┬───────────────────┘
                                │
       ┌────────────────────────┴────────────────────────┐
       │                                                 │
       ▼ ม.86/10 (downward)                              ▼ ม.86/9 (upward)
  ┌─────────────┐                                  ┌──────────────┐
  │ ใบลดหนี้    │                                  │ ใบเพิ่มหนี้  │
  │ CN-PRD-...  │                                  │ DN-PRD-...   │
  └──────┬──────┘                                  └──────┬───────┘
         │                                                │
   DRAFT ─ issue ─▶ ISSUED ─ post ─▶ POSTED         (same state machine)
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │ JournalEntry — REVERSING (CN) │
                       │   Dr Revenue                  │
                       │   Dr Output VAT               │
                       │     Cr Cash / Refund Payable  │
                       │                               │
                       │ JournalEntry — ADDITIONAL (DN)│
                       │   Dr Cash / Receivable        │
                       │     Cr Revenue                │
                       │     Cr Output VAT             │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ภ.พ.30 monthly Output-VAT report
                         - CN VAT → subtract
                         - DN VAT → add
```

## State machine

```
       DRAFT ──issue──▶ ISSUED ──post──▶ POSTED  (terminal)
         │                 │
         └─cancel─▶ CANCELLED ◀─cancel──┘
```

POSTED is **terminal** — any further correction must be issued as a NEW
CN or DN (standard accounting practice: never edit a posted entry,
always reverse).

## Numbering scheme

| Document      | Format                       | Example               |
| ------------- | ---------------------------- | --------------------- |
| Credit Note   | `CN-PRD-{yearAD}-{seq6}`     | `CN-PRD-2026-000001`  |
| Debit Note    | `DN-PRD-{yearAD}-{seq6}`     | `DN-PRD-2026-000001`  |

Allocated through `services/receipt-numbering-service.js` with the new
issuer constants `ISSUER.CREDIT_NOTE_PLATFORM` and
`ISSUER.DEBIT_NOTE_PLATFORM`. Counters reset annually (calendar year);
the underlying `ReceiptSequence` row is serialised via the same
`SERIALIZABLE` $transaction the existing platform-receipt allocator
uses.

## Reason codes

### Credit Note (ม.86/10) — reduction

| Code              | Thai label                  | When to use                              |
| ----------------- | --------------------------- | ---------------------------------------- |
| `CANCELLATION`    | ยกเลิกบริการ                | Buyer cancels service after invoice paid |
| `PRICE_REDUCTION` | ลดราคาตามข้อตกลง            | Agreed discount post-invoice             |
| `CORRECTION`      | แก้ไขข้อผิดพลาด (ลดยอด)     | Over-billing / arithmetic error          |
| `RETURN`          | คืนบางส่วน                  | Partial return of supplied service       |

### Debit Note (ม.86/9) — addition

| Code                | Thai label                | When to use                              |
| ------------------- | ------------------------- | ---------------------------------------- |
| `ADDITIONAL_CHARGE` | ค่าบริการเพิ่ม            | Extra scope of work billed after the fact |
| `CORRECTION`        | แก้ไขข้อผิดพลาด (เพิ่มยอด) | Under-billing / arithmetic error         |
| `LATE_FEE`          | ค่าปรับล่าช้า             | Penalty per the service agreement        |

## Journal-entry shapes

### Credit Note (REVERSING entry)

```
  Dr. Revenue — Platform Fee     (4110-001)   <subtotal>
  Dr. Output VAT 7%              (2131-001)   <vat>
    Cr. Cash / Bank              (1110-001)         <total>
```

### Debit Note (ADDITIONAL entry)

```
  Dr. Cash / Bank                (1110-001)   <total>
    Cr. Revenue — Platform Fee   (4110-001)         <subtotal>
    Cr. Output VAT 7%            (2131-001)         <vat>
```

Both posted via `journal-entry-service.js` once
`recordCreditNoteEntry` / `recordDebitNoteEntry` are wired by the next
batch (B20-B journal owner). Until then, the credit/debit-note services
log a structured `[credit-note][journal-fallback]` /
`[debit-note][journal-fallback]` marker carrying the full line shape so
finance can reconcile manually.

## VAT report integration

`vat-report-service.generateOutputVatReport` was extended to:

1. Query existing OUTPUT_VAT JournalLine rows (unchanged).
2. **Scan `credit_notes` for POSTED rows in the month** → SUBTRACT.
3. **Scan `debit_notes` for POSTED rows in the month** → ADD.

The report's `totals` now exposes:

- `taxableAmount` — adjusted (post-CN/DN)
- `vatAmount` — adjusted (post-CN/DN)
- `outputVatBeforeAdjustments` — pre-adjustment view
- `outputVatAdjustments` — net delta
- `adjustments.creditNotes[]`, `adjustments.debitNotes[]` — row-level
  detail for the finance officer.

After the journal wire-in (B20-B) lands, the JournalLine path will
cover the CN/DN VAT lines natively and the side-channel scan can be
gated by `journalEntryId IS NULL` for idempotency.

## File inventory

| Path                                                                        | Purpose                                     |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/backend/prisma/schema/billing.prisma`                                | CreditNote + DebitNote models + back-rels   |
| `apps/backend/prisma/migrations/20260516030000_add_credit_debit_notes/`     | DDL (additive only)                         |
| `apps/backend/services/credit-note-service.js`                             | CN business logic                           |
| `apps/backend/services/debit-note-service.js`                              | DN business logic                           |
| `apps/backend/services/receipt-numbering-service.js`                       | Extended with CREDIT_NOTE_PLATFORM / DEBIT_NOTE_PLATFORM |
| `apps/backend/services/vat-report-service.js`                              | CN/DN adjustment block in ภ.พ.30 report     |
| `apps/backend/services/pdf/templates/credit-note.html`                     | ใบลดหนี้ PDF template                       |
| `apps/backend/services/pdf/templates/debit-note.html`                      | ใบเพิ่มหนี้ PDF template                    |
| `apps/backend/routes/api/finance/credit-notes.js`                          | HTTP routes                                 |
| `apps/backend/routes/api/finance/debit-notes.js`                           | HTTP routes                                 |
| `apps/backend/routes/api/index.js`                                         | Mounted at /api/finance/credit-notes,/debit-notes |
| `apps/backend/__tests__/unit/credit-note-service.test.js`                  | 14 service tests                            |
| `apps/backend/__tests__/unit/debit-note-service.test.js`                   | 11 service tests                            |
| `apps/backend/__tests__/unit/credit-note-pdf-template.test.js`             | 14 template tests                           |

## Open wire-ins for next batch

1. **B20-B journal owner**: add `recordCreditNoteEntry` /
   `recordDebitNoteEntry` to `services/journal-entry-service.js`. Shape
   already documented above; the credit-note-service.postCreditNote
   call signature mirrors `recordPaymentEntry` so the wire-in is
   mechanical.
2. **PDF rendering**: add `generateCreditNotePdf` /
   `generateDebitNotePdf` to `services/pdf/invoice-template-service.js`.
   The HTML templates are already in place; the GET `/api/finance/credit-notes/:id/pdf`
   endpoint will switch from a 501 response to a real PDF buffer the
   moment those functions exist.
