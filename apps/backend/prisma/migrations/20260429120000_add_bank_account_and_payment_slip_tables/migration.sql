-- =============================================================================
-- Add BankAccount + PaymentSlip tables for the slip-flow payment redesign
-- =============================================================================
--
-- Background: replaces gateway/webhook payment integration with manual
-- bank-transfer + slip-upload + ACCOUNT-team review. See:
--   docs/architecture/2026-04-29-rfc-payment-slip-flow.md
--
-- This migration is the Phase 1 schema change (no data migrations, no state
-- transitions yet). Phase 1 is split across THREE migrations:
--
--   1. THIS FILE — CREATE TABLE bank_accounts + payment_slips, ADD COLUMN
--                  applications.phase{1,2}SlipId (nullable FK, no backfill)
--   2. Next migration: workflow_states_for_slip_review (no DDL — pure code-side)
--   3. Next migration: seed_default_bank_account (per-org seed from CSV;
--                       deferred to follow-up when ACCOUNT team provides
--                       the canonical account data)
--
-- All ALTER TABLEs use IF NOT EXISTS / IF EXISTS guards so production (which
-- may already have a partial state from concurrent work) sees a no-op rather
-- than a hard failure.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- bank_accounts — destination accounts the ACCOUNT team manages
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "bank_accounts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "branchName" TEXT,

    "promptpayId" TEXT,

    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultForPhase" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),

    "notes" TEXT,

    "createdBy" TEXT,
    "updatedBy" TEXT,

    "organizationId" TEXT NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_org_bank_account_unique"
    ON "bank_accounts"("organizationId", "bankCode", "accountNumber");

CREATE INDEX IF NOT EXISTS "bank_accounts_active_default_phase_idx"
    ON "bank_accounts"("organizationId", "isActive", "defaultForPhase",
                       "effectiveFrom", "effectiveUntil");

CREATE INDEX IF NOT EXISTS "bank_accounts_org_active_idx"
    ON "bank_accounts"("organizationId", "isActive");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'bank_accounts_organizationId_fkey'
    ) THEN
        ALTER TABLE "bank_accounts"
            ADD CONSTRAINT "bank_accounts_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- payment_slips — applicant-uploaded bank-transfer slips, ACCOUNT-reviewed
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "payment_slips" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    "applicationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,

    "fileUrl" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "bankRef" TEXT NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL,
    "amountClaimed" INTEGER NOT NULL,
    "payerNote" TEXT,

    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',

    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "amountVerified" INTEGER,

    "bankAccountId" TEXT,

    "uploadedBy" TEXT NOT NULL,
    "uploadedByIp" TEXT,

    "organizationId" TEXT NOT NULL,

    "retainUntil" TIMESTAMP(3) NOT NULL DEFAULT (NOW() + INTERVAL '7 years'),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_slips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_slips_app_phase_status_idx"
    ON "payment_slips"("applicationId", "phase", "status");

-- ACCOUNT-team pending-queue read path (FIFO ordering by uploaded-at)
CREATE INDEX IF NOT EXISTS "payment_slips_status_created_idx"
    ON "payment_slips"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "payment_slips_org_status_idx"
    ON "payment_slips"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "payment_slips_invoice_idx"
    ON "payment_slips"("invoiceId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'payment_slips_applicationId_fkey'
    ) THEN
        ALTER TABLE "payment_slips"
            ADD CONSTRAINT "payment_slips_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'payment_slips_invoiceId_fkey'
    ) THEN
        ALTER TABLE "payment_slips"
            ADD CONSTRAINT "payment_slips_invoiceId_fkey"
            FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'payment_slips_bankAccountId_fkey'
    ) THEN
        ALTER TABLE "payment_slips"
            ADD CONSTRAINT "payment_slips_bankAccountId_fkey"
            FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'payment_slips_organizationId_fkey'
    ) THEN
        ALTER TABLE "payment_slips"
            ADD CONSTRAINT "payment_slips_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- applications — slip back-link columns (nullable; no backfill needed because
-- existing applications have no slip history under the old gateway flow)
-- -----------------------------------------------------------------------------
ALTER TABLE "applications"
    ADD COLUMN IF NOT EXISTS "phase1SlipId" TEXT,
    ADD COLUMN IF NOT EXISTS "phase2SlipId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "applications_phase1SlipId_key"
    ON "applications"("phase1SlipId");

CREATE UNIQUE INDEX IF NOT EXISTS "applications_phase2SlipId_key"
    ON "applications"("phase2SlipId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'applications_phase1SlipId_fkey'
    ) THEN
        ALTER TABLE "applications"
            ADD CONSTRAINT "applications_phase1SlipId_fkey"
            FOREIGN KEY ("phase1SlipId") REFERENCES "payment_slips"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'applications_phase2SlipId_fkey'
    ) THEN
        ALTER TABLE "applications"
            ADD CONSTRAINT "applications_phase2SlipId_fkey"
            FOREIGN KEY ("phase2SlipId") REFERENCES "payment_slips"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;
