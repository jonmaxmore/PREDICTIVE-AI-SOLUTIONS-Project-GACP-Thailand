-- ✅ Batch 20-A — Credit Note (ใบลดหนี้) + Debit Note (ใบเพิ่มหนี้) (2026-05-16)
--
-- Migration name: add_credit_debit_notes
--
-- Adds two new tables backing ม.86/10 (ใบลดหนี้) + ม.86/9 (ใบเพิ่มหนี้)
-- corrections to a previously issued ใบกำกับภาษีเต็มรูป. Both are PLATFORM-
-- side documents (issued by Predictive AI Solution Co., Ltd.); DTAM state-
-- fee invoices are corrected via the กรมบัญชีกลาง refund process, NOT via
-- CN/DN on the platform's books.
--
-- Strictly additive:
--   - New tables only, no DROP / ALTER COLUMN on existing tables.
--   - FKs use ON DELETE RESTRICT to preserve the audit trail (a tax invoice
--     with attached credit/debit notes cannot be silently purged).
--   - All indexes use IF NOT EXISTS for re-run idempotence.
--
-- Compliance basis (Thai tax + accounting):
--   - ป.รัษฎากร ม.86/10 — ใบลดหนี้: VAT-registered seller must issue when
--     amending the original tax invoice downward.
--   - ป.รัษฎากร ม.86/9  — ใบเพิ่มหนี้: same, upward direction.
--   - ป.รัษฎากร ม.86/4 — sequential numbering + 7-year retention apply.
--   - ป.รัษฎากร ม.87/3 — 7-year retention for all VAT-bearing documents.
--   - TFRS for NPAEs ch. 18 (รายได้) — revenue correction posted as a
--     REVERSING entry, not by editing the original invoice / journal.
--   - TAS 1 (Presentation of Financial Statements) — chronological audit
--     trail with traceable references to source documents.
--
-- Money columns use DECIMAL(15,2) per TFRS for NPAEs — exact decimal math
-- at the schema boundary; the service layer rounds via round2() before
-- persistence. All amounts are POSITIVE numbers; downward / upward
-- semantics are conveyed by the document type, not by sign.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) credit_notes — ใบลดหนี้ (ม.86/10 ป.รัษฎากร)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "credit_notes" (
    "id"                TEXT         NOT NULL,
    "creditNoteNumber"  TEXT         NOT NULL,
    "originalInvoiceId" TEXT         NOT NULL,
    "reason"            TEXT         NOT NULL,
    "reasonCode"        TEXT         NOT NULL,
    "subtotal"          DECIMAL(15,2) NOT NULL,
    "vat"               DECIMAL(15,2) NOT NULL,
    "totalAmount"       DECIMAL(15,2) NOT NULL,
    "status"            TEXT         NOT NULL,
    "issuedAt"          TIMESTAMP(3),
    "issuedBy"          TEXT,
    "postedAt"          TIMESTAMP(3),
    "postedBy"          TEXT,
    "organizationId"    TEXT,
    "isDeleted"         BOOLEAN      NOT NULL DEFAULT false,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_creditNoteNumber_key"
    ON "credit_notes" ("creditNoteNumber");
CREATE INDEX IF NOT EXISTS "credit_notes_originalInvoiceId_idx"
    ON "credit_notes" ("originalInvoiceId");
CREATE INDEX IF NOT EXISTS "credit_notes_status_idx"
    ON "credit_notes" ("status");
CREATE INDEX IF NOT EXISTS "credit_notes_organizationId_idx"
    ON "credit_notes" ("organizationId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'credit_notes_originalInvoiceId_fkey'
    ) THEN
        ALTER TABLE "credit_notes"
            ADD CONSTRAINT "credit_notes_originalInvoiceId_fkey"
            FOREIGN KEY ("originalInvoiceId")
            REFERENCES "invoices"("id")
            ON DELETE RESTRICT
            ON UPDATE CASCADE;
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) debit_notes — ใบเพิ่มหนี้ (ม.86/9 ป.รัษฎากร)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "debit_notes" (
    "id"                TEXT         NOT NULL,
    "debitNoteNumber"   TEXT         NOT NULL,
    "originalInvoiceId" TEXT         NOT NULL,
    "reason"            TEXT         NOT NULL,
    "reasonCode"        TEXT         NOT NULL,
    "subtotal"          DECIMAL(15,2) NOT NULL,
    "vat"               DECIMAL(15,2) NOT NULL,
    "totalAmount"       DECIMAL(15,2) NOT NULL,
    "status"            TEXT         NOT NULL,
    "issuedAt"          TIMESTAMP(3),
    "issuedBy"          TEXT,
    "postedAt"          TIMESTAMP(3),
    "postedBy"          TEXT,
    "organizationId"    TEXT,
    "isDeleted"         BOOLEAN      NOT NULL DEFAULT false,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debit_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "debit_notes_debitNoteNumber_key"
    ON "debit_notes" ("debitNoteNumber");
CREATE INDEX IF NOT EXISTS "debit_notes_originalInvoiceId_idx"
    ON "debit_notes" ("originalInvoiceId");
CREATE INDEX IF NOT EXISTS "debit_notes_status_idx"
    ON "debit_notes" ("status");
CREATE INDEX IF NOT EXISTS "debit_notes_organizationId_idx"
    ON "debit_notes" ("organizationId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'debit_notes_originalInvoiceId_fkey'
    ) THEN
        ALTER TABLE "debit_notes"
            ADD CONSTRAINT "debit_notes_originalInvoiceId_fkey"
            FOREIGN KEY ("originalInvoiceId")
            REFERENCES "invoices"("id")
            ON DELETE RESTRICT
            ON UPDATE CASCADE;
    END IF;
END $$;
