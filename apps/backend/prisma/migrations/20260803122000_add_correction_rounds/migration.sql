-- R2 M3 EXPAND — correction_rounds (per-stage round ledger, FINAL ข้อ 2,
-- operator 2026-08-03; evidence/R2-special-reopen/final-requirements.md
-- verbatim: "นับเลขครั้งต่อ stage — reset ทุกรอบ วนไม่จำกัดครั้ง" +
-- decisions-final.md แผน M3).
--
-- Creates correction_rounds BESIDE the legacy revision_deadlines
-- row-per-application upsert — EXPAND only (Law 3.10): nothing existing is
-- altered or dropped; revision_deadlines keeps working unchanged and its
-- drain is future work. One row is APPENDED per correction decision by
-- services/decision-letter-service.js in the SAME transaction as the status
-- write + official letter (D-8); rows are append-only (FINAL ข้อ 4) — no
-- update/delete path exists (grep-pinned by
-- __tests__/unit/correction-round.test.js).
--
-- String + CHECK: stage carries a CHECK mirroring the frozen JS vocabulary
-- (shared/correction-round-stage.js) — same idiom as payment_reminder_logs /
-- notifications.kind. The UNIQUE (applicationId, stage, roundNo) key is the
-- race guard: two concurrent decisions computing the same round number abort
-- the transaction instead of double-minting a round.
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "correction_rounds";

BEGIN;

CREATE TABLE IF NOT EXISTS "correction_rounds" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applicationId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "roundNo" INTEGER NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "letterId" TEXT,
  "organizationId" TEXT NOT NULL,

  CONSTRAINT "correction_rounds_pkey" PRIMARY KEY ("id"),

  -- The DB refuses what the JS vocabulary refuses.
  CONSTRAINT "correction_rounds_stage_check" CHECK (
    "stage" IN ('DOC_REVIEW', 'FIELD_AUDIT')
  ),

  -- Round numbers start at 1 (FINAL ข้อ 2: ครั้งที่ 1, 2, 3, ... ไม่จำกัด).
  CONSTRAINT "correction_rounds_roundNo_check" CHECK ("roundNo" >= 1)
);

-- The per-stage counter key — concurrent-decision race guard.
CREATE UNIQUE INDEX IF NOT EXISTS "correction_rounds_applicationId_stage_roundNo_key"
  ON "correction_rounds"("applicationId", "stage", "roundNo");

-- Read path: rounds of one application per stage (counting + history views).
CREATE INDEX IF NOT EXISTS "correction_rounds_applicationId_stage_idx"
  ON "correction_rounds"("applicationId", "stage");
CREATE INDEX IF NOT EXISTS "correction_rounds_organizationId_idx"
  ON "correction_rounds"("organizationId");

-- Foreign keys — RESTRICT like the sibling audit-trail children
-- (payment_reminder_logs): a round row is history; deleting its application,
-- its letter (permanent archive, D-9), or its organization out from under it
-- must be refused, not cascaded.
ALTER TABLE "correction_rounds" ADD CONSTRAINT "correction_rounds_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_rounds" ADD CONSTRAINT "correction_rounds_letterId_fkey"
  FOREIGN KEY ("letterId") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_rounds" ADD CONSTRAINT "correction_rounds_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
