-- =============================================================================
-- Pre-Migration Duplicate Check Script
-- Run BEFORE: npx prisma migrate deploy
-- Purpose: Ensure @unique constraints won't fail on existing data
-- =============================================================================

-- 1. Check duplicate gatewayRef in payment_transactions
SELECT 'payment_transactions.gatewayRef duplicates:' AS check_name;
SELECT "gatewayRef", COUNT(*) AS cnt
FROM payment_transactions
WHERE "gatewayRef" IS NOT NULL
GROUP BY "gatewayRef"
HAVING COUNT(*) > 1;

-- 2. Check duplicate qrCode in trace_qr_security
SELECT 'trace_qr_security.qrCode duplicates:' AS check_name;
SELECT "qrCode", COUNT(*) AS cnt
FROM trace_qr_security
WHERE "qrCode" IS NOT NULL
GROUP BY "qrCode"
HAVING COUNT(*) > 1;

-- 3. Check duplicate publicUrl in trace_qr_security
SELECT 'trace_qr_security.publicUrl duplicates:' AS check_name;
SELECT "publicUrl", COUNT(*) AS cnt
FROM trace_qr_security
GROUP BY "publicUrl"
HAVING COUNT(*) > 1;

-- =============================================================================
-- If ANY of the above return rows, you must deduplicate BEFORE running migration.
-- 
-- Example dedup for gatewayRef (keeps the latest record):
--
--   DELETE FROM payment_transactions
--   WHERE id NOT IN (
--     SELECT DISTINCT ON ("gatewayRef") id
--     FROM payment_transactions
--     WHERE "gatewayRef" IS NOT NULL
--     ORDER BY "gatewayRef", "createdAt" DESC
--   )
--   AND "gatewayRef" IS NOT NULL
--   AND "gatewayRef" IN (
--     SELECT "gatewayRef" FROM payment_transactions
--     WHERE "gatewayRef" IS NOT NULL
--     GROUP BY "gatewayRef" HAVING COUNT(*) > 1
--   );
-- =============================================================================
