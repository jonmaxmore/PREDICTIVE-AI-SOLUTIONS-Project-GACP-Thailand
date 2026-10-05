-- Iter 26 — Purchase Invoice / Input VAT tracking (2026-05-16)
--
-- Migration name: purchase_invoice
--
-- Adds the `purchase_invoices` table that backs Input VAT (ภาษีซื้อ)
-- tracking on the platform's ภ.พ.30 monthly filing. Each row represents
-- one ใบกำกับภาษีซื้อ received from a supplier (office supplies, utilities,
-- professional services, etc.).
--
-- Strictly additive:
--   - New table only, no DROP / ALTER on existing tables.
--   - All indexes use IF NOT EXISTS for re-run idempotence.
--   - No foreign keys (organizationId remains a scalar to match the
--     existing CreditNote / DebitNote / ManualJournalEntryDraft pattern).
--
-- Legal basis (ป.รัษฎากร):
--   - ม.82/3 — Input-Output VAT netting (Output - Input = remittance).
--   - ม.82/4 — Input VAT claim requires the original ใบกำกับภาษีซื้อ on
--              file with supplier TIN + invoice number + date + amounts.
--   - ม.83/8 — monthly e-Filing window: 15th of the following month.
--   - ม.86/4 — full tax-invoice field minima (drives the column set).
--   - ม.87/3 — 7-year retention of all VAT-bearing documents.
--
-- Money columns use DECIMAL(15,2) per TFRS for NPAEs — exact decimal math
-- at the schema boundary. All amounts are POSITIVE (sign carried by the
-- document type — a purchase invoice never has a negative subtotal).

CREATE TABLE IF NOT EXISTS "purchase_invoices" (
    "id"              TEXT          NOT NULL,
    "invoiceNumber"   TEXT          NOT NULL,
    "supplierName"    TEXT          NOT NULL,
    "supplierTaxId"   TEXT          NOT NULL,
    "supplierAddress" TEXT,
    "invoiceDate"     TIMESTAMP(3)  NOT NULL,
    "receivedDate"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal"        DECIMAL(15,2) NOT NULL,
    "vat"             DECIMAL(15,2) NOT NULL,
    "totalAmount"     DECIMAL(15,2) NOT NULL,
    "category"        TEXT          NOT NULL,
    "description"     TEXT,
    "notes"           TEXT,
    "attachmentId"    TEXT,
    "organizationId"  TEXT,
    "status"          TEXT          NOT NULL,
    "reviewedAt"      TIMESTAMP(3),
    "reviewedBy"      TEXT,
    "rejectionReason" TEXT,
    "paidAt"          TIMESTAMP(3),
    "paidBy"          TEXT,
    "journalEntryId"  TEXT,
    "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"       TEXT          NOT NULL,
    "isDeleted"       BOOLEAN       NOT NULL DEFAULT false,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- Practical Input-VAT double-claim guard (ม.86/4): a supplier cannot
-- legally re-issue the same invoice number for a given TIN.
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_invoices_supplier_tax_invnum_key"
    ON "purchase_invoices" ("supplierTaxId", "invoiceNumber");

-- Period aggregation driver — ภ.พ.30 monthly window scan filters on
-- invoiceDate.
CREATE INDEX IF NOT EXISTS "purchase_invoices_invoiceDate_idx"
    ON "purchase_invoices" ("invoiceDate");

CREATE INDEX IF NOT EXISTS "purchase_invoices_status_idx"
    ON "purchase_invoices" ("status");

CREATE INDEX IF NOT EXISTS "purchase_invoices_organizationId_idx"
    ON "purchase_invoices" ("organizationId");
