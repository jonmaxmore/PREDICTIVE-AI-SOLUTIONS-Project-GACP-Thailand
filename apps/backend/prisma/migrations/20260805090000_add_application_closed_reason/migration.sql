-- R2 M4 EXPAND — applications.closedReason (unified terminal close-reason,
-- the reopen-eligibility key for mechanism 2). operator-approved vocab
-- 2026-08-05 (reports/pm/M4-terminal-vocab-proposal.md; decisions-final.md:17,64).
--
-- EXPAND only (Law 3.10): nullable ADD COLUMN — catalog-only on a populated
-- table (no rewrite, no backfill; every existing row is truthfully NULL until a
-- close path sets it). Nothing existing is altered or dropped.
--
-- String + CHECK (not a Prisma enum — operator 2026-08-05): the value set is
-- documented here and enforced by the CHECK so out-of-set values are rejected,
-- while staying extensible without an enum migration per new value. Same idiom
-- as notifications.kind / correction_rounds.stage.
--
-- Value set (v1). M4 (jobs/revision-deadline-checker.js) writes ONLY
-- 'CORRECTION_DEADLINE_EXPIRED'. The rest are RESERVED slots so the vocab lives
-- in one place; their writers are separate backlog items and MUST stay unwired
-- for now (guarded by __tests__/unit/closed-reason-reserved-slots.test.js):
--   CORRECTION_DEADLINE_EXPIRED  — R2 cron close (deadline passed) — reopen-eligible
--   REJECTED_DOC_REVIEW          — reserved (reviewer reject)
--   REJECTED_AUDIT               — reserved (auditor reject)
--   CANCELLED_BY_APPLICANT       — reserved
--   CANCELLED_BY_ADMIN           — reserved
--   PAYMENT_ABANDONED            — reserved (M5)
--   LEGACY_AUTO_CANCEL           — reserved (pre-M4 /auto-cancel + guard FAILED closes)
--
-- Adjacent cleanup (RevisionDeadline.status EXPIRED-vs-FAILED split + the
-- audit.prisma comment gap) is deferred to a separate backlog ticket
-- ("terminal-vocab reconciliation") — operator 2026-08-05. NOT touched here.
--
-- Rollback (manual):
--   ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "applications_closedReason_check";
--   DROP INDEX IF EXISTS "applications_closedReason_idx";
--   ALTER TABLE "applications" DROP COLUMN IF EXISTS "closedReason";

BEGIN;

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "closedReason" TEXT;

-- CHECK: NULL (not closed / close-reason not recorded) or one of the frozen set.
-- Added via a guard so re-running the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_closedReason_check'
  ) THEN
    ALTER TABLE "applications"
      ADD CONSTRAINT "applications_closedReason_check"
      CHECK (
        "closedReason" IS NULL OR "closedReason" IN (
          'CORRECTION_DEADLINE_EXPIRED',
          'REJECTED_DOC_REVIEW',
          'REJECTED_AUDIT',
          'CANCELLED_BY_APPLICANT',
          'CANCELLED_BY_ADMIN',
          'PAYMENT_ABANDONED',
          'LEGACY_AUTO_CANCEL'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "applications_closedReason_idx"
  ON "applications" ("closedReason");

COMMIT;
