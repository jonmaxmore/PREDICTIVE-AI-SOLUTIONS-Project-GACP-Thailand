-- ✅ Batch 16 — Double-entry accounting + receipt-sequence allocator (2026-05-16).
--
-- Adds three tables that back the journal-entry-service double-entry stream
-- and the canonical receipt-number allocator:
--
--   1. journal_entries     — the aggregate root for each posted entry
--   2. journal_lines       — the balanced debit/credit lines under each entry
--   3. receipt_sequences   — per-(prefix, year) monotonic counter for canonical
--                            receipt numbers (RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑, etc.)
--
-- Compliance basis:
--   - TFRS for NPAEs (Thai Financial Reporting Standards for Non-Publicly
--     Accountable Entities) — mandatory double-entry bookkeeping.
--   - TAS 1 (Presentation of Financial Statements) — chronological audit
--     trail with traceable references to source documents.
--   - Revenue Code §86/4 (ภ.พ.30) — VAT remittance requires a separable
--     "VAT Payable (Output)" credit line on every platform-fee receipt.
--   - Revenue Code §87/3 — 7-year retention for tax-bearing documents.
--
-- Idempotency:
--   Every CREATE statement guards with IF NOT EXISTS so the migration can be
--   re-run safely (matches the pattern from 20260515170000_add_performance_…).
--
-- Concurrency:
--   No CONCURRENTLY here — these tables are new and empty at migration time,
--   so blocking-CREATE is fine. The CONCURRENTLY discipline only matters
--   when indexing tables that already hold production rows.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) journal_entries
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "entryDate"      TIMESTAMP(3) NOT NULL,
    "reference"      TEXT         NOT NULL,
    "invoiceId"      UUID,
    "description"    TEXT         NOT NULL,
    "totalDebit"     DECIMAL(15,2) NOT NULL,
    "totalCredit"    DECIMAL(15,2) NOT NULL,
    "organizationId" UUID,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"      TEXT,
    "isDeleted"      BOOLEAN      NOT NULL DEFAULT false,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- Note: invoices.id is TEXT (uuid stored as text) per the existing Invoice
-- model, but the new JournalEntry.invoiceId is UUID-typed for type discipline
-- on the new table. Postgres allows TEXT <-> UUID coerce at the cast layer,
-- and the FK below uses an explicit USING clause via a deferred ADD CONSTRAINT.
-- Because the existing Invoice.id column is TEXT (not UUID), we cannot add a
-- DB-level FK without casting. We instead enforce referential integrity in
-- the application layer (journal-entry-service writes both rows in the same
-- transaction and aborts on Invoice mismatch). This is the same trade-off
-- the codebase makes for several other tables that link by string-typed UUID.

CREATE INDEX IF NOT EXISTS "journal_entries_entryDate_idx"
    ON "journal_entries" ("entryDate");
CREATE INDEX IF NOT EXISTS "journal_entries_reference_idx"
    ON "journal_entries" ("reference");
CREATE INDEX IF NOT EXISTS "journal_entries_invoiceId_idx"
    ON "journal_entries" ("invoiceId");
CREATE INDEX IF NOT EXISTS "journal_entries_organizationId_idx"
    ON "journal_entries" ("organizationId");

-- ──────────────────────────────────────────────────────────────────────────
-- 2) journal_lines
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "journal_lines" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "entryId"     UUID         NOT NULL,
    "lineNumber"  INTEGER      NOT NULL,
    "accountCode" TEXT         NOT NULL,
    "accountName" TEXT         NOT NULL,
    "debit"       DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit"      DECIMAL(15,2) NOT NULL DEFAULT 0,
    "issuer"      TEXT,
    "metadata"    JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- FK with ON DELETE CASCADE: a journal entry's lines are part of the
-- aggregate — deleting the entry deletes its lines. In practice we never
-- hard-delete entries (use isDeleted=true + reversing entry), but the
-- cascade is the right structural answer.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_entryId_fkey'
    ) THEN
        ALTER TABLE "journal_lines"
            ADD CONSTRAINT "journal_lines_entryId_fkey"
            FOREIGN KEY ("entryId")
            REFERENCES "journal_entries"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "journal_lines_entryId_idx"
    ON "journal_lines" ("entryId");
CREATE INDEX IF NOT EXISTS "journal_lines_accountCode_idx"
    ON "journal_lines" ("accountCode");

-- ──────────────────────────────────────────────────────────────────────────
-- 3) receipt_sequences
-- ──────────────────────────────────────────────────────────────────────────
--
-- Why a table (not a Postgres SEQUENCE):
--   - We need ONE counter per (prefix, year) pair, not one global counter.
--     Postgres SEQUENCEs are global objects — we'd need ~20 of them and
--     they'd be impossible to introspect via the ORM.
--   - The allocator does `UPDATE receipt_sequences SET counter = counter + 1
--     WHERE prefix=$1 AND year=$2 RETURNING counter` inside a transaction —
--     this is atomic at the row level (Postgres takes a ROW EXCLUSIVE lock
--     on the matched row) and serialises concurrent allocators.
--   - Inserting the (prefix, year) row on first use is handled by the
--     application layer (INSERT … ON CONFLICT DO NOTHING then UPDATE).

CREATE TABLE IF NOT EXISTS "receipt_sequences" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "prefix"          TEXT         NOT NULL,
    "year"            INTEGER      NOT NULL,
    "counter"         INTEGER      NOT NULL DEFAULT 0,
    "lastAllocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipt_sequences_prefix_year_key"
    ON "receipt_sequences" ("prefix", "year");
CREATE INDEX IF NOT EXISTS "receipt_sequences_prefix_idx"
    ON "receipt_sequences" ("prefix");
