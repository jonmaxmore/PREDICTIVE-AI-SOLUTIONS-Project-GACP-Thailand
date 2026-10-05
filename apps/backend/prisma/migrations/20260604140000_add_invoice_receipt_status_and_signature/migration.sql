-- B-RCPT-STATUS + B16-A (2026-06-04).
-- (1) Receipt auto-issue status tracking: the slip-approve path issues the
--     receipt asynchronously; failures used to be swallowed silently. These
--     columns make a PENDING/FAILED auto-issue visible to the ACCOUNT queue
--     and retryable. (2) B16-A: signatureMetadata column so the receipt
--     auto-signer can persist the signature (until now it skipped silently
--     because the column did not exist).
-- All additive + nullable (receiptAttempts defaults 0). No data loss.
ALTER TABLE "invoices" ADD COLUMN "receiptStatus" TEXT;
ALTER TABLE "invoices" ADD COLUMN "receiptError" TEXT;
ALTER TABLE "invoices" ADD COLUMN "receiptAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "receiptLastAttemptAt" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "signatureMetadata" JSONB;
