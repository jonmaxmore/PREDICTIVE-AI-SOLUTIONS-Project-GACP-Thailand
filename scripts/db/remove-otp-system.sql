-- Migration: Remove OTP Verification System
-- ลบระบบ OTP เพื่อให้สมัครสมาชิกง่ายขึ้น

-- =============================================================================
-- STEP 1: Drop OTP-related tables
-- =============================================================================

-- Drop OTP codes table if exists
DROP TABLE IF EXISTS "OtpCode";
DROP TABLE IF EXISTS "otp_codes";
DROP TABLE IF EXISTS "SmsLog";
DROP TABLE IF EXISTS "sms_logs";

-- =============================================================================
-- STEP 2: Remove OTP columns from User table
-- =============================================================================

-- Remove phone verification fields (if exists)
ALTER TABLE "User" 
DROP COLUMN IF EXISTS "phoneVerified",
DROP COLUMN IF EXISTS "phoneVerificationCode",
DROP COLUMN IF EXISTS "phoneVerificationExpiry";

-- Keep email verification fields but make them optional
-- (Email verification is still useful but not mandatory)

-- Remove 2FA fields (if not needed)
ALTER TABLE "User"
DROP COLUMN IF EXISTS "twoFactorEnabled",
DROP COLUMN IF EXISTS "twoFactorSecret",
DROP COLUMN IF EXISTS "twoFactorBackupCodes";

-- =============================================================================
-- STEP 3: Update User status enum (if needed)
-- =============================================================================

-- Update users with PENDING_VERIFICATION to ACTIVE
-- Since we remove OTP, users should be active immediately after registration
UPDATE "User"
SET 
  status = 'ACTIVE',
  "updatedAt" = NOW()
WHERE status = 'PENDING_VERIFICATION';

-- =============================================================================
-- STEP 4: Create simplified registration tracking
-- =============================================================================

-- Add registration completed flag (optional)
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "registrationCompleted" BOOLEAN DEFAULT true;

-- Add registration source tracking
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "registrationSource" VARCHAR(50) DEFAULT 'web';

-- =============================================================================
-- STEP 5: Clean up old verification data
-- =============================================================================

-- Clean up expired tokens
UPDATE "User"
SET 
  "emailVerificationToken" = NULL,
  "emailVerificationExpiry" = NULL
WHERE "emailVerificationExpiry" < NOW();

-- =============================================================================
-- STEP 6: Add notes
-- =============================================================================

COMMENT ON TABLE "User" IS 'User accounts - OTP verification removed for easier registration';
COMMENT ON COLUMN "User".status IS 'User status: ACTIVE, SUSPENDED, LOCKED, INACTIVE (removed PENDING_VERIFICATION)';

-- =============================================================================
-- Verification
-- =============================================================================

-- Check User table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'User' 
ORDER BY ordinal_position;

-- Count users by status
SELECT status, COUNT(*) as count 
FROM "User" 
GROUP BY status;
