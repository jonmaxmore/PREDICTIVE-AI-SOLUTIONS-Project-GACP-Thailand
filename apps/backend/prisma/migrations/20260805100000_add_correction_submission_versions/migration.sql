-- R2 M7 EXPAND — correction_submission_versions (append-only submitted-formData
-- history per correction round, D-6; operator 2026-08-03;
-- evidence/R2-special-reopen/decisions-final.md:23,67).
--
-- D-6 verbatim: "append-only ครอบ applications.js + review-revision merge →
-- version/supersede เฉพาะ correction flow". Before M7 a farmer's resubmit
-- OVERWROTE Application.formData each round, destroying the previously-submitted
-- version. M7 preserves every round's submitted formData as an immutable row.
--
-- EXPAND only (Law 3.10): this table sits BESIDE Application.formData — the
-- column STILL holds the latest working copy (the overwrite is unchanged); M7
-- only ADDS the durable history. Nothing existing is altered or dropped.
--
-- Follows migration 20260803122000_add_correction_rounds as the template:
--   String + CHECK on stage mirroring the frozen JS vocabulary
--   (shared/correction-round-stage.js) — the DB refuses what the vocabulary
--   refuses. The UNIQUE (applicationId, stage, roundNo) key is the append-only
--   guarantee: a second submission for the SAME round hits it and Postgres
--   aborts the transaction (P2002) instead of overwriting the snapshot.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS; FK + CHECK added through the
-- pg_constraint guard idiom (migration 20260805090000_add_application_closed_reason)
-- so a re-run is a no-op.
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "correction_submission_versions";

BEGIN;

CREATE TABLE IF NOT EXISTS "correction_submission_versions" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applicationId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "roundNo" INTEGER NOT NULL,
  "formDataSnapshot" JSONB NOT NULL,
  "attachmentsSnapshot" JSONB,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,

  CONSTRAINT "correction_submission_versions_pkey" PRIMARY KEY ("id")
);

-- The DB refuses what the JS vocabulary refuses (DOC_REVIEW | FIELD_AUDIT),
-- added via a pg_constraint guard so re-running the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'correction_submission_versions_stage_check'
  ) THEN
    ALTER TABLE "correction_submission_versions"
      ADD CONSTRAINT "correction_submission_versions_stage_check"
      CHECK ("stage" IN ('DOC_REVIEW', 'FIELD_AUDIT'));
  END IF;
END $$;

-- Round numbers start at 1 (D-2 revoked the 3-strike rule: 1, 2, 3, … no cap).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'correction_submission_versions_roundNo_check'
  ) THEN
    ALTER TABLE "correction_submission_versions"
      ADD CONSTRAINT "correction_submission_versions_roundNo_check"
      CHECK ("roundNo" >= 1);
  END IF;
END $$;

-- Append-only guarantee: exactly ONE immutable row per (app, stage, round).
CREATE UNIQUE INDEX IF NOT EXISTS "correction_submission_versions_applicationId_stage_roundNo_key"
  ON "correction_submission_versions"("applicationId", "stage", "roundNo");

-- Read path: submissions of one application per stage (history views).
CREATE INDEX IF NOT EXISTS "correction_submission_versions_applicationId_stage_idx"
  ON "correction_submission_versions"("applicationId", "stage");

-- Foreign keys — RESTRICT like the sibling correction_rounds children: a
-- submitted-version row is immutable history and deleting its application or its
-- organization out from under it must be refused, not cascaded. Added through
-- the pg_constraint guard idiom so a re-run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'correction_submission_versions_applicationId_fkey'
  ) THEN
    ALTER TABLE "correction_submission_versions"
      ADD CONSTRAINT "correction_submission_versions_applicationId_fkey"
      FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'correction_submission_versions_organizationId_fkey'
  ) THEN
    ALTER TABLE "correction_submission_versions"
      ADD CONSTRAINT "correction_submission_versions_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
