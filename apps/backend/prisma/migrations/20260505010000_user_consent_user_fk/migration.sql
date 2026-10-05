-- T-010 / Subtask 1 (b) — promote `user_consents.userId` from a loose
-- scalar string into a proper foreign key referencing `users.id`.
--
-- Why this matters
-- ----------------
-- UserConsent rows are PDPA audit trail (granted / withdrawn timestamps,
-- IP address, user agent, version-stamped consent text). Without a FK,
-- an orphaned consent row is impossible to verify against the user it
-- claims to represent — exactly the scenario PDPA compliance audits
-- look for. Adding the FK guarantees every consent row points to a
-- real user, and prevents accidental deletion of the parent user
-- without an explicit consent-archival step.
--
-- ON DELETE Restrict (NOT Cascade)
-- --------------------------------
-- Cascade-deleting consent records when the user is deleted would
-- destroy the PDPA audit trail at the worst possible moment — when
-- the user has been removed and someone needs to verify what they
-- consented to. Restrict makes the operator explicit: archive or
-- migrate consents first, THEN delete the user.
--
-- The codebase soft-deletes users via `User.isDeleted` /
-- `User.legalHold` / `User.retainUntil`, so this Restrict is mostly
-- a belt-and-suspenders guard against accidental hard-delete via
-- prisma.user.delete() in admin tooling.
--
-- Pre-migration data check (run on prod before applying):
--
--   SELECT count(*) FROM "user_consents" uc
--   WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = uc."userId");
--   → must be 0 (otherwise dedupe / archive orphans first)
--
-- The userId column is NOT NULL — there is no "skip if NULL" path on
-- this FK; every existing row must have a valid User.id. The
-- pre-migration check above is mandatory.
--
-- Idempotency note (matches 20260430200000_add_application_role_fks
-- pattern): re-runs on partially-migrated environments are no-ops.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'user_consents'
          AND constraint_name = 'user_consents_userId_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "user_consents"
        ADD CONSTRAINT "user_consents_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES "users"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    END IF;
END $$;
