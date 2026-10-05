-- AddCanonicalId
-- Adds canonicalId column to users table
-- This is the canonical system ID used for all foreign keys

-- Step 1: Add canonicalId column (nullable first to populate)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "canonicalId" TEXT;

-- Step 2: Populate from healthId (for HEALTH users) or providerId (for PROVIDER users)
UPDATE "users" SET "canonicalId" = "healthId" WHERE "healthId" IS NOT NULL AND "canonicalId" IS NULL;
UPDATE "users" SET "canonicalId" = "providerId" WHERE "providerId" IS NOT NULL AND "canonicalId" IS NULL;
UPDATE "users" SET "canonicalId" = id WHERE "canonicalId" IS NULL;

-- Step 3: Make NOT NULL now that all rows have values
ALTER TABLE "users" ALTER COLUMN "canonicalId" SET NOT NULL;

-- Step 4: Create unique constraint and index
CREATE UNIQUE INDEX IF NOT EXISTS "users_canonicalId_key" ON "users"("canonicalId");
CREATE INDEX IF NOT EXISTS "users_canonicalId_idx" ON "users"("canonicalId");

-- Step 5: Also add system_config if not exists
CREATE TABLE IF NOT EXISTS "system_config" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_config_key_key" ON "system_config"("key");

-- Step 6: Rename legacy columns to match Prisma @map directives
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'idCard_deprecated') THEN
        ALTER TABLE "users" RENAME COLUMN "idCard" TO "idCard_deprecated";
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'idCardHash_deprecated') THEN
        ALTER TABLE "users" RENAME COLUMN "idCardHash" TO "idCardHash_deprecated";
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
