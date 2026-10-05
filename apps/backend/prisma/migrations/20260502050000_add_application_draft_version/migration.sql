-- Add optimistic-concurrency `version` column to application_drafts.
--
-- Why: prevents silent data loss when an applicant has the wizard
-- open in two browser tabs and both tabs auto-save. Without this,
-- the upsert in saveDraft is last-write-wins; with this, the
-- second save returns 409 and the UI can surface a conflict
-- prompt. Backend increments on every successful update; client
-- echoes back the version it loaded.
--
-- Backfill: existing rows get version=1 (the default). Clients
-- that haven't refreshed yet will send no expectedVersion and the
-- handler falls back to a plain upsert — backward-compatible
-- during the rollout window. Once main + deploy/production are
-- in lockstep, all clients send expectedVersion.
--
-- Idempotent guard: re-running this migration on a DB that already
-- has the column is a no-op.

ALTER TABLE "application_drafts"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
