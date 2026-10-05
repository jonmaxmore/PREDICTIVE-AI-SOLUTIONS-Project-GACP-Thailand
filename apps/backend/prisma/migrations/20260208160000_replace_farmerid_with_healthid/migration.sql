-- Migration: Replace farmerId with healthId in applications/invoices
-- Context: MOPH identity model (Farmer = healthId)
--
-- Rollback (manual):
--  1) Add columns back:
--       ALTER TABLE "applications" ADD COLUMN "farmerId" TEXT;
--       ALTER TABLE "invoices" ADD COLUMN "farmerId" TEXT;
--  2) Backfill from users.id via healthId:
--       UPDATE "applications" a SET "farmerId" = u.id FROM "users" u WHERE a."healthId" = u."healthId";
--       UPDATE "invoices" i SET "farmerId" = u.id FROM "users" u WHERE i."healthId" = u."healthId";
--  3) Restore FK/index then optionally drop healthId columns.

BEGIN;

-- -----------------------------------------------------------------------------
-- applications: farmerId -> healthId
-- -----------------------------------------------------------------------------
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "healthId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'applications'
      AND column_name = 'farmerId'
  ) THEN
    UPDATE "applications" a
    SET "healthId" = u."healthId"
    FROM "users" u
    WHERE a."farmerId" = u."id"
      AND a."healthId" IS NULL;
  END IF;
END $$;

DO $$
DECLARE missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM "applications"
  WHERE "healthId" IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate applications.farmerId to healthId: % rows unresolved', missing_count;
  END IF;
END $$;

ALTER TABLE "applications" ALTER COLUMN "healthId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_healthId_fkey'
  ) THEN
    ALTER TABLE "applications"
      ADD CONSTRAINT "applications_healthId_fkey"
      FOREIGN KEY ("healthId") REFERENCES "users"("healthId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "applications_healthId_idx" ON "applications"("healthId");

DROP INDEX IF EXISTS "applications_farmerId_idx";
ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "applications_farmerId_fkey";
ALTER TABLE "applications" DROP COLUMN IF EXISTS "farmerId";

-- -----------------------------------------------------------------------------
-- invoices: farmerId -> healthId
-- -----------------------------------------------------------------------------
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "healthId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'farmerId'
  ) THEN
    UPDATE "invoices" i
    SET "healthId" = u."healthId"
    FROM "users" u
    WHERE i."farmerId" = u."id"
      AND i."healthId" IS NULL;
  END IF;
END $$;

-- fallback from application relation if needed
UPDATE "invoices" i
SET "healthId" = a."healthId"
FROM "applications" a
WHERE i."applicationId" = a."id"
  AND i."healthId" IS NULL;

DO $$
DECLARE missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM "invoices"
  WHERE "healthId" IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate invoices.farmerId to healthId: % rows unresolved', missing_count;
  END IF;
END $$;

ALTER TABLE "invoices" ALTER COLUMN "healthId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_healthId_fkey'
  ) THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_healthId_fkey"
      FOREIGN KEY ("healthId") REFERENCES "users"("healthId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoices_healthId_idx" ON "invoices"("healthId");

DROP INDEX IF EXISTS "invoices_farmerId_idx";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_farmerId_fkey";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "farmerId";

COMMIT;
