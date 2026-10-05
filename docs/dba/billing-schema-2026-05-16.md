> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Billing Schema Changes — 2026-05-16 (Batch B16-A)

**Author**: DBA / database engineer
**Owner sign-off**: 2026-05-16 (separated DTAM-side / PLATFORM-side billing flow)
**Migration**: `20260516010000_add_journal_quotation_receipt_seq_bank_accounts`
**Predecessor**: `20260516000000_add_journal_entries_receipt_sequence` (B16-original)

## 1. Business context

The owner confirmed on 2026-05-16 that the applicant must pay **two separate
bank transfers per phase**:

| Side       | Destination                                | Document stream                                          |
|------------|--------------------------------------------|----------------------------------------------------------|
| DTAM       | กรมบัญชีกลาง (Treasury) — รายได้แผ่นดิน  | `QT-DTAM-…` / `INV-DTAM-…` / `RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑` |
| PLATFORM   | บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด       | `QT-PRD-…`  / `INV-PRD-…`  / `TAX-PRD-2026-000001`       |

Each side issues its own quotation → invoice → receipt chain. The schema
extensions in this migration give the application layer a clean place to
record the two streams without conflating them.

## 2. Models added / changed

### 2.1 `JournalLine` (extended — additive column)

- **New column**: `taxableAmount  Decimal(15,2)?  NULL`
- **Purpose**: per-line VAT base under Revenue Code §79. ภ.พ.30 (monthly VAT
  remittance) filters this column instead of re-parsing `accountCode`.
- **Backwards compat**: legacy rows leave the column NULL; readers must
  treat NULL as "not VAT-bearing".

### 2.2 `ReceiptSequence` (extended — additive columns + second unique index)

Previous shape (B16-original):
```
(prefix String, year Int, counter Int, lastAllocatedAt, updatedAt)
@@unique([prefix, year])
```

New shape (B16-A — strictly additive):
```
+ issuerType    String?   // 'DTAM' | 'PLATFORM'
+ documentType  String?   // 'QUOTATION' | 'INVOICE' | 'GOVERNMENT_REVENUE_RECEIPT' | 'FULL_TAX_INVOICE'
+ yearBE        Int?      // 2568, 2569 (Buddhist Era); 0 if irrelevant
+ yearAD        Int?      // 2025, 2026 (Anno Domini); 0 if irrelevant
+ nextNumber    Int       @default(1)
+ @@unique([issuerType, documentType, yearBE, yearAD])
+ @@index([issuerType, documentType])
```

Legacy columns (`prefix`, `year`) become **NULLABLE** so existing rows stay
valid AND new rows written by `receipt-sequence-service.js` can leave them
NULL. The two unique indexes coexist because PostgreSQL treats multiple
NULLs as distinct.

### 2.3 `Quotation` (new model)

The two-issuer flow needs a clean break from the legacy `Quote` model
(batch 11). See §3 below for the Quote-vs-Quotation decision.

| Field            | Type            | Notes                                          |
|------------------|-----------------|------------------------------------------------|
| `id`             | UUID PK         |                                                |
| `applicationId`  | TEXT FK         | CASCADE on application delete                  |
| `issuerType`     | TEXT NOT NULL   | 'DTAM' \| 'PLATFORM'                          |
| `quotationNumber`| TEXT UNIQUE     | Allocated via receipt-sequence-service        |
| `subtotal`       | Decimal(15,2)   | Exact decimal math per TFRS for NPAEs         |
| `vat`            | Decimal(15,2)   | Default 0 (DTAM side has no VAT)              |
| `totalAmount`    | Decimal(15,2)   |                                                |
| `installments`   | JSONB           | `[{ "phase":"PHASE_1","amount":5000 }, …]`    |
| `status`         | TEXT            | DRAFT / SENT / ACCEPTED / REJECTED / EXPIRED / INVOICED |
| `validUntil`     | TIMESTAMP       | Quote expiry                                   |
| `acceptedAt`     | TIMESTAMP       |                                                |
| `rejectedAt`     | TIMESTAMP       |                                                |
| `notes`          | TEXT            | Provider note                                  |
| `applicantNotes` | TEXT            | Applicant rejection note                       |
| `createdBy`      | TEXT            |                                                |
| `updatedBy`      | TEXT            |                                                |
| `isDeleted`      | BOOLEAN         | Soft delete                                    |
| `deletedAt`      | TIMESTAMP       |                                                |
| `deletedBy`      | TEXT            |                                                |
| `deleteReason`   | TEXT            |                                                |
| `organizationId` | TEXT FK         | Tenancy (ADR-014); RESTRICT on org delete     |
| `createdAt`      | TIMESTAMP       |                                                |
| `updatedAt`      | TIMESTAMP       |                                                |

Indexes:
- `(applicationId, issuerType)` — fast lookup of both sides per application
- `(status)`
- `(organizationId)`
- `(isDeleted)`
- `quotationNumber` UNIQUE

Compliance basis: Revenue Code §86, §86/4 (trace from quote → tax invoice);
TFRS for NPAEs ch.18 (revenue NOT recognised at quote time).

### 2.4 `IssuerBankAccount` (new model)

Distinct from the existing org-scoped `BankAccount` table.
`IssuerBankAccount` is GLOBAL — one canonical row per issuer side.

| Field        | Type           | Notes                                              |
|--------------|----------------|----------------------------------------------------|
| `id`         | UUID PK        |                                                    |
| `issuerType` | TEXT UNIQUE    | 'DTAM' \| 'PLATFORM' — only one canonical per side |
| `bankName`   | TEXT NOT NULL  | 'กรุงไทย' / 'ไทยพาณิชย์' (Thai display name)     |
| `bankCode`   | TEXT NULL      | SWIFT / local code (optional)                      |
| `accountNo`  | TEXT NOT NULL  | Bank account number                                |
| `accountName`| TEXT NOT NULL  | Legal name on the account                          |
| `promptpayId`| TEXT NULL      | Tax ID or phone for QR (PLATFORM side)             |
| `isActive`   | BOOLEAN        | Default true                                       |
| `notes`      | TEXT NULL      |                                                    |
| `createdAt`  | TIMESTAMP      |                                                    |
| `updatedAt`  | TIMESTAMP      |                                                    |

Compliance basis: กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน (state revenue
to Treasury), Revenue Code §82 (single canonical VAT-receipt account).

## 3. Quote vs Quotation decision

Per task spec: "If existing Quote can be extended without breaking batch-11
consumers, ADD those columns; otherwise create a new Quotation model."

**Decision: ADD a new `Quotation` model. Keep `Quote` untouched.**

Reasoning:
1. **Numbering conflict** — `Quote.quoteNumber` is single-stream
   (`QT-20260516-0001` via `quote-service.generateQuoteNumber`). The new
   two-issuer flow needs separate DTAM and PLATFORM number buckets
   allocated through `receipt-sequence-service`. Re-using the legacy
   serial would either collide or require dual-write logic in batch-11
   code (the spec forbids modifying `quote-service.js`).
2. **Decimal precision** — `Quote.subtotal / vat / totalAmount` are `Float`.
   The new accounting work requires `Decimal(15,2)` under TFRS for NPAEs.
   Mixing Float and Decimal in the same model would create silent rounding
   drift between old and new code paths.
3. **Risk of widening blast radius** — extending `Quote` with `issuerType`
   would force every batch-11 consumer (`routes/api/finance/quotes.js`,
   `routes/api/helpers/quotes-provider-routes.js`) to either default
   `issuerType` or fail. The spec explicitly excludes modifying batch-11
   route logic.

Migration impact: legacy `Quote` rows stay readable / writable; new code
writes to `Quotation`. No data migration is performed in this migration
— B16-D will plan the cutover separately.

## 4. ER diagram

```
                     ┌────────────────────────────┐
                     │       Application          │
                     │ (applications)             │
                     └──────────────┬─────────────┘
                                    │ 1
                          ┌─────────┴────────┬─────────────────┐
                          │ N                │ N               │ N
                          ▼                  ▼                 ▼
                  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐
                  │ Quote (legacy) │  │ Quotation*   │  │  Invoice    │
                  │ (quotes)       │  │ (quotations) │  │ (invoices)  │
                  │ batch 11       │  │ * NEW B16-A  │  │             │
                  └────────────────┘  └──────────────┘  └─────┬───────┘
                                                              │ 1
                                                              ▼ N
                                                       ┌──────────────┐
                                                       │ JournalEntry │
                                                       │(journal_     │
                                                       │ entries)     │
                                                       └──────┬───────┘
                                                              │ 1
                                                              ▼ N
                                                       ┌──────────────┐
                                                       │ JournalLine  │
                                                       │(journal_     │
                                                       │ lines)       │
                                                       │ +taxableAmt* │
                                                       └──────────────┘

                  ┌─────────────────────────┐   ┌──────────────────────────┐
                  │ ReceiptSequence         │   │ IssuerBankAccount*       │
                  │ (receipt_sequences)     │   │ (issuer_bank_accounts)   │
                  │ + issuerType,           │   │ * NEW B16-A              │
                  │ + documentType,         │   │ One canonical row per    │
                  │ + yearBE, yearAD,       │   │ issuerType (UNIQUE).     │
                  │ + nextNumber*           │   │                          │
                  │ * NEW B16-A             │   │                          │
                  └─────────────────────────┘   └──────────────────────────┘

  ─── No FK between ReceiptSequence and other tables — it's a global allocator.
  ─── IssuerBankAccount has no org FK — platform-wide canonical row.
```

## 5. Concurrency notes

### 5.1 `ReceiptSequence` (atomic number allocation)

The allocator (`services/receipt-sequence-service.js::allocateReceiptNumber`)
runs inside `prisma.$transaction(..., { isolationLevel: 'Serializable' })`.

Pattern:
1. `findUnique({ where: { issuerType_documentType_yearBE_yearAD: { … } } })`
2. If row exists: capture `nextNumber`, then `update({ data: { nextNumber: { increment: 1 } } })`
3. If row absent: `upsert({ create: { …, nextNumber: 2 }, update: { increment: 1 } })`
   — the caller gets `1` for first allocation; the row stores `2` (next mint).

Why SERIALIZABLE is required: under READ COMMITTED, two transactions could
read the same `nextNumber` and both increment it, producing duplicate
allocations. SERIALIZABLE forces PG to serialise the conflict; one of the
two transactions retries.

Alternative considered: `SELECT … FOR UPDATE` row-lock. Equivalent
correctness, more verbose, and Prisma doesn't expose it without raw SQL —
SERIALIZABLE is cleaner and the table is tiny (one row per bucket), so
contention is minimal.

### 5.2 `Quotation` (uniqueness across number streams)

`quotationNumber` is UNIQUE across the table. Because numbers are minted
by the SERIALIZABLE allocator above, collisions are impossible at the
allocator level. The UNIQUE constraint is a belt-and-braces defence.

### 5.3 `IssuerBankAccount` (single canonical row)

`issuerType` is UNIQUE — only one DTAM row and one PLATFORM row can exist.
Updates go via `upsert({ where: { issuerType }, … })`. The application
layer must capture audit history when these change (recommended: write a
row to `audit_logs` with the old → new diff).

## 6. Seed data

Six `ReceiptSequence` buckets:

| issuerType | documentType                  | yearBE | yearAD | nextNumber |
|------------|-------------------------------|--------|--------|------------|
| DTAM       | QUOTATION                     | 2568   | 0      | 1          |
| DTAM       | INVOICE                       | 2568   | 0      | 1          |
| DTAM       | GOVERNMENT_REVENUE_RECEIPT    | 2568   | 0      | 1          |
| PLATFORM   | QUOTATION                     | 0      | 2025   | 1          |
| PLATFORM   | INVOICE                       | 0      | 2025   | 1          |
| PLATFORM   | FULL_TAX_INVOICE              | 0      | 2025   | 1          |

(seed file uses `currentBE` / `currentCE` so the actual values are 2569 /
2026 when run in BE 2569 — the spec values match the calendar year that
finance considers "active".)

Two `IssuerBankAccount` rows:

| issuerType | bankName    | accountNo                       | accountName                                                 | promptpayId      |
|------------|-------------|---------------------------------|-------------------------------------------------------------|------------------|
| DTAM       | กรุงไทย    | `PENDING_FINANCE_CONFIRMATION`  | `กรมบัญชีกลาง — รายได้แผ่นดิน (DTAM)`                       | (null)           |
| PLATFORM   | ไทยพาณิชย์  | `PENDING_FINANCE_CONFIRMATION`  | `บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด`                       | `0105568045932`  |

Seed file: `apps/backend/prisma/seed-receipt-sequences.js`.

## 7. Rollback plan

Every change is reversible. Rollback SQL (executed in reverse dependency
order):

```sql
-- 4) Drop the new bank-account table (no FKs depend on it).
DROP TABLE IF EXISTS "issuer_bank_accounts";

-- 3) Drop the new quotations table.
DROP TABLE IF EXISTS "quotations";

-- 2) Reverse the receipt_sequences extension.
DROP INDEX IF EXISTS "receipt_sequences_issuer_doc_be_ad_key";
DROP INDEX IF EXISTS "receipt_sequences_issuerType_documentType_idx";
ALTER TABLE "receipt_sequences" DROP COLUMN IF EXISTS "issuerType";
ALTER TABLE "receipt_sequences" DROP COLUMN IF EXISTS "documentType";
ALTER TABLE "receipt_sequences" DROP COLUMN IF EXISTS "yearBE";
ALTER TABLE "receipt_sequences" DROP COLUMN IF EXISTS "yearAD";
ALTER TABLE "receipt_sequences" DROP COLUMN IF EXISTS "nextNumber";
-- Restore NOT NULL on legacy columns IF AND ONLY IF no row was inserted
-- after the migration that left prefix/year NULL. Run:
--    SELECT COUNT(*) FROM receipt_sequences WHERE prefix IS NULL OR year IS NULL;
-- and only re-enforce NOT NULL when the count is zero.
ALTER TABLE "receipt_sequences" ALTER COLUMN "prefix" SET NOT NULL;
ALTER TABLE "receipt_sequences" ALTER COLUMN "year"   SET NOT NULL;

-- 1) Reverse the journal_lines extension.
ALTER TABLE "journal_lines" DROP COLUMN IF EXISTS "taxableAmount";
```

**Rollback test on staging**:
1. Apply the migration on a snapshot of production.
2. Run the 6 seed inserts.
3. Apply the rollback SQL above.
4. Run `npx prisma validate` against the rolled-back schema (after
   reverting `prisma/schema/billing.prisma` to the B16-original state) —
   should pass.

## 8. Risks when applying on live DB

| Risk                                                            | Mitigation                                                                              |
|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `ALTER TABLE … DROP NOT NULL` takes ACCESS EXCLUSIVE briefly    | `receipt_sequences` is tiny (~10 rows); lock is held <10 ms on PG14+. Safe.            |
| `ALTER TABLE … ADD COLUMN` rewrites the table                   | Only if the new column has a non-constant DEFAULT. We use `DEFAULT 1` (constant); PG11+ uses fast-path metadata-only ADD. Verified safe. |
| New `quotations` table is empty — no concurrent-access concern  | FK on `applicationId` is CASCADE; ensure no orphan inserts before applications exist.   |
| `IssuerBankAccount` placeholders may render on applicant UI    | The `notes` column flags `PENDING_FINANCE_CONFIRMATION`; the applicant UI should hide the row until finance confirms (B16-B's territory). |
| Two unique indexes on `receipt_sequences`                       | PG handles multi-NULL distinctness correctly; verified by `prisma validate`.            |
| Rollback would lose any data written to new columns / tables    | Document in change-management ticket. Only rollback within 24 h of apply.              |

## 9. Files touched

- `apps/backend/prisma/schema/billing.prisma` — JournalLine + ReceiptSequence + Quotation + IssuerBankAccount
- `apps/backend/prisma/schema/application.prisma` — Quotation back-relation
- `apps/backend/prisma/schema/tenancy.prisma` — Organization → Quotation back-relation
- `apps/backend/prisma/migrations/20260516010000_add_journal_quotation_receipt_seq_bank_accounts/migration.sql` — new
- `apps/backend/prisma/seed-receipt-sequences.js` — extended (6 ReceiptSequence + 2 IssuerBankAccount)
- `apps/backend/services/journal-entry-service.js` — header comment ONLY (no logic touched)
- `docs/dba/billing-schema-2026-05-16.md` — this file
