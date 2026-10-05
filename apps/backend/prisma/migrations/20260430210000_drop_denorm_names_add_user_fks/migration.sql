-- Wave A Phase 18 (G15 final) — replace denormalized auditor/host name
-- strings with proper FK relations to `users.id`.
--
-- Pre-migration check (run on prod 2026-04-30 before this migration):
--   SELECT count(*) FROM audit_checklists; → 0
--   SELECT count(*) FROM scope_of_works;   → 0
--   SELECT count(*) FROM meeting_rooms;    → 0
-- All three tables are empty in production. The DROP COLUMN + ADD CONSTRAINT
-- combo is therefore zero-risk for existing data. If data ever lands here
-- before this migration, the auditorId/assignedAuditorId/hostId references
-- must already point at valid users (the controllers wrote them that way),
-- so the FK adds will still succeed.
--
-- Why drop the denorm name columns:
--   The audit identified these as stale-data sources — admin renames a
--   user, all historical checklists keep showing the old name. The fix
--   is to compute the display name from the relation each time. See
--   controllers/{audit-checklist,sow,meeting}-controller.js for the
--   include + post-mapper that preserves the existing API contract.

-- AuditChecklist: drop auditorName, add FK on auditorId
ALTER TABLE "audit_checklists" DROP COLUMN IF EXISTS "auditorName";
ALTER TABLE "audit_checklists"
    ADD CONSTRAINT "audit_checklists_auditorId_fkey"
        FOREIGN KEY ("auditorId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ScopeOfWork: drop assignedAuditor, add FK on assignedAuditorId
ALTER TABLE "scope_of_works" DROP COLUMN IF EXISTS "assignedAuditor";
ALTER TABLE "scope_of_works"
    ADD CONSTRAINT "scope_of_works_assignedAuditorId_fkey"
        FOREIGN KEY ("assignedAuditorId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "scope_of_works_assignedAuditorId_idx"
    ON "scope_of_works" ("assignedAuditorId");

-- MeetingRoom: drop hostName, add FK on hostId
ALTER TABLE "meeting_rooms" DROP COLUMN IF EXISTS "hostName";
ALTER TABLE "meeting_rooms"
    ADD CONSTRAINT "meeting_rooms_hostId_fkey"
        FOREIGN KEY ("hostId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "meeting_rooms_hostId_idx"
    ON "meeting_rooms" ("hostId");
