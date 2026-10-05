-- AlterTable: Add unique constraints for audit issues M-016/M-017
-- Date: 2026-03-06
-- 
-- PREREQUISITE: Run pre-migration-dedup-check.sql first!
-- If duplicates exist, deduplicate data before applying this migration.

-- PaymentTransaction.gatewayRef: prevent duplicate webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_gatewayRef_key"
ON "payment_transactions" ("gatewayRef")
WHERE "gatewayRef" IS NOT NULL;

-- TraceQrSecurity.qrCode: prevent ambiguous QR resolution
CREATE UNIQUE INDEX IF NOT EXISTS "trace_qr_security_qrCode_key"
ON "trace_qr_security" ("qrCode")
WHERE "qrCode" IS NOT NULL;

-- TraceQrSecurity.publicUrl: prevent duplicate verification URLs
CREATE UNIQUE INDEX IF NOT EXISTS "trace_qr_security_publicUrl_key"
ON "trace_qr_security" ("publicUrl");
