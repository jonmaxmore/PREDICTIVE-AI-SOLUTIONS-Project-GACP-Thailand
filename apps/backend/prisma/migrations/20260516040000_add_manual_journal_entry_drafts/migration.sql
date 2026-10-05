-- ✅ Batch B20-C — Manual Journal Entry Drafts workflow table (2026-05-16).
--
-- Migration name: add_manual_journal_entry_drafts
--
-- Adds the workflow row that backs services/manual-journal-entry-service.js.
-- The service owns the draft → approval → posting flow for journal entries
-- that are NOT triggered by a slip approval (bank charges, FX gain/loss,
-- accrual reversals, manual corrections after approval).
--
-- State machine (enforced at the service layer):
--   DRAFT     → APPROVED  (ADMIN; separation-of-duties — approver ≠ creator)
--   APPROVED  → POSTED    (ADMIN; writes JournalEntry + JournalLine
--                          atomically; postedJournalEntryId back-pointer)
--   DRAFT|APPROVED → REJECTED (records reason, terminal)
--   POSTED    → (terminal — TFRS for NPAEs ch.18 immutability; corrections
--                via a separate reversing entry)
--
-- This migration is STRICTLY ADDITIVE:
--   - No DROP COLUMN.
--   - No required FK without a default.
--   - New table with no cross-table dependencies.
--   - Indexes use IF NOT EXISTS so re-runs are idempotent.
--
-- Compliance basis (Thai accounting + statute):
--   - TFRS for NPAEs (Thai Financial Reporting Standards for Non-Publicly
--     Accountable Entities) ch.2 — internal controls require segregation
--     of incompatible functions: the staff member who creates a journal
--     entry cannot be the one who approves it.
--   - TFRS for NPAEs ch.18 — once posted, a journal entry is part of the
--     chronological accounting record and is immutable. Corrections via
--     reversing entries (preserves audit trail).
--   - TAS 1 (Presentation of Financial Statements) — chronological audit
--     trail with traceable references to source documents.
--   - ป.รัษฎากร ม.86/4 — sequential numbering on tax-bearing documents.
--     draftNumber MJE-{yearAD}-{seq6} preserves the audit trail even for
--     rejected drafts.
--   - ป.รัษฎากร ม.87/3 — 7-year retention for tax-bearing documents.
--
-- Concurrency notes:
--   The table is empty at migration time; CREATE TABLE takes the usual
--   ACCESS EXCLUSIVE lock on the new relation only. Indexes are created
--   alongside (no CONCURRENTLY needed for an empty table).
--
-- Rollback plan:
--   DROP TABLE manual_journal_entry_drafts CASCADE;
--   See docs/accounting/manual-je-and-daily-cash-2026-05-16.md §Rollback.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) manual_journal_entry_drafts — workflow row
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "manual_journal_entry_drafts" (
    "id"                      TEXT NOT NULL,
    "draftNumber"             TEXT NOT NULL,
    "description"             TEXT NOT NULL,
    "postingDate"             TIMESTAMP(3) NOT NULL,
    "reason"                  TEXT NOT NULL,
    "status"                  TEXT NOT NULL,
    "linesJson"               JSONB NOT NULL,
    "totalDebit"              DECIMAL(15, 2) NOT NULL,
    "totalCredit"             DECIMAL(15, 2) NOT NULL,
    "createdBy"               TEXT NOT NULL,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy"              TEXT,
    "approvedAt"              TIMESTAMP(3),
    "postedAt"                TIMESTAMP(3),
    "postedJournalEntryId"    TEXT,
    "rejectedBy"              TEXT,
    "rejectedAt"              TIMESTAMP(3),
    "rejectionReason"         TEXT,
    "organizationId"          TEXT,
    "updatedAt"               TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_journal_entry_drafts_pkey" PRIMARY KEY ("id")
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Unique on draftNumber — MJE-{yearAD}-{seq6} must be globally unique
--    so the auditor can cite "MJE-2026-000123" without ambiguity.
-- ──────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "manual_journal_entry_drafts_draftNumber_key"
    ON "manual_journal_entry_drafts" ("draftNumber");

-- ──────────────────────────────────────────────────────────────────────────
-- 3) Read-path indexes
-- ──────────────────────────────────────────────────────────────────────────
--
-- - (status) — the approval queue (status='DRAFT') and posted-list views
--   (status='POSTED') filter on this.
-- - (organizationId) — tenant scope; required for multi-tenant filtering.
-- - (createdBy) — "show me MY drafts" view for finance staff.
-- - (postingDate) — accounting-period queries ("all manual entries posted
--   in 2026-05") use a range scan on postingDate.

CREATE INDEX IF NOT EXISTS "manual_journal_entry_drafts_status_idx"
    ON "manual_journal_entry_drafts" ("status");

CREATE INDEX IF NOT EXISTS "manual_journal_entry_drafts_organizationId_idx"
    ON "manual_journal_entry_drafts" ("organizationId");

CREATE INDEX IF NOT EXISTS "manual_journal_entry_drafts_createdBy_idx"
    ON "manual_journal_entry_drafts" ("createdBy");

CREATE INDEX IF NOT EXISTS "manual_journal_entry_drafts_postingDate_idx"
    ON "manual_journal_entry_drafts" ("postingDate");
