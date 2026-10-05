-- AddAccountTier
-- Adds account_tier column to users table with default 'NORMAL'
-- This enables the Normal/Pro tier system for health users

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accountTier" TEXT NOT NULL DEFAULT 'NORMAL';

-- Create index for efficient tier-based queries
CREATE INDEX IF NOT EXISTS "users_accountTier_idx" ON "users"("accountTier");

-- Set the professional test account to PRO
UPDATE "users" SET "accountTier" = 'PRO' WHERE "healthId" = '4310100001149';
