-- Future Phase B from docs/audit/2026-05-01-application-role-column-drift.md.
-- Phase 43 of the Wave A run-out.
--
-- Adds FK constraints to the four canonical role columns on `applications`
-- (reviewerId, headAuditorId, schedulerId, auditorId), each referencing
-- users(id).
--
-- Pre-flight verification on prod 2026-05-01:
--   reviewerId / headAuditorId / schedulerId   — all 0 of 38 rows populated
--   auditorId                                  — 8 of 38 rows populated, 0 orphans
--                                                (every value matches an existing users.id)
--
-- Adding the FK is safe because:
--   1. Empty columns can't have orphans by definition.
--   2. The single populated column was already verified orphan-free.
--
-- ON DELETE SET NULL: deleting a user clears the assignment without
-- breaking the application audit trail. Matches the policy used on the
-- Phase 17 *ProviderId FK constraints (which stay in place — Phase D
-- drops them).

ALTER TABLE "applications"
    ADD CONSTRAINT "applications_reviewerId_fkey"
        FOREIGN KEY ("reviewerId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "applications_headAuditorId_fkey"
        FOREIGN KEY ("headAuditorId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "applications_schedulerId_fkey"
        FOREIGN KEY ("schedulerId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "applications_auditorId_fkey"
        FOREIGN KEY ("auditorId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
