-- Future Phase A from docs/audit/2026-05-01-application-role-column-drift.md.
-- Phase 42 of the Wave A run-out.
--
-- Adds three canonical role columns to `applications`:
--   reviewerId      → User.id (FK constraint added in Phase B)
--   headAuditorId   → User.id (FK constraint added in Phase B)
--   schedulerId     → User.id (FK constraint added in Phase B)
--
-- No backfill: production check on 2026-05-01 shows that
-- formData->'PROVIDERAssignment' is null on every one of the 38 rows.
-- There is no source data to migrate. The Phase 17 *ProviderId columns
-- are also all null (verified in the drift analysis doc).
--
-- This migration is purely additive. The existing 7 unused role
-- columns (`*ProviderId` from Phase 17 and `*UserId` from Phase 21) stay
-- in place for now and are dropped in Phase D.

ALTER TABLE "applications"
    ADD COLUMN "reviewerId"     TEXT,
    ADD COLUMN "headAuditorId"  TEXT,
    ADD COLUMN "schedulerId"    TEXT;

CREATE INDEX "applications_reviewerId_idx"
    ON "applications" ("reviewerId");
CREATE INDEX "applications_headAuditorId_idx"
    ON "applications" ("headAuditorId");
CREATE INDEX "applications_schedulerId_idx"
    ON "applications" ("schedulerId");
