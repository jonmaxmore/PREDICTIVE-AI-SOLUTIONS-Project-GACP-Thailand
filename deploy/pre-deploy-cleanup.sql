-- Pre-deploy cleanup for GACP Canonical Identity Refactor
-- Date: 2026-04-04

-- Step 1: Verify data in duplicate columns matches before dropping
-- consentedpdpa (lowercase) has same data as consentedPDPA (camelCase)
-- certificationpurpose/previouscertnumber lowercase columns have 0 data

-- Step 2: Drop the duplicate lowercase columns (created by previous migrations)
ALTER TABLE applications DROP COLUMN IF EXISTS consentedpdpa;
ALTER TABLE applications DROP COLUMN IF EXISTS certificationpurpose;
ALTER TABLE applications DROP COLUMN IF EXISTS previouscertnumber;

-- Step 3: Also drop old role columns that schema renamed
-- (auditorId -> auditorProviderId, status -> state, etc.)
-- Check which old columns still exist
SELECT column_name FROM information_schema.columns 
WHERE table_name='applications' 
AND column_name IN ('status', 'phase1Status', 'phase2Status', 'auditorId', 'reviewerUserId', 'schedulerUserId', 'headAuditorUserId')
ORDER BY column_name;
