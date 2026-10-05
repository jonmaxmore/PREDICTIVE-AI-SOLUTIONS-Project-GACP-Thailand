-- Future Phase D from docs/audit/2026-05-01-application-role-column-drift.md.
-- Phase 45 of the Wave A run-out — final drift unwind step.
--
-- Drops the 7 dormant role columns on `applications` along with the 4
-- Phase 17 FK constraints. Applications is left with the 4 canonical
-- role columns added in Phase 42 + Phase 43:
--   auditorId, reviewerId, headAuditorId, schedulerId
-- (each FK to users(id))
--
-- Pre-flight verification on prod 2026-05-01:
--   auditorProviderId       — 0 of 38 rows populated
--   headAuditorProviderId   — 0 of 38 rows populated
--   reviewerProviderId      — 0 of 38 rows populated
--   schedulerProviderId     — 0 of 38 rows populated
--   headAuditorUserId       — 0 of 38 rows populated
--   reviewerUserId          — 0 of 38 rows populated
--   schedulerUserId         — 0 of 38 rows populated
-- (auditorId, the canonical column, has 8 of 38 rows populated and stays.)
--
-- Code surface:
--   - The Phase 44 simplified visibility filter no longer references any
--     of these columns.
--   - No production reader / writer touches them. Verified via grep:
--     the only matches are in formData JSON keys (which are not Prisma
--     column references), a test assertion that the filter does NOT
--     reference them, and a docstring comment in tracked-writer.js.
--
-- The 4 Phase 17 FK constraints must be dropped before the columns
-- because Postgres won't drop a column referenced by an active
-- constraint. Indexes on the dropped columns auto-drop with them.

ALTER TABLE "applications"
    DROP CONSTRAINT IF EXISTS "applications_auditorProviderId_fkey",
    DROP CONSTRAINT IF EXISTS "applications_headAuditorProviderId_fkey",
    DROP CONSTRAINT IF EXISTS "applications_reviewerProviderId_fkey",
    DROP CONSTRAINT IF EXISTS "applications_schedulerProviderId_fkey";

ALTER TABLE "applications"
    DROP COLUMN IF EXISTS "auditorProviderId",
    DROP COLUMN IF EXISTS "headAuditorProviderId",
    DROP COLUMN IF EXISTS "reviewerProviderId",
    DROP COLUMN IF EXISTS "schedulerProviderId",
    DROP COLUMN IF EXISTS "headAuditorUserId",
    DROP COLUMN IF EXISTS "reviewerUserId",
    DROP COLUMN IF EXISTS "schedulerUserId";
