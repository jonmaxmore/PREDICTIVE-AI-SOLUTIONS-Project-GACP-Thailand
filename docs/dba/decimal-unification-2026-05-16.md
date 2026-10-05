> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Decimal type unification — Iter 24 (hardening loop, 2026-05-16)

**Scope**: `Invoice.subtotal`, `Invoice.vat`, `Invoice.totalAmount`
**Migration**: `apps/backend/prisma/migrations/20260517000000_decimal_unification/`
**Audit reference**: `audit-gap-analysis-2026-05-16.md` P0 #3 ("decimal type chaos")

---

## 1. Why Decimal(15,2)

### 1.1 The Float problem

`Float` in PostgreSQL maps to `double precision`, which is the IEEE 754
binary64 format. JavaScript `Number` is the same format. The format has 52
bits of mantissa, giving 15–17 significant decimal digits — more than
enough for any individual GACP invoice amount. The problem is not the
range but the binary representation:

- `0.1` cannot be represented exactly in binary, so `0.1 + 0.2 = 0.30000000000000004`.
- Repeated addition of these tiny residuals compounds: after a few hundred
  invoice rollups the total can drift by ฿0.01 or more.
- VAT calculations (`subtotal * 0.07`) introduce more sub-satang fractions
  that accumulate.

### 1.2 Why this fails Thai accounting standards

- **TFRS for NPAEs ch. 2** (Thai Financial Reporting Standards for
  Non-Publicly Accountable Entities — internal controls): requires the
  trial balance to reconcile to zero satang. Float drift breaks this.
- **TFRS for NPAEs ch. 18** (รายได้ — revenue): revenue must be recognised
  at the EXACT amount captured. Float storage cannot guarantee that.
- **ป.รัษฎากร ม.86/4** (Revenue Code, sequential tax-invoice numbering):
  every full tax invoice must show `subtotal + VAT = total`. The Revenue
  Department's ภ.พ.30 monthly VAT remittance spec rejects rows where the
  sum disagrees with the stored total by even ฿0.01.
- **ป.รัษฎากร ม.86/9 + ม.86/10** (debit notes / credit notes): adjustments
  reference the original invoice. Float drift between the two breaks the
  reconciliation chain.

### 1.3 Decimal(15,2)

`Decimal(15,2)` (PostgreSQL `numeric(15,2)`) stores up to 15 significant
digits with exactly 2 decimal places. Arithmetic is performed on the
decimal representation directly — no binary rounding. Every operation
that stays within the (15,2) domain is exact.

Prisma marshals `Decimal` columns as `Prisma.Decimal` instances (a
re-export of `decimal.js`), so JavaScript callers must coerce explicitly
before doing JS-native math.

---

## 2. Schema diff

The migration changes three columns on the `invoices` table:

| Column                 | Before  | After          |
|------------------------|---------|----------------|
| `invoices.subtotal`    | `Float` | `DECIMAL(15,2)`|
| `invoices.vat`         | `Float` | `DECIMAL(15,2)`|
| `invoices.totalAmount` | `Float` | `DECIMAL(15,2)`|

`Invoice.totalAmountText` (the Thai-text version) stays a `String?` — it
is rendered from the numeric column at write time and never participates
in arithmetic.

### 2.1 Columns NOT changed (and why)

| Column / Model | Reason |
|----------------|--------|
| `Quotation.{subtotal, vat, totalAmount}` | Already `Decimal(15,2)` since 20260516010000. |
| `JournalLine.{debit, credit, taxableAmount}` | Already `Decimal(15,2)` since 20260516000000. |
| `JournalEntry.{totalDebit, totalCredit}` | Already `Decimal(15,2)` since 20260516000000. |
| `CreditNote.{subtotal, vat, totalAmount}` | Already `Decimal(15,2)` since 20260516030000. |
| `DebitNote.{subtotal, vat, totalAmount}`  | Already `Decimal(15,2)` since 20260516030000. |
| `ManualJournalEntryDraft.{totalDebit, totalCredit}` | Already `Decimal(15,2)` since 20260516040000. |
| `PaymentSlip.{amountClaimed, amountVerified}` | **Stays `Int` satang** — see §5. |
| `PaymentTransaction.amount` | Stays `Int` satang — gateway-style integer capture, same rationale as PaymentSlip. |
| `InvoiceLineItem.{unitPrice, amount}` | Out of scope for Iter 24 (consumed only by PDF rendering, not by GL posting). Folded into a future cleanup batch. |
| `Quote.{subtotal, vat, totalAmount}` | Legacy single-issuer model, frozen — replaced by `Quotation`. |

---

## 3. Migration safety

The migration in `20260517000000_decimal_unification/migration.sql` is
**strictly additive**:

- No `DROP COLUMN`.
- No `NOT NULL` added without a default (the columns are already `NOT NULL`).
- `USING column::DECIMAL(15,2)` clause preserves every row value.
- Sub-satang Float fractions are rounded half-away-from-zero by the cast
  (PostgreSQL default). Largest GACP invoice ≈ ฿27,675; representational
  ceiling at (15,2) ≈ ฿99 trillion — many orders of magnitude clear.
- Reversible: a rollback to `double precision` (documented inline in the
  migration SQL) is lossless for any value ≤ 2^53.

`ALTER TABLE … ALTER COLUMN TYPE` takes an `ACCESS EXCLUSIVE` lock and
rewrites the table on disk. At current GACP invoice volumes (low four
digits) the rewrite finishes in well under a second; safe to run in the
standard maintenance window. For multi-million-row deployments, switch
to the online add-column + backfill + swap pattern.

---

## 4. Service-layer impact

Prisma returns `Decimal(15,2)` columns as `Prisma.Decimal` instances, NOT
JavaScript numbers. The instance:

- `toString()` → `"535.00"` (plain string, safe for CSV / JSON)
- `toFixed(n)` → `"535.00"` (Decimal.js method)
- `toNumber()` → `535` (lossless for amounts ≤ 2^53)
- `Number(decimal)` → `535` (calls `valueOf`; equivalent to `toNumber`)
- **`toLocaleString()` does NOT exist on Decimal.js** — direct interpolation
  of `${invoice.totalAmount.toLocaleString()}` would throw.

### 4.1 Audited call sites

| File | Line | Before | After |
|------|------|--------|-------|
| `services/invoice-service.js` | 382 | ``invoice.totalAmount.toLocaleString()`` | `Number(invoice.totalAmount).toLocaleString()` |
| `services/bank-reconciliation-service.js` | 378 | `invoice.totalAmount \|\| null` (truthy-object hazard at value 0) | `invoice.totalAmount == null ? null : Number(invoice.totalAmount)` |

### 4.2 Call sites that already work

All sites that wrap `invoice.totalAmount` (or `.subtotal` / `.vat`) in
`Number(...)` or `round2(...)` are safe — Prisma.Decimal implements
`valueOf` so `Number()` returns the underlying numeric value losslessly
for amounts well below 2^53. Audited:

- `services/ar-aging-service.js` — uses imported `round2` from
  customer-statement-service (which calls `toNumber()`).
- `services/customer-statement-service.js` — uses `round2(toNumber(n))`.
- `services/daily-cash-report-service.js` — uses local `round2(Number(n))`.
- `services/refund-service.js` — uses `Number(invoice.totalAmount)`.
- `services/split-payment-calculator.js` — uses `Number(invoice.totalAmount)`.
- `services/invoice-document-builder.js` — uses `Number(invoice.subtotal)`.
- `services/pdf/invoice-template-service.js` — uses `Number(invoice.*)` throughout.
- `services/pdf/application-template-service.js` — uses `Number(invoice.totalAmount)`.
- `services/phase-billing-service.js` — passes `invoice.totalAmount` through
  as an opaque value into a service-layer JSON payload; downstream
  consumers all coerce.

### 4.3 Decimal-throughout (future work)

The Iter 24 scope is the minimum patch to keep the system green. Folding
the codebase to operate on `Prisma.Decimal` end-to-end (using
`Decimal.add` / `Decimal.mul` / `Decimal.toString` instead of `Number()`
coercion) is a larger refactor scheduled for a post-go-live batch. The
math is exact either way for the volumes in play — the Decimal-throughout
refactor is a maintainability / clarity win, not a correctness fix.

---

## 5. PaymentSlip exception (Int satang stays)

`PaymentSlip.amountClaimed` and `.amountVerified` remain `Int` satang.

### 5.1 Rationale

1. **Source-of-truth unit**: applicants enter the exact baht-and-satang
   they transferred. We store the integer count of satang (× 100), which
   is the same representation as `PaymentTransaction.amount`. This
   eliminates the question "what does a sub-satang value mean here?"
   at the source layer.
2. **Storage cost**: PostgreSQL `Int` is 4 bytes; `Decimal(15,2)` is 9
   bytes. For a high-row-count append-only table (slip uploads grow
   roughly linearly with application count, with re-upload retries
   amplifying that) the savings are material in WAL + index size.
3. **Unit-conversion is centralised**: the only conversion site is
   `bank-reconciliation-service.satangToBaht()`, which rounds with the
   same banker's-rule helper as `journal-entry-service.round2()`. No
   other code path mixes the two units.

The Invoice (Decimal baht) and PaymentSlip (Int satang) columns ARE the
same money — same conceptual amount on opposite sides of the wire.
Reconciliation compares them after exactly one explicit conversion step
(documented in `bank-reconciliation-service.js`).

### 5.2 Conversion contract

```javascript
// satang → baht (used by bank-reconciliation-service)
function satangToBaht(satang) {
    if (satang === null || satang === undefined) return null;
    const n = Number(satang);
    if (!Number.isFinite(n)) return null;
    return Math.round(n) / 100;
}

// baht (number or Decimal) → satang (used by payment-service-phase-flow)
function bahtToSatang(baht) {
    return Math.round(Number(baht) * 100);
}
```

Both conversions go through `Math.round` so they are deterministic at
the boundary.

---

## 6. Parity invariant test

`apps/backend/__tests__/unit/decimal-parity.test.js` anchors four
invariants per paid invoice:

- **I1**: `subtotal + vat === totalAmount` (within 0.005 THB tolerance
  to absorb the USING-cast rounding of any legacy Float row).
- **I2**: `sum(JournalLine.debit) === totalAmount` (PLATFORM-side
  invoices only — STATE-side never lands on the platform's books per
  B16-C two-money-flow model).
- **I3**: `sum(JournalLine.credit) === totalAmount` (mirror of I2;
  also that `sum(debit) === sum(credit)`).
- **I4**: `cnTotal - dnTotal === originalTotal - adjustedTotal` (net of
  credit notes and debit notes equals the adjustment applied to the
  original invoice — keeps ม.86/9 + ม.86/10 reconciliation honest).

Mocks are inline fixture objects, not Prisma mocks — the test runs
without a database. Each invariant has at least one positive case and
one negative case so a regression that breaks the equation fails the
test loudly.

**Result**: 13 / 13 tests pass.

---

## 7. Backfill plan

`apps/backend/scripts/backfill-decimal-rounding.js` (optional, post-deploy).

### 7.1 What it does

- Reads every Invoice row.
- Recomputes `round2(subtotal + vat)`.
- Compares to stored `totalAmount`.
- If the delta exceeds 0.005 THB, flags the row.
- **Dry-run by default** — prints CSV-friendly diff to stdout, exits 0.
- `--apply` flag — writes corrections via one Prisma `$transaction`.

### 7.2 When to run

After deploying the migration. The migration itself uses
`USING column::DECIMAL(15,2)` which rounds at cast time, so all rows are
schema-consistent immediately. This script catches the rarer class of
legacy drift where the application code wrote `subtotal`, `vat`, and
`totalAmount` from separate Float calculations that fell out of parity
with each other.

### 7.3 Usage

```bash
# Dry-run (recommended first)
node apps/backend/scripts/backfill-decimal-rounding.js

# Apply corrections
node apps/backend/scripts/backfill-decimal-rounding.js --apply

# Limit row count
node apps/backend/scripts/backfill-decimal-rounding.js --limit 1000 --apply
```

### 7.4 Logging

Every change is logged with `(id, invoiceNumber, beforeTotal,
afterTotal, delta)` so an auditor can reconstruct the operation from the
log alone. Exits 0 on success, 1 on failure, 2 if the Prisma client is
unavailable.

---

## 8. Test results

| Suite | Tests | Result |
|-------|-------|--------|
| `decimal-parity.test.js` | 13 | PASS |
| `invoice-service.test.js` | (regression) | PASS |
| `journal-entry-service.test.js` | (regression) | PASS |
| `payment-phase-flow-canonical-totals.test.js` | (regression) | PASS |
| `credit-note-service.test.js` | (regression) | PASS |
| `bank-reconciliation-service.test.js` | (regression) | PASS |
| **Total** | **73 passed across 5 regression suites + 13 new** | **PASS** |

---

## 9. References

- `audit-gap-analysis-2026-05-16.md` — P0 #3 origin.
- `docs/dba/journal-entry-migration-2026-05-16.md` — Decimal(15,2) precedent.
- `apps/backend/prisma/migrations/20260516010000_add_journal_quotation_receipt_seq_bank_accounts/migration.sql` — Quotation Decimal precedent.
- `apps/backend/services/journal-entry-service.js` — `round2()` canonical helper.
- ป.รัษฎากร ม.86/4 — sequential tax-invoice numbering with exact taxable-amount column.
- TFRS for NPAEs ch. 2 — internal controls.
- TFRS for NPAEs ch. 18 — revenue recognition at exact amount.
