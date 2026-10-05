-- Wave A Phase 17 (G15) — promote the four `*ProviderId` columns on the
-- `applications` table from loose strings into proper foreign keys
-- referencing `users.providerId`.
--
-- Pre-migration check (run on prod 2026-04-30):
--   SELECT count(*) FROM applications a
--   WHERE a."reviewerProviderId" IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM users u WHERE u."providerId" = a."reviewerProviderId");
--   → 0 (and same for the other 3 columns)
--
-- Adding these FKs unlocks Prisma `include: { reviewer: true }` so callers
-- don't need a follow-up findFirst to get reviewer details. The columns
-- themselves keep the same name and nullability — purely additive at the
-- DB level.
--
-- onDelete: SET NULL is the right call here because deleting a provider
-- shouldn't break the application audit trail; we just clear the pointer.
-- onUpdate: CASCADE follows Prisma's default for FK relations.
--
-- Idempotency note (Phase 65 / 2026-05-01): the four `*ProviderId` columns
-- were created by a long-since-squashed pre-Wave-A migration, then dropped
-- by 20260501090000_drop_dormant_role_columns. On a fresh database (CI
-- Test job, local `prisma migrate deploy` from scratch) the columns no
-- longer exist by the time this migration runs, so the raw `ALTER TABLE
-- ADD CONSTRAINT` calls error with `column "reviewerProviderId" does not
-- exist`. The fix wraps the FK additions in a column-existence guard so
-- the migration is a no-op on fresh DBs (where the column-drop migration
-- below also no-ops on the same condition) and unchanged on production
-- (where the columns exist at apply-time). Net effect: production sees
-- the same FK additions, fresh DBs see no-ops on both this and the drop
-- migration, schema converges to the same final state either way.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'applications'
          AND column_name = 'reviewerProviderId'
    ) THEN
        ALTER TABLE "applications"
            ADD CONSTRAINT "applications_reviewerProviderId_fkey"
                FOREIGN KEY ("reviewerProviderId") REFERENCES "users"("providerId")
                ON DELETE SET NULL ON UPDATE CASCADE,
            ADD CONSTRAINT "applications_headAuditorProviderId_fkey"
                FOREIGN KEY ("headAuditorProviderId") REFERENCES "users"("providerId")
                ON DELETE SET NULL ON UPDATE CASCADE,
            ADD CONSTRAINT "applications_schedulerProviderId_fkey"
                FOREIGN KEY ("schedulerProviderId") REFERENCES "users"("providerId")
                ON DELETE SET NULL ON UPDATE CASCADE,
            ADD CONSTRAINT "applications_auditorProviderId_fkey"
                FOREIGN KEY ("auditorProviderId") REFERENCES "users"("providerId")
                ON DELETE SET NULL ON UPDATE CASCADE;

        -- Existing single-column index on auditorProviderId stays. Add
        -- explicit indexes for the other three so the FK lookups join
        -- efficiently. CREATE INDEX IF NOT EXISTS handles re-applies.
        CREATE INDEX IF NOT EXISTS "applications_reviewerProviderId_idx"
            ON "applications" ("reviewerProviderId");
        CREATE INDEX IF NOT EXISTS "applications_headAuditorProviderId_idx"
            ON "applications" ("headAuditorProviderId");
        CREATE INDEX IF NOT EXISTS "applications_schedulerProviderId_idx"
            ON "applications" ("schedulerProviderId");
    END IF;
END $$;
