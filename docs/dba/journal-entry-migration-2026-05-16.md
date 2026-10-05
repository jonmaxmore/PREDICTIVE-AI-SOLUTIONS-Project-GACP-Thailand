# DBA — Journal-Entry & Receipt-Sequence Migration (Batch 16, 2026-05-16)

Owner: DBA + Backend
Status: Committed — awaiting orchestrator deploy
Sibling architecture doc: [`docs/architecture/journal-entry-schema-2026-05-16.md`](../architecture/journal-entry-schema-2026-05-16.md)

## Migration summary

| Field           | Value |
|-----------------|-------|
| Name            | `20260516000000_add_journal_entries_receipt_sequence` |
| Path            | `apps/backend/prisma/migrations/20260516000000_add_journal_entries_receipt_sequence/migration.sql` |
| Schema source   | `apps/backend/prisma/schema/billing.prisma` (lines covering `JournalEntry`, `JournalLine`, `ReceiptSequence`) |
| Tables added    | `journal_entries`, `journal_lines`, `receipt_sequences` |
| Tables modified | `invoices` (back-relation only — no column change) |
| Indexes added   | 8 (see breakdown below) |
| Idempotency     | Every `CREATE` is `IF NOT EXISTS`; FK ADD wrapped in `DO $$ ... pg_constraint guard ... $$;` so re-running the migration is safe. |

## Tables created

### `journal_entries` (aggregate root)

| Column           | Type              | Notes |
|------------------|-------------------|-------|
| `id`             | `UUID`            | `gen_random_uuid()` default; PK |
| `entryDate`      | `TIMESTAMP(3)`    | accounting date (typically `invoice.paidAt`) |
| `reference`      | `TEXT`            | free-form, usually `invoice.invoiceNumber` |
| `invoiceId`      | `UUID` (nullable) | application-layer FK to `invoices.id` (see note below) |
| `description`    | `TEXT`            | human-readable summary |
| `totalDebit`     | `DECIMAL(15,2)`   | must equal `totalCredit` (balanced invariant) |
| `totalCredit`    | `DECIMAL(15,2)`   | |
| `organizationId` | `UUID` (nullable) | tenancy (ADR-014); FK enforced in application layer |
| `createdAt`      | `TIMESTAMP(3)`    | `CURRENT_TIMESTAMP` default |
| `createdBy`      | `TEXT`            | canonical user id (actor) |
| `isDeleted`      | `BOOLEAN`         | soft-delete; reversing entries preferred over hard delete |

Indexes: `entryDate`, `reference`, `invoiceId`, `organizationId`.

### `journal_lines` (balanced debit/credit lines)

| Column        | Type                | Notes |
|---------------|---------------------|-------|
| `id`          | `UUID`              | `gen_random_uuid()` default; PK |
| `entryId`     | `UUID`              | FK → `journal_entries.id` `ON DELETE CASCADE` |
| `lineNumber`  | `INTEGER`           | 1-based ordinal within the entry |
| `accountCode` | `TEXT`              | chart-of-accounts code (`1110-001`, `2151-001`, ...) |
| `accountName` | `TEXT`              | Thai-language account name |
| `debit`       | `DECIMAL(15,2)`     | default `0` |
| `credit`      | `DECIMAL(15,2)`     | default `0` |
| `issuer`      | `TEXT` (nullable)   | `'DTAM'` \| `'PLATFORM'` for split-reporting |
| `metadata`    | `JSONB` (nullable)  | forward-compat (WHT, FX, multi-entity, reversal markers) |
| `createdAt`   | `TIMESTAMP(3)`      | `CURRENT_TIMESTAMP` default |

Indexes: `entryId`, `accountCode`.

### `receipt_sequences` (per-scope monotonic counter)

| Column            | Type            | Notes |
|-------------------|-----------------|-------|
| `id`              | `UUID`          | `gen_random_uuid()` default; PK |
| `prefix`          | `TEXT`          | `'RCP-DTAM'` \| `'TAX-PRD'` (extensible) |
| `year`            | `INTEGER`       | BE for DTAM (`2569`), CE for PLATFORM (`2026`) — formatter decides calendar |
| `counter`         | `INTEGER`       | last-allocated value; `nextval = counter + 1`; default `0` |
| `lastAllocatedAt` | `TIMESTAMP(3)`  | `CURRENT_TIMESTAMP` default |
| `updatedAt`       | `TIMESTAMP(3)`  | maintained by Prisma `@updatedAt` |

Unique index: `(prefix, year)`. Secondary index: `(prefix)`.

## Rationale — Thai accounting standards

This migration closes the gap between the logger-only journal stream and a durable accounting ledger required by:

- **TFRS for NPAEs** (Thai Financial Reporting Standards for Non-Publicly Accountable Entities) — mandatory double-entry bookkeeping for SMEs; sum of debits must equal sum of credits per posting.
- **TAS 1** (Presentation of Financial Statements) — chronological audit trail with traceable references to source documents.
- **Revenue Code §86/4** (ภ.พ.30 monthly VAT return) — output VAT must be on a separable credit line per tax-invoice receipt to be remittable.
- **Revenue Code §87/3** — 7-year retention window for tax-bearing documents (inherited from `Invoice.retainUntil`; enforced at the application layer for journal entries).
- **TAS 18.8 — agent vs principal** — state-fee cash collected on behalf of DTAM is a **liability** (`PAYABLE_TO_DTAM`, code `2151-001`), never platform revenue. See `services/journal-entry-service.js` for the account taxonomy.

## ReceiptSequence concurrency model

**Chosen approach: row-level `ROW EXCLUSIVE` lock via `UPDATE ... RETURNING` inside a transaction (default isolation = `READ COMMITTED`).**

```sql
BEGIN;
  INSERT INTO receipt_sequences (prefix, year)
       VALUES ($1, $2)
  ON CONFLICT (prefix, year) DO NOTHING;

  UPDATE receipt_sequences
     SET counter         = counter + 1,
         "lastAllocatedAt" = now()
   WHERE prefix = $1
     AND year   = $2
  RETURNING counter;
COMMIT;
```

The `UPDATE` takes a `ROW EXCLUSIVE` lock on the matched row; any concurrent allocator for the same `(prefix, year)` waits for COMMIT, then sees the incremented value and increments again. No two callers ever see the same `counter`.

### Why not `SERIALIZABLE` isolation

`SERIALIZABLE` would also work, but is **strictly worse** for this workload because:

1. **Throughput** — `SERIALIZABLE` snapshot tracking aborts and retries on serialization-conflict (`SQLSTATE 40001`); allocators are hot paths during payment-settlement bursts, and retries would compound.
2. **Application complexity** — the caller would have to install a retry loop for every receipt allocation. `READ COMMITTED` + row lock is one round-trip, never aborts.
3. **No phantom risk** — we always operate on a single row identified by the unique `(prefix, year)` key. The serialization anomalies `SERIALIZABLE` protects against (read skew, write skew, phantoms across queries) are simply not reachable in this access pattern.

### Why not a Postgres `SEQUENCE`

We use a `SEQUENCE` for `gacp_certificate_seq` (single global counter), but **not** here, because:

- Receipts need one counter per `(prefix, year)` pair — currently 2 prefixes × N years. `SEQUENCE` objects are global and would require ~20+ sequence DDL operations per fiscal year boundary.
- `SEQUENCE`s are opaque to the ORM and to admin dashboards; a table row is trivially introspectable.
- Lazy creation on first use via `INSERT ... ON CONFLICT DO NOTHING` is one extra round trip on the first call of a new `(prefix, year)`, then zero overhead thereafter.

### Application-layer integration (B16-C territory)

The allocator helper that wraps the SQL above is owned by B16-C (lives in or near `apps/backend/services/receipt-number-service.js` per the orchestrator plan). DBA's contract: **the table guarantees uniqueness by the `(prefix, year)` UNIQUE index, even if a future bug causes two callers to try to insert the same scope simultaneously.**

## Seed data

`apps/backend/prisma/seed-receipt-sequences.js` (added in this batch):

- `('RCP-DTAM', 2569)` — DTAM state-fee receipts for BE 2569 (fiscal 2026), `counter = 0`.
- `('TAX-PRD', 2026)` — platform tax invoices for CE 2026, `counter = 0`.

`upsert` with empty `update: {}` so re-running the seed in a live environment **never** overwrites a running counter. Pre-seeding is optional — the allocator inserts lazily on first allocation — but doing it at deploy keeps the admin "current counter" panel non-empty on day one.

## Validation results

| Check                                                                                | Result |
|--------------------------------------------------------------------------------------|--------|
| `npx prisma validate --schema prisma/schema`                                         | **PASS** ("The schemas at prisma\\schema are valid") |
| `npx jest __tests__/unit/journal-entry-service.test.js --no-coverage`                | **23/23 PASS** |
| Schema-format diff after `npx prisma format`                                         | none |

## Risks & deploy notes

| Risk | Severity | Mitigation |
|------|----------|------------|
| Migration name collides with an unrelated branch | **Low** | Filename uses ISO timestamp prefix `20260516000000`; conflicts surface as Prisma migration name collision at `migrate deploy`. |
| `Invoice.id` is `TEXT` while `JournalEntry.invoiceId` is `UUID` → no DB-level FK | **Low** | Documented in migration.sql lines 49–57 and in the architecture doc. Referential integrity is enforced at the application layer (writer is one transaction). B16-B may add a column-promotion migration if a hard FK is required. |
| Decimal arithmetic divergence with legacy `Invoice.subtotal`/`vat`/`totalAmount` Float columns | **Low** | Journal entries source values from `payment-fees.js` constants, not `Invoice.totalAmount`; the existing `round2()` helper in `journal-entry-service.js` is the boundary. |
| Seeding overwrites an in-flight counter on re-run | **None** | Seed uses `upsert` with empty `update: {}`. |

### Down migration

**Trivial to author.** The down migration is a 3-line `DROP TABLE IF EXISTS journal_lines, journal_entries, receipt_sequences CASCADE;` plus dropping the eight indexes (PG drops index automatically with the table). Concretely:

```sql
-- 20260516000000_add_journal_entries_receipt_sequence/down.sql (not yet committed)
DROP TABLE IF EXISTS "journal_lines"     CASCADE;
DROP TABLE IF EXISTS "journal_entries"   CASCADE;
DROP TABLE IF EXISTS "receipt_sequences" CASCADE;
```

(Indexes and the FK constraint disappear automatically because they hang off these tables.)

**Caveats for a real rollback:**

1. Any rows already in `journal_entries` / `journal_lines` would be **destroyed** by the `DROP`. Once accounting starts using the ledger, rollback is no longer cheap — it's a data loss event. Acceptable in pre-production and the first hours after rollout; not acceptable after the first month-end close.
2. `Invoice.journalEntries` back-relation in `billing.prisma` would need to be removed in the same revert, otherwise `prisma validate` will fail on the next `migrate dev`.
3. The `receipt_sequences` rollback removes the only persistent record of "what was the last receipt number issued in BE 2569"; if any receipts have been issued the rollback would risk reissuing duplicate numbers on re-deploy. Mitigate by exporting the table contents (`pg_dump --table receipt_sequences --data-only`) before dropping.

Recommendation: treat this migration as **forward-only after first production receipt**; rollback path is for emergency pre-prod recovery only.

## Files changed in this batch

| File                                                                                            | Change                          |
|-------------------------------------------------------------------------------------------------|---------------------------------|
| `apps/backend/prisma/schema/billing.prisma`                                                     | Added `JournalEntry`, `JournalLine`, `ReceiptSequence` models + `Invoice.journalEntries` back-relation (committed) |
| `apps/backend/prisma/migrations/20260516000000_add_journal_entries_receipt_sequence/migration.sql` | New migration (committed)       |
| `apps/backend/prisma/seed-receipt-sequences.js`                                                 | **Added in this batch** — pre-seed rows for the current accounting year |
| `docs/architecture/journal-entry-schema-2026-05-16.md`                                          | Architecture rationale (committed) |
| `docs/dba/journal-entry-migration-2026-05-16.md`                                                | **Added in this batch** — DBA-facing migration notes (this file) |
