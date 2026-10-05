-- Subscription scaffolding (2026-04-30)
--
-- Adds the `subscriptions` table and extends `invoices` so the same Invoice
-- shape can settle either an application fee (existing path) or a
-- subscription order (new path). Slip-flow is reused as-is — payment_slips
-- already references invoices, so a slip uploaded against a subscription
-- invoice flows through the same review pipeline as an application slip.
--
-- Real payment-provider integration (Stripe / Omise / Paypal) is out of
-- scope here — the slip-flow IS the payment mechanism for now.

BEGIN;

-- 1. New subscriptions table
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id"             TEXT PRIMARY KEY,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "tier"           TEXT NOT NULL,
    "billingCycle"   TEXT NOT NULL,
    "priceTHB"       DOUBLE PRECISION NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startDate"      TIMESTAMP(3),
    "endDate"        TIMESTAMP(3),
    "cancelledAt"    TIMESTAMP(3),
    "cancelReason"   TEXT,
    "createdBy"      TEXT,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "subscriptions_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "subscriptions_organizationId_status_idx"
    ON "subscriptions" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "subscriptions_endDate_idx"
    ON "subscriptions" ("endDate");

-- 2. invoices.applicationId becomes nullable
ALTER TABLE "invoices" ALTER COLUMN "applicationId" DROP NOT NULL;

-- 3. invoices gets subscriptionId + foreign key
ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT,
    ADD CONSTRAINT "invoices_subscriptionId_fkey"
        FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "invoices_subscriptionId_idx"
    ON "invoices" ("subscriptionId");

-- 4. CHECK constraint — exactly one of {applicationId, subscriptionId}
--    is set on every invoice. Prevents orphan invoices that belong to
--    nothing, and prevents the rare bug where both fields get populated.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_billable_xor_chk"
        CHECK (
            ("applicationId" IS NOT NULL AND "subscriptionId" IS NULL)
         OR ("applicationId" IS NULL     AND "subscriptionId" IS NOT NULL)
        );

-- 5. payment_slips needs the same shape — a slip settles either an
--    application fee or a subscription order, never both.
ALTER TABLE "payment_slips" ALTER COLUMN "applicationId" DROP NOT NULL;
ALTER TABLE "payment_slips"
    ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT,
    ADD CONSTRAINT "payment_slips_subscriptionId_fkey"
        FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "payment_slips_subscriptionId_idx"
    ON "payment_slips" ("subscriptionId");

ALTER TABLE "payment_slips"
    ADD CONSTRAINT "payment_slips_billable_xor_chk"
        CHECK (
            ("applicationId" IS NOT NULL AND "subscriptionId" IS NULL)
         OR ("applicationId" IS NULL     AND "subscriptionId" IS NOT NULL)
        );

COMMIT;
