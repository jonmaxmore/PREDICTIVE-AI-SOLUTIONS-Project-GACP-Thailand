-- ✅ Batch 16-A — Two-issuer (DTAM / PLATFORM) billing schema extensions (2026-05-16).
--
-- Migration name: add_journal_quotation_receipt_seq_bank_accounts
--
-- Adds the schema surface needed by the separated DTAM-side and PLATFORM-side
-- billing flow confirmed by the owner on 2026-05-16. Applicant pays TWO
-- separate transfers per phase (state fee → Treasury, platform fee → platform
-- bank), and we issue separate QT / Invoice / Receipt documents per side.
--
-- This migration is STRICTLY ADDITIVE:
--   - No DROP COLUMN.
--   - No required FK without a default.
--   - Legacy columns on `receipt_sequences` (prefix, year) become NULLABLE
--     (was NOT NULL in 20260516000000) — that is structurally safe because
--     PostgreSQL treats NULL as "unknown" so existing rows continue to be
--     valid (their values remain non-NULL).
--   - New unique indexes use IF NOT EXISTS so re-runs are idempotent.
--
-- Compliance basis (Thai accounting + statute):
--   - TFRS for NPAEs (Thai Financial Reporting Standards for Non-Publicly
--     Accountable Entities) ch.2 — financial-reporting framework requires
--     double-entry bookkeeping with a balanced journal.
--   - TFRS for NPAEs ch.18 (รายได้) — revenue recognised only at invoice
--     time; quotations are estimates, not revenue.
--   - TAS 1 (Presentation of Financial Statements) — chronological audit
--     trail with traceable references to source documents.
--   - Revenue Code §82, §86, §86/4 — VAT-registered entity must maintain
--     sequential tax-invoice numbering with cross-reference to quotation.
--   - Revenue Code §87/3 — 7-year retention for tax-bearing documents.
--   - กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน — state revenue must land in
--     a Treasury-controlled account (กรมบัญชีกลาง), not a private bank.
--
-- Concurrency notes:
--   No CREATE INDEX CONCURRENTLY here because new tables are empty at
--   migration time. The ReceiptSequence column additions use ALTER TABLE
--   ADD COLUMN which takes an ACCESS EXCLUSIVE lock briefly; this is
--   acceptable because the table is tiny (one row per (issuer, doc, year)
--   bucket — single-digit rows in production).
--
-- Rollback plan:
--   See docs/dba/billing-schema-2026-05-16.md §"Rollback plan" — every
--   statement here has a documented reverse counterpart.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) journal_lines — add taxableAmount (Revenue Code §79 VAT base per line)
-- ──────────────────────────────────────────────────────────────────────────
--
-- The VAT-bearing portion of a multi-line entry is the platform-fee
-- subtotal, NOT the total cash captured. ภ.พ.30 (monthly VAT remittance)
-- needs this isolated so it doesn't have to re-parse account codes.

ALTER TABLE "journal_lines"
    ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(15,2);

-- ──────────────────────────────────────────────────────────────────────────
-- 2) receipt_sequences — extend with (issuerType, documentType, yearBE, yearAD, nextNumber)
-- ──────────────────────────────────────────────────────────────────────────
--
-- The B16-original migration created (prefix, year, counter). The receipt-
-- sequence-service.js consumer expects (issuerType, documentType, yearBE,
-- yearAD, nextNumber). We add the new columns and a second unique index
-- alongside the legacy columns. Legacy columns become NULLABLE so new rows
-- written by receipt-sequence-service don't need to populate the legacy
-- triple.

-- 2a) Relax legacy NOT NULLs (additive — existing rows stay valid).
ALTER TABLE "receipt_sequences"
    ALTER COLUMN "prefix" DROP NOT NULL;
ALTER TABLE "receipt_sequences"
    ALTER COLUMN "year"   DROP NOT NULL;

-- 2b) Add new structured columns.
ALTER TABLE "receipt_sequences"
    ADD COLUMN IF NOT EXISTS "issuerType"   TEXT;
ALTER TABLE "receipt_sequences"
    ADD COLUMN IF NOT EXISTS "documentType" TEXT;
ALTER TABLE "receipt_sequences"
    ADD COLUMN IF NOT EXISTS "yearBE"       INTEGER;
ALTER TABLE "receipt_sequences"
    ADD COLUMN IF NOT EXISTS "yearAD"       INTEGER;
ALTER TABLE "receipt_sequences"
    ADD COLUMN IF NOT EXISTS "nextNumber"   INTEGER NOT NULL DEFAULT 1;

-- 2c) Compound unique index on the new shape.
--   PostgreSQL treats NULLs as distinct, so legacy rows (NULL issuerType)
--   and new rows (populated issuerType) coexist without index collision.
CREATE UNIQUE INDEX IF NOT EXISTS "receipt_sequences_issuer_doc_be_ad_key"
    ON "receipt_sequences" ("issuerType", "documentType", "yearBE", "yearAD");

CREATE INDEX IF NOT EXISTS "receipt_sequences_issuerType_documentType_idx"
    ON "receipt_sequences" ("issuerType", "documentType");

-- ──────────────────────────────────────────────────────────────────────────
-- 3) quotations — DTAM-side / PLATFORM-side quote stream
-- ──────────────────────────────────────────────────────────────────────────
--
-- A new model distinct from the legacy `quotes` table (created in batch 11).
-- Batch 11's quote-service.js continues to read/write the legacy table; the
-- new two-issuer flow writes here. Both tables coexist during the transition.
--
-- Why a new table (not extending quotes):
--   - quotes.quoteNumber is a single-stream serial allocated by quote-service
--     (QT-20260516-0001 pattern). Two-issuer flow needs DTAM and PLATFORM
--     numbering buckets allocated via receipt_sequences.
--   - quotes.{subtotal,vat,totalAmount} are stored as Float; new accounting
--     work requires Decimal(15,2) under TFRS for NPAEs.

CREATE TABLE IF NOT EXISTS "quotations" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    "applicationId"   TEXT         NOT NULL,
    "issuerType"      TEXT         NOT NULL,  -- 'DTAM' | 'PLATFORM'
    "quotationNumber" TEXT         NOT NULL,
    "subtotal"        DECIMAL(15,2) NOT NULL,
    "vat"             DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount"     DECIMAL(15,2) NOT NULL,
    -- installments JSON: [{ "phase":"PHASE_1","amount":5000 }, ...]
    "installments"    JSONB,
    "status"          TEXT         NOT NULL DEFAULT 'DRAFT',
    "validUntil"      TIMESTAMP(3),
    "acceptedAt"      TIMESTAMP(3),
    "rejectedAt"      TIMESTAMP(3),
    "notes"           TEXT,
    "applicantNotes"  TEXT,
    "createdBy"       TEXT,
    "updatedBy"       TEXT,
    "isDeleted"       BOOLEAN      NOT NULL DEFAULT false,
    "deletedAt"       TIMESTAMP(3),
    "deletedBy"       TEXT,
    "deleteReason"    TEXT,
    "organizationId"  TEXT         NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quotations_quotationNumber_key"
    ON "quotations" ("quotationNumber");

CREATE INDEX IF NOT EXISTS "quotations_applicationId_issuerType_idx"
    ON "quotations" ("applicationId", "issuerType");
CREATE INDEX IF NOT EXISTS "quotations_status_idx"
    ON "quotations" ("status");
CREATE INDEX IF NOT EXISTS "quotations_organizationId_idx"
    ON "quotations" ("organizationId");
CREATE INDEX IF NOT EXISTS "quotations_isDeleted_idx"
    ON "quotations" ("isDeleted");

-- FKs (application + organization) — match the conventions used by the
-- existing `quotes` table (CASCADE on application delete, RESTRICT on org).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotations_applicationId_fkey'
    ) THEN
        ALTER TABLE "quotations"
            ADD CONSTRAINT "quotations_applicationId_fkey"
            FOREIGN KEY ("applicationId")
            REFERENCES "applications"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotations_organizationId_fkey'
    ) THEN
        ALTER TABLE "quotations"
            ADD CONSTRAINT "quotations_organizationId_fkey"
            FOREIGN KEY ("organizationId")
            REFERENCES "organizations"("id")
            ON DELETE RESTRICT
            ON UPDATE CASCADE;
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4) issuer_bank_accounts — canonical destination bank account per issuer
-- ──────────────────────────────────────────────────────────────────────────
--
-- NOT the same as `bank_accounts` (org+phase-scoped, per-organization
-- candidates for slip-flow approval). `issuer_bank_accounts` is platform-
-- wide — ONE canonical row per issuer side (DTAM / PLATFORM). The applicant
-- UI renders these two rows side-by-side at checkout.

CREATE TABLE IF NOT EXISTS "issuer_bank_accounts" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "issuerType"   TEXT         NOT NULL,
    "bankName"     TEXT         NOT NULL,
    "bankCode"     TEXT,
    "accountNo"    TEXT         NOT NULL,
    "accountName"  TEXT         NOT NULL,
    "promptpayId"  TEXT,
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issuer_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- @unique on issuerType — only ONE canonical row per side. Treasury bank
-- and platform bank are global facts; if either changes, the row is
-- UPDATED (with an audit history captured in the application layer), not
-- inserted-as-a-second-row.
CREATE UNIQUE INDEX IF NOT EXISTS "issuer_bank_accounts_issuerType_key"
    ON "issuer_bank_accounts" ("issuerType");
