-- W3-41 Q2-D2 EXPAND — payment reminder dedup ledger.
--
-- Creates payment_reminder_logs beside the Wave-1 checkout tables. EXPAND
-- only: CREATE TABLE + indexes + FKs on the NEW table — nothing existing is
-- altered or dropped.
--
-- Purpose: durable idempotency for the daily payment-reminder sweep
-- (jobs/payment-reminder-job.js). The job INSERTS FIRST; a unique-violation
-- on (invoiceId, reminderType, intendedDate) means the reminder already went
-- out on that intended day → skip silently (same insert-first idiom as
-- stripe_webhook_events). intendedDate is the working-day-SHIFTED send day
-- derived from invoices.dueDate by checkout-schedule-service, so a same-day
-- re-run recomputes the identical key. A DUE_DATE/OVERDUE_NOTICE collision on
-- one working day yields two rows (reminderType is in the key) — both send.
--
-- String + CHECK (executive decision R1): reminderType carries a CHECK
-- mirroring the frozen JS vocabulary (the keys of
-- checkout-schedule-service.computeReminderDates).
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "payment_reminder_logs";

BEGIN;

CREATE TABLE IF NOT EXISTS "payment_reminder_logs" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invoiceId" TEXT NOT NULL,
  "reminderType" TEXT NOT NULL,
  "intendedDate" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "organizationId" TEXT NOT NULL,

  CONSTRAINT "payment_reminder_logs_pkey" PRIMARY KEY ("id"),

  -- R1: the DB refuses what the JS vocabulary refuses.
  CONSTRAINT "payment_reminder_logs_reminderType_check" CHECK (
    "reminderType" IN ('PRE_DUE', 'DUE_DATE', 'OVERDUE_NOTICE')
  )
);

-- The durable dedup key — the sweep's idempotency lock.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reminder_logs_invoiceId_reminderType_intendedDate_key"
  ON "payment_reminder_logs"("invoiceId", "reminderType", "intendedDate");

CREATE INDEX IF NOT EXISTS "payment_reminder_logs_invoiceId_idx"
  ON "payment_reminder_logs"("invoiceId");
CREATE INDEX IF NOT EXISTS "payment_reminder_logs_organizationId_idx"
  ON "payment_reminder_logs"("organizationId");

-- Foreign keys — RESTRICT like the other billing children (payment_slips,
-- checkout_documents): a reminder row is audit trail; deleting its invoice
-- out from under it must be refused, not cascaded.
ALTER TABLE "payment_reminder_logs" ADD CONSTRAINT "payment_reminder_logs_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_reminder_logs" ADD CONSTRAINT "payment_reminder_logs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
