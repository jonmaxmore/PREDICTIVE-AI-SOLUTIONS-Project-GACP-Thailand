-- Migration: Add MOPH Health ID and Provider ID Support
-- Description: Add fields for Ministry of Public Health authentication standards

-- Add new authentication fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authType" TEXT NOT NULL DEFAULT 'HEALTH_ID';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "healthId" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "healthIdHash" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "providerId" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "providerIdHash" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ministryVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ministryVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mophToken" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mophTokenExpiry" TIMESTAMP(3);

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS "users_healthId_idx" ON "users"("healthId");
CREATE INDEX IF NOT EXISTS "users_providerId_idx" ON "users"("providerId");
CREATE INDEX IF NOT EXISTS "users_authType_idx" ON "users"("authType");
CREATE INDEX IF NOT EXISTS "users_ministryVerified_idx" ON "users"("ministryVerified");

-- Migrate existing data: Copy idCard to healthId for FARMER role
UPDATE "users" 
SET "healthId" = "idCard", 
    "healthIdHash" = "idCardHash",
    "authType" = 'HEALTH_ID'
WHERE "role" = 'FARMER' AND "idCard" IS NOT NULL;

-- Migrate existing data: Copy idCard to providerId for STAFF roles
UPDATE "users" 
SET "providerId" = "idCard", 
    "providerIdHash" = "idCardHash",
    "authType" = 'PROVIDER_ID'
WHERE "role" IN ('REVIEWER_AUDITOR', 'SCHEDULER', 'ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN') 
  AND "idCard" IS NOT NULL;

-- Set EMAIL_LEGACY for users with only email (no idCard)
UPDATE "users" 
SET "authType" = 'EMAIL_LEGACY'
WHERE "idCard" IS NULL AND "email" IS NOT NULL;
