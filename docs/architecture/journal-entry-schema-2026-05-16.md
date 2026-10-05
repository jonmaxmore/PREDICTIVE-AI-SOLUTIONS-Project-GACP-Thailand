# Journal-Entry & Receipt-Sequence Schema — 2026-05-16 (Batch 16)

Owners: DBA, Backend, Compliance
Status: Committed
Migration: `apps/backend/prisma/migrations/20260516000000_add_journal_entries_receipt_sequence`

## Why now

Until this batch, `services/journal-entry-service.js` emitted balanced
double-entry journal entries to the structured logger only — accounting
could audit the stream from log aggregation, but the entries were not
durable in the operational database. That arrangement is incompatible with
**TFRS for NPAEs** (Thai Financial Reporting Standards for Non-Publicly
Accountable Entities) and **TAS 1** (Presentation of Financial Statements),
both of which require:

1. Double-entry persistence with traceable references to source documents.
2. Chronological ordering of postings.
3. 7-year retention for tax-bearing records (also required by Revenue
   Code §87/3).

This migration adds the three tables that close the gap, plus the
`receipt_sequences` allocator that batch 16-B will use to issue canonical
receipt numbers like `RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑` (DTAM state-fee receipts in
Buddhist Era 2569) and `TAX-PRD-๒๐๒๖-๐๐๐๐๐๑` (platform tax invoices in
Common Era 2026).

## Schema diff (summary)

```
apps/backend/prisma/schema/billing.prisma
  Invoice
    + journalEntries  JournalEntry[]       // back-relation (one Invoice → N entries)

  + model JournalEntry { ... }             // aggregate root, Decimal(15,2) money
  + model JournalLine  { ... }             // CASCADE-delete with parent entry
  + model ReceiptSequence { ... }          // (prefix, year) unique monotonic counter
```

Three new tables:

| Table              | Rows per | Key columns                 | Notes                                  |
|--------------------|----------|------------------------------|----------------------------------------|
| `journal_entries`  | 1 per posting | `id`, `invoiceId`, `entryDate`, `reference`, `totalDebit`, `totalCredit` | Soft-delete only; reversing entries preferred |
| `journal_lines`    | N per entry | `entryId` (FK CASCADE), `accountCode`, `debit`, `credit`, `issuer`, `metadata` | Immutable once written              |
| `receipt_sequences`| 1 per (prefix, year) | `prefix`, `year` (UNIQUE), `counter` | Atomic UPDATE … RETURNING for allocation |

Indexes added (`IF NOT EXISTS`-guarded for idempotency):

- `journal_entries(entryDate)` — trial-balance + period reports
- `journal_entries(reference)` — invoice-number lookups
- `journal_entries(invoiceId)` — back-trace from an invoice
- `journal_entries(organizationId)` — per-tenant filtering (ADR-014)
- `journal_lines(entryId)` — join from entry to lines
- `journal_lines(accountCode)` — per-account ledger
- `receipt_sequences(prefix, year)` UNIQUE — one counter per scope
- `receipt_sequences(prefix)` — list all years for an issuer

## Money type — Decimal(15,2) not Float

Every monetary column uses `Decimal(15,2)`:

- Maximum value: 9,999,999,999,999.99 THB — far above any realistic invoice.
- Exact decimal storage: avoids the float-comparison hazards documented in
  `journal-entry-service.js` (the existing `round2` helper rounds at the
  application boundary before persistence).
- Maps to JavaScript `Decimal.js` via Prisma; existing Float-typed `Invoice`
  columns coerce cleanly during the application-layer assembly.

We deliberately did NOT match the existing `Invoice.subtotal`/`vat`/`totalAmount`
Float columns. Those are legacy; new accounting tables hold ground truth.
The discrepancy is acceptable because `journal-entry-service` always sources
its decimal amounts from the canonical `payment-fees.js` constants, not from
`Invoice.totalAmount`.

## Why `metadata Json?` on JournalLine

`JournalLine.metadata` is a forward-compat hook for fields that should not
yet be promoted to columns:

- **Withholding tax (หัก ณ ที่จ่าย / WHT)** — when government agencies pay
  the platform, they withhold 1% or 3% at source. Future entries will need
  a `whtRate`, `whtAmount`, and `whtCertificateNumber` per line.
- **Foreign currency / FX** — rare but possible for ENTERPRISE customers
  billed in USD. Would carry `currency`, `fxRate`, `baseAmount`.
- **Multi-entity / subsidiary code** — when the platform is restructured
  into multiple legal entities (DTAM as one, platform as another, regional
  inspection partners as a third), a `subsidiaryCode` per line is needed
  for consolidation.
- **Reversal markers** — `reversesEntryId` + `reversalReason` on the
  reversing entry's lines.

Promoting any of these to a proper column requires a backfilling migration.
Keeping them in `metadata` until they have multiple real consumers avoids
schema churn. Same forward-compat pattern as `Invoice.metadata` and
`PaymentTransaction.paymentData`.

## Why a counter table (not Postgres SEQUENCE)

The certificate-number race fix (2026-05-15) introduced a Postgres
`SEQUENCE` for `gacp_certificate_seq`. We deliberately did NOT use a
`SEQUENCE` here because:

- We need ONE counter per `(prefix, year)` pair — currently 2 prefixes ×
  many years = 20+ scopes — and `SEQUENCE` objects are global, ORM-opaque,
  and a chore to introspect.
- The `UPDATE … SET counter = counter + 1 … RETURNING counter` pattern
  inside a transaction takes a `ROW EXCLUSIVE` lock — Postgres serialises
  concurrent allocators by transaction-isolation rules, same guarantee as
  `SELECT nextval()`.
- Inserting the row on first use of a new `(prefix, year)` is handled by
  `INSERT … ON CONFLICT (prefix, year) DO NOTHING` followed by `UPDATE …
  RETURNING`; this is one extra round trip on the first call of each year
  and zero overhead thereafter.

## Sample query — chronological journal stream for an application

```sql
SELECT je.id,
       je."entryDate",
       je.reference,
       je.description,
       jl."lineNumber",
       jl."accountCode",
       jl."accountName",
       jl.debit,
       jl.credit,
       jl.issuer
FROM   "journal_entries" je
JOIN   "journal_lines"   jl ON jl."entryId" = je.id
JOIN   "invoices"        i  ON i.id          = je."invoiceId"
WHERE  i."applicationId" = $1
  AND  je."isDeleted"   = false
ORDER  BY je."entryDate" ASC,
          jl."lineNumber" ASC;
```

In Prisma:

```js
const stream = await prisma.journalEntry.findMany({
  where: {
    isDeleted: false,
    invoice: { applicationId: applicationId }
  },
  include: { lines: { orderBy: { lineNumber: 'asc' } } },
  orderBy: { entryDate: 'asc' }
});
```

## Open items for B16-B (orchestrator decisions)

1. **`Invoice.id` is TEXT, `JournalEntry.invoiceId` is UUID** — the existing
   Invoice model declares `id String @id @default(uuid())` without `@db.Uuid`,
   so the column is Postgres `TEXT`. We could not add a DB-level FK from
   `journal_entries.invoiceId` to `invoices.id` without a type-coercion cast.
   Referential integrity is enforced in the application layer (the writer
   reads the Invoice and writes both rows in the same transaction). If the
   orchestrator wants a DB-level FK, B16-B should plan a separate migration
   that converts `Invoice.id` to UUID — a non-trivial change touching
   `invoices`, `invoice_line_items`, `quotes.applicationId`, `payment_slips.invoiceId`,
   and the `Application.phase{1,2}SlipId` pair.
2. **No `organizationId` FK** — same reasoning. Future cleanup once the
   tenancy migration consolidates UUID typing across the schema.
3. **`receipt_sequences` row-creation timing** — B16-B must decide whether
   `(prefix, year)` rows are pre-seeded for the current year at deploy or
   lazily inserted on first allocation. Lazy is simpler; pre-seeding is
   nicer for monitoring.

## Validation

- `npx prisma validate --schema prisma/schema` — exit 0.
- `npx prisma format --schema prisma/schema` — no diff after run.
- `npx jest __tests__/unit/journal-entry --no-coverage` — 12/12 pass.
