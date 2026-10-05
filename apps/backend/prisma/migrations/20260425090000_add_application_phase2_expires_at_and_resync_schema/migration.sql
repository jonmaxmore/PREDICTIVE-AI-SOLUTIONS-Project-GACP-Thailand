-- ============================================================================
-- Resync Application schema with actual DB columns + add missing field
--
-- Background:
--   The Prisma model previously declared a `state` column (which was never
--   created via migration) and was missing `phase1Status`, `phase2Status`,
--   `phase2ExpiresAt` (which the application code in services/payment-service-*
--   and routes/api/applications/* relies on).
--
--   This migration adds the missing `phase2ExpiresAt` column. The other fields
--   (`status`, `phase1Status`, `phase2Status`, `phase1ExpiresAt`) already exist
--   in the DB from earlier migrations:
--     - 20260110020726_add_system_config (status, phase1Status, phase2Status)
--     - 20260222072000_reconcile_schema_backlog_for_preview_regression (phase1ExpiresAt)
--
--   The schema file in this same commit (apps/backend/prisma/schema/application.prisma)
--   is updated to remove the dead `state` field and declare the actual columns
--   so `prisma generate` produces a Client that matches reality.
-- ============================================================================

ALTER TABLE "applications"
    ADD COLUMN IF NOT EXISTS "phase2ExpiresAt" TIMESTAMP(3);

-- Index used by routes/api/applications listing/tracking queries.
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "applications"("status");

-- Defensive: in any environment that accidentally had a `state` column created
-- (e.g. a previous `prisma db push` that bypassed migrations), drop it so the
-- schema/Client/DB tuple stays in sync.
ALTER TABLE "applications" DROP COLUMN IF EXISTS "state";
