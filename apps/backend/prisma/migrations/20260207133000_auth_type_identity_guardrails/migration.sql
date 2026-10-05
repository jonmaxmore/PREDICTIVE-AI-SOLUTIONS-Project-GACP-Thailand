-- Auth type identity guardrails (MOPH model)
-- Enforce userType identity semantics at DB level:
--   - HEALTH_ID rows must use healthId and must not include providerId
--   - PROVIDER_ID rows must use providerId and must not include healthId
--   - EMAIL_LEGACY is temporarily allowed for backward compatibility
--
-- NOTE:
-- Added as NOT VALID to avoid breaking legacy rows immediately.
-- Constraint still applies to new/updated rows.

-- Backfill legacy rows to MOPH identity fields to remove FARMER/STAFF mapping.
UPDATE "users" u
SET
  "healthId" = u."idCard",
  "healthIdHash" = COALESCE(u."healthIdHash", u."idCardHash"),
  "authType" = 'HEALTH_ID'
WHERE
  u."role" = 'FARMER'
  AND u."healthId" IS NULL
  AND u."providerId" IS NULL
  AND u."idCard" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" x
    WHERE x."id" <> u."id"
      AND x."healthId" = u."idCard"
  );

UPDATE "users" u
SET
  "providerId" = u."idCard",
  "providerIdHash" = COALESCE(u."providerIdHash", u."idCardHash"),
  "authType" = 'PROVIDER_ID'
WHERE
  u."role" <> 'FARMER'
  AND u."providerId" IS NULL
  AND u."healthId" IS NULL
  AND u."idCard" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "users" x
    WHERE x."id" <> u."id"
      AND x."providerId" = u."idCard"
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_auth_type_identity_ck'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_auth_type_identity_ck"
    CHECK (
      ("authType" = 'HEALTH_ID' AND "healthId" IS NOT NULL AND "providerId" IS NULL)
      OR
      ("authType" = 'PROVIDER_ID' AND "providerId" IS NOT NULL AND "healthId" IS NULL)
      OR
      ("authType" = 'EMAIL_LEGACY')
    )
    NOT VALID;
  END IF;
END $$;
