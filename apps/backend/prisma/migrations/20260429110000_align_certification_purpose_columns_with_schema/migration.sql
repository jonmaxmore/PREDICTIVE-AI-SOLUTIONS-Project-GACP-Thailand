-- =============================================================================
-- Reconcile schema gap: certificationPurpose / certificationPurposes
-- =============================================================================
-- Both columns are declared in apps/backend/prisma/schema/application.prisma
-- but no prior migration creates them — production picked them up via
-- `prisma db push` / direct ALTER TABLE in an earlier (untracked) ops cycle.
--
-- Fresh databases (CI Test job + Migration Drift Check shadow DB) therefore
-- never had these columns, which made:
--   1. `prisma migrate diff --from-migrations --to-schema-datamodel` exit
--      non-zero (drift detected — schema has columns migrations don't create)
--   2. The legacy `manual/migration.sql` data-backfill crash with
--      "column \"certificationPurpose\" does not exist".
--
-- This migration brings the migrations folder back in sync with schema.prisma.
-- Both ADDs are guarded with IF NOT EXISTS so production (where the columns
-- already exist) sees a no-op.
--
-- Companion change in this PR: `manual/migration.sql` is now idempotent — it
-- skips the UPDATE when the legacy column is absent. Together these unblock
-- both Test and Migration Drift Check on fresh CI databases.
-- =============================================================================

ALTER TABLE "applications"
    ADD COLUMN IF NOT EXISTS "certificationPurpose" TEXT,
    ADD COLUMN IF NOT EXISTS "certificationPurposes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
