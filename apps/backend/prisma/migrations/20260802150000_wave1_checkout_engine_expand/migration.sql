-- Wave 1 EXPAND — single lump-sum checkout engine
-- (docs/payment-refactor/step2-data-model-design.md v2, approved).
--
-- Creates the four checkout-engine tables beside the existing two-step
-- schema. EXPAND only: nothing is dropped or altered; the two-step columns
-- stay frozen until Wave 4 (drain-then-purge, executive decision D2).
--
-- String + CHECK (executive decision R1): every state column carries a CHECK
-- constraint mirroring the frozen JS vocabulary (shared/checkout-status.js,
-- shared/dtam-remittance-status.js), and the itemized breakdown's arithmetic
-- is enforced in the database so a drifted writer cannot persist a total
-- that disagrees with its parts.
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "checkout_documents";
--   DROP TABLE IF EXISTS "stripe_webhook_events";
--   ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_remittanceBatchId_fkey";
--   DROP TABLE IF EXISTS "dtam_remittance_batches";
--   DROP TABLE IF EXISTS "checkout_orders";

BEGIN;

-- ── checkout_orders ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "checkout_orders" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "applicationId" TEXT,
  "subscriptionId" TEXT,
  "milestone" TEXT NOT NULL,
  "dtam_fee_amount" DECIMAL(15,2) NOT NULL,
  "platform_fee_net" DECIMAL(15,2) NOT NULL,
  "platform_fee_vat" DECIMAL(15,2) NOT NULL,
  "platform_fee_gross" DECIMAL(15,2) NOT NULL,
  "total_payable_amount" DECIMAL(15,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  "stripe_payment_intent_id" TEXT,
  "expiresAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "invoiceId" TEXT,
  "paymentTransactionId" TEXT,
  "dtam_remittance_status" TEXT,
  "remittanceBatchId" TEXT,
  "organizationId" TEXT NOT NULL,

  CONSTRAINT "checkout_orders_pkey" PRIMARY KEY ("id"),

  -- R1: the DB refuses what the JS vocabulary refuses.
  CONSTRAINT "checkout_orders_status_check" CHECK (
    "status" IN ('PENDING_PAYMENT', 'SETTLED', 'EXPIRED', 'CANCELLED')
  ),
  CONSTRAINT "checkout_orders_milestone_check" CHECK (
    "milestone" IN ('M1', 'M2')
  ),
  CONSTRAINT "checkout_orders_dtam_remittance_status_check" CHECK (
    "dtam_remittance_status" IS NULL
    OR "dtam_remittance_status" IN ('PENDING', 'BATCHED', 'REMITTED', 'RECONCILED')
  ),

  -- The itemized breakdown must always add up.
  CONSTRAINT "checkout_orders_gross_arithmetic_check" CHECK (
    "platform_fee_gross" = "platform_fee_net" + "platform_fee_vat"
  ),
  CONSTRAINT "checkout_orders_total_arithmetic_check" CHECK (
    "total_payable_amount" = "dtam_fee_amount" + "platform_fee_gross"
  ),
  CONSTRAINT "checkout_orders_amounts_nonnegative_check" CHECK (
    "dtam_fee_amount" >= 0 AND "platform_fee_net" >= 0 AND "platform_fee_vat" >= 0
  ),

  -- Exactly one payment target.
  CONSTRAINT "checkout_orders_target_xor_check" CHECK (
    ("applicationId" IS NOT NULL AND "subscriptionId" IS NULL)
    OR ("applicationId" IS NULL AND "subscriptionId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_orders_stripe_payment_intent_id_key"
  ON "checkout_orders"("stripe_payment_intent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_orders_invoiceId_key"
  ON "checkout_orders"("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_orders_paymentTransactionId_key"
  ON "checkout_orders"("paymentTransactionId");

-- One OPEN checkout per (target, milestone): re-entry re-uses the pending
-- order instead of minting a sibling. Partial unique index — not
-- PSL-representable, so it lives only here.
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_orders_open_per_application_milestone_key"
  ON "checkout_orders"("applicationId", "milestone")
  WHERE "status" = 'PENDING_PAYMENT' AND "applicationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_orders_open_per_subscription_milestone_key"
  ON "checkout_orders"("subscriptionId", "milestone")
  WHERE "status" = 'PENDING_PAYMENT' AND "subscriptionId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "checkout_orders_applicationId_idx" ON "checkout_orders"("applicationId");
CREATE INDEX IF NOT EXISTS "checkout_orders_status_idx" ON "checkout_orders"("status");
CREATE INDEX IF NOT EXISTS "checkout_orders_dtam_remittance_status_idx" ON "checkout_orders"("dtam_remittance_status");
CREATE INDEX IF NOT EXISTS "checkout_orders_remittanceBatchId_idx" ON "checkout_orders"("remittanceBatchId");
CREATE INDEX IF NOT EXISTS "checkout_orders_organizationId_idx" ON "checkout_orders"("organizationId");

-- ── dtam_remittance_batches ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "dtam_remittance_batches" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "totalAmount" DECIMAL(15,2) NOT NULL,
  "remittedAt" TIMESTAMP(3),
  "bankReference" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "journalEntryId" TEXT,
  "organizationId" TEXT NOT NULL,

  CONSTRAINT "dtam_remittance_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dtam_remittance_batches_status_check" CHECK (
    "status" IN ('OPEN', 'REMITTED', 'RECONCILED')
  ),
  CONSTRAINT "dtam_remittance_batches_total_nonnegative_check" CHECK (
    "totalAmount" >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "dtam_remittance_batches_batchNumber_key"
  ON "dtam_remittance_batches"("batchNumber");
CREATE INDEX IF NOT EXISTS "dtam_remittance_batches_status_idx" ON "dtam_remittance_batches"("status");
CREATE INDEX IF NOT EXISTS "dtam_remittance_batches_organizationId_idx" ON "dtam_remittance_batches"("organizationId");

-- ── stripe_webhook_events ──────────────────────────────────────────────────
-- The idempotency lock: the handler inserts first; a unique-violation on the
-- Stripe event id (the PK) means a redelivery → 200 no-op.

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,

  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_type_idx" ON "stripe_webhook_events"("type");
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_receivedAt_idx" ON "stripe_webhook_events"("receivedAt");

-- ── checkout_documents ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "checkout_documents" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkoutOrderId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "pdfPath" TEXT,
  "signedAt" TIMESTAMP(3),
  "organizationId" TEXT NOT NULL,

  CONSTRAINT "checkout_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_documents_documentType_check" CHECK (
    "documentType" IN ('PLATFORM_TAX_INVOICE', 'DTAM_DISBURSAL_RECEIPT')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_documents_documentNumber_key"
  ON "checkout_documents"("documentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_documents_checkoutOrderId_documentType_key"
  ON "checkout_documents"("checkoutOrderId", "documentType");
CREATE INDEX IF NOT EXISTS "checkout_documents_organizationId_idx" ON "checkout_documents"("organizationId");

-- ── Foreign keys ───────────────────────────────────────────────────────────

ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_paymentTransactionId_fkey"
  FOREIGN KEY ("paymentTransactionId") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_remittanceBatchId_fkey"
  FOREIGN KEY ("remittanceBatchId") REFERENCES "dtam_remittance_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dtam_remittance_batches" ADD CONSTRAINT "dtam_remittance_batches_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "checkout_documents" ADD CONSTRAINT "checkout_documents_checkoutOrderId_fkey"
  FOREIGN KEY ("checkoutOrderId") REFERENCES "checkout_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_documents" ADD CONSTRAINT "checkout_documents_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
