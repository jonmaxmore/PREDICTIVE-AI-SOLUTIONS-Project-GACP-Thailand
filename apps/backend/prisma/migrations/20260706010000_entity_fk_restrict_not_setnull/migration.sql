-- FIX #12 (carpet-bomb-inversion audit 2026-07-06) — flip the Entity FK on
-- `applications.entityId` and `farms.entityId` from ON DELETE SET NULL to
-- ON DELETE RESTRICT.
--
-- Why this matters
-- ----------------
-- With ON DELETE SET NULL, deleting an Entity silently NULLs the `entityId` of
-- every application/farm it owned. The health-side read-scope is null-intolerant
-- (tenant-prisma-extension ANDs `entityId = <personalEntityId>` on every read), so
-- a re-nulled row becomes INVISIBLE to its own owner — an unhealable orphan
-- (the auto-heal only runs AFTER a row is found, so it can never fire). RESTRICT
-- is the correct data-safety behavior: it blocks a FUTURE delete of an Entity that
-- still owns apps/farms (operator must archive/reassign them first) instead of
-- silently orphaning them.
--
-- Safety
-- ------
-- Verified on prod+staging: 0 rows with a dangling/NULL entityId, and no app code
-- ever re-NULLs entityId. The OLD FK already enforced referential integrity, so
-- every existing non-NULL entityId already references a live entities.id — re-adding
-- the constraint validates cleanly. This migration only changes the ON DELETE
-- ACTION; it reads/writes NO row data and is non-destructive to any paid/cert data.
--
-- Idempotency
-- -----------
-- Drop-if-exists then re-add. Re-runs on a partially/fully-migrated DB are no-ops
-- (the RESTRICT constraint is dropped and re-created identically). Matches the
-- guarded-FK style of 20260505020000_certificate_farm_fk.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'applications'
          AND constraint_name = 'applications_entityId_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "applications" DROP CONSTRAINT "applications_entityId_fkey";
    END IF;

    ALTER TABLE "applications"
        ADD CONSTRAINT "applications_entityId_fkey"
        FOREIGN KEY ("entityId")
        REFERENCES "entities"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'farms'
          AND constraint_name = 'farms_entityId_fkey'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE "farms" DROP CONSTRAINT "farms_entityId_fkey";
    END IF;

    ALTER TABLE "farms"
        ADD CONSTRAINT "farms_entityId_fkey"
        FOREIGN KEY ("entityId")
        REFERENCES "entities"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
END $$;

COMMIT;
