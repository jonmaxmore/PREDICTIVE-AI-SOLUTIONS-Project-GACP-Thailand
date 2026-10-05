-- Create invoice_line_items table.
--
-- The Prisma model `InvoiceLineItem` (apps/backend/prisma/schema/billing.prisma)
-- has been in the schema for a while, but no migration ever created the
-- corresponding table. Any call to `invoice.findUnique({ include: { lineItems } })`
-- crashes with "table public.invoice_line_items does not exist" — which broke
-- GET /api/invoices/:id/pdf in production (surfaced 2026-04-30 via subscription
-- invoice PDF smoke test).
--
-- This migration creates the table to match the Prisma schema. Existing
-- invoices have no line items yet — the table is empty until issuers
-- start populating it; the include just returns [].

BEGIN;

CREATE TABLE IF NOT EXISTS "invoice_line_items" (
    "id"             TEXT PRIMARY KEY,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId"      TEXT NOT NULL,
    "lineNumber"     INTEGER NOT NULL,
    "code"           TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "quantity"       INTEGER NOT NULL DEFAULT 1,
    "unitPrice"      DOUBLE PRECISION NOT NULL,
    "amount"         DOUBLE PRECISION NOT NULL,
    "phase"          TEXT,
    "isTaxable"      BOOLEAN NOT NULL DEFAULT FALSE,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "invoice_line_items_invoiceId_fkey"
        FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoice_line_items_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "invoice_line_items_invoiceId_idx"
    ON "invoice_line_items" ("invoiceId");
CREATE INDEX IF NOT EXISTS "invoice_line_items_organizationId_idx"
    ON "invoice_line_items" ("organizationId");

-- Apply Phase E.1 observe-only RLS — keeps multi-tenancy guardrails
-- consistent with every other tenant-scoped table.
ALTER TABLE "invoice_line_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_line_items_observe_tenant" ON "invoice_line_items";
CREATE POLICY "invoice_line_items_observe_tenant" ON "invoice_line_items"
    FOR ALL
    TO PUBLIC
    USING (rls_observe_check('invoice_line_items', "organizationId"))
    WITH CHECK (rls_observe_check('invoice_line_items', "organizationId"));

COMMIT;
