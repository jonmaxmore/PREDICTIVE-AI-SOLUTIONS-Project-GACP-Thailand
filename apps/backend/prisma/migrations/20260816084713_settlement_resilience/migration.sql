-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "stripe_webhook_events" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'RECEIVED';

-- CreateIndex
CREATE INDEX "stripe_webhook_events_status_nextRetryAt_idx" ON "stripe_webhook_events"("status", "nextRetryAt");

-- Partial unique index: at most one LIVE settlement journal entry per order.
-- Reversals carry a different sourceType, so they are not blocked by this index.
CREATE UNIQUE INDEX "journal_entries_settlement_once"
  ON "journal_entries"("sourceId")
  WHERE "isDeleted" = false AND "sourceType" = 'CHECKOUT_SETTLEMENT';

-- Backfill: existing webhook events default to 'RECEIVED' via the column
-- DEFAULT above; rows already processed should read 'PROCESSED' instead.
UPDATE "stripe_webhook_events" SET "status" = 'PROCESSED' WHERE "processedAt" IS NOT NULL;
