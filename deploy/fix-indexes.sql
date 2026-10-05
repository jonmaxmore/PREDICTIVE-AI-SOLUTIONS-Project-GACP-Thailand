-- Drop existing unique indexes that Prisma wants to create
-- These were created by a previous migration but Prisma schema doesn't know about them
DROP INDEX IF EXISTS "payment_transactions_gatewayRef_key";
DROP INDEX IF EXISTS "trace_qr_security_qrCode_key";
DROP INDEX IF EXISTS "trace_qr_security_publicUrl_key";
