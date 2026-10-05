-- ✅ Iter 24 — Period Close workflow table (2026-05-17).
--
-- Migration name: add_period_close
--
-- Adds the monthly accounting-period close row that backs
-- services/period-close-service.js. Once a (organizationId, year, month)
-- triple lands in CLOSED status, journal-entry-service rejects new entries
-- whose entryDate falls inside the period boundary — preventing back-
-- dating fraud and sealing the ภ.พ.30 / TFRS for NPAEs financial
-- statements for the period.
--
-- State machine (enforced at the service layer):
--   OPEN     → CLOSED   (finance closes a fully-elapsed month;
--                        validates no PENDING invoices remain)
--   CLOSED   → REOPENED (ADMIN-only; separation-of-duties — reopener
--                        MUST differ from original closer)
--   REOPENED → CLOSED   (re-close after corrections posted)
--
-- This migration is STRICTLY ADDITIVE:
--   - No DROP COLUMN.
--   - No required FK without a default.
--   - New table with no cross-table dependencies.
--   - Indexes use IF NOT EXISTS so re-runs are idempotent.
--   - Independent from B24-A's Invoice column changes — non-conflicting.
--
-- Compliance basis (Thai accounting + statute):
--   - TFRS for NPAEs ch.5 — year-end close (monthly close supports it).
--   - TFRS for NPAEs ch.2 — internal controls + segregation of duties:
--     the user who CLOSED a period must not be the user who REOPENS it.
--   - ป.รัษฎากร ม.86/4 — VAT period closure aligns with monthly ภ.พ.30.
--   - ป.รัษฎากร ม.87/3 — 7-year retention.
--   - Thai e-Transactions Act §31 — every close + reopen audit-logged.
--
-- Concurrency notes:
--   The table is empty at migration time; CREATE TABLE takes the usual
--   ACCESS EXCLUSIVE lock on the new relation only. Indexes are created
--   alongside (no CONCURRENTLY needed for an empty table). The compound
--   UNIQUE index on (organizationId, year, month) enforces a single
--   close record per period per tenant — a duplicate close insert
--   surfaces a unique-violation that the service maps to ALREADY_CLOSED.
--
-- Rollback plan:
--   DROP TABLE period_closes CASCADE;
--   See docs/accounting/period-close-workflow-2026-05-16.md §Rollback.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) period_closes — close workflow row
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "period_closes" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year"           INTEGER NOT NULL,
    "month"          INTEGER NOT NULL,
    "closedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy"       TEXT NOT NULL,
    "status"         TEXT NOT NULL,
    "reopenedAt"     TIMESTAMP(3),
    "reopenedBy"     TEXT,
    "reopenReason"   TEXT,
    "notes"          TEXT,

    CONSTRAINT "period_closes_pkey" PRIMARY KEY ("id")
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Unique on (organizationId, year, month) — one close row per period
--    per tenant. A second close attempt surfaces a unique-violation which
--    the service maps to ALREADY_CLOSED with a clear error message.
-- ──────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "period_closes_organizationId_year_month_key"
    ON "period_closes" ("organizationId", "year", "month");

-- ──────────────────────────────────────────────────────────────────────────
-- 3) Read-path indexes
-- ──────────────────────────────────────────────────────────────────────────
--
-- - (organizationId) — tenant-scoped lookups dominate the read path
--   ("show me my org's closed periods"). The compound unique above also
--   serves single-period lookups, so the (organizationId)-only index is
--   for range scans over the close history.
-- - (year, month) — admin-wide reporting ("how many tenants closed May
--   2026?") aggregates by period — index supports that scan.

CREATE INDEX IF NOT EXISTS "period_closes_organizationId_idx"
    ON "period_closes" ("organizationId");

CREATE INDEX IF NOT EXISTS "period_closes_year_month_idx"
    ON "period_closes" ("year", "month");
