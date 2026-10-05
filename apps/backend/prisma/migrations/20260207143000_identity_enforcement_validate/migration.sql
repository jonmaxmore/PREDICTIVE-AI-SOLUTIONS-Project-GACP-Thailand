-- Identity enforcement finalization for MOPH model
-- Goal:
--   1) normalize legacy farmer role casing
--   2) move legacy HEALTH_ID rows without healthId to EMAIL_LEGACY
--   3) validate identity constraints
--
-- Rollback notes:
--   - role casing rollback:
--       UPDATE "users" SET "role"='farmer' WHERE "id" IN (...);
--   - authType rollback for specific rows:
--       UPDATE "users" SET "authType"='HEALTH_ID' WHERE "id" IN (...);
--   - constraint validation rollback is not needed; constraints can be dropped if required:
--       ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_auth_type_identity_ck";
--       ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_single_identity_ck";

UPDATE "users"
SET "role" = 'FARMER'
WHERE lower("role") = 'farmer';

UPDATE "users"
SET "authType" = 'EMAIL_LEGACY'
WHERE "authType" = 'HEALTH_ID'
  AND "healthId" IS NULL
  AND "providerId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_single_identity_ck'
  ) THEN
    ALTER TABLE "users" VALIDATE CONSTRAINT "users_single_identity_ck";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_type_identity_ck'
  ) THEN
    ALTER TABLE "users" VALIDATE CONSTRAINT "users_auth_type_identity_ck";
  END IF;
END $$;
