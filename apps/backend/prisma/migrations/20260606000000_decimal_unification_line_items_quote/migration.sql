-- ============================================================================
-- BE-DB-05 — Decimal type unification, part 2: InvoiceLineItem + Quote
-- ============================================================================
--
-- Migration name: decimal_unification_line_items_quote
--
-- Follow-up to 20260517000000_decimal_unification (which migrated
-- Invoice.{subtotal,vat,totalAmount}). That pass left two money carriers as
-- Float (PostgreSQL `double precision`):
--   - invoice_line_items.{unitPrice, amount}
--   - quotes.{subtotal, vat, totalAmount}
-- This brings them into the same Decimal(15,2) family as the parent Invoice,
-- Quotation, JournalLine, CreditNote and DebitNote.
--
-- Compliance basis (identical to the Invoice pass):
--   - TFRS for NPAEs ch.18 — revenue recognised at the EXACT captured amount;
--     IEEE-754 Float accumulates sub-satang error that compounds through
--     aggregation. A sum of Float LINE ITEMS can disagree with the Decimal
--     parent Invoice.totalAmount by ฿0.01 once any non-integer amount appears.
--   - ป.รัษฎากร ม.86/4 — a full tax invoice must show taxable amount and VAT
--     as exact decimals; ภ.พ.30 rejects rows whose subtotal+VAT ≠ total by
--     even ฿0.01.
--
-- Strictly ADDITIVE / non-destructive:
--   - No DROP COLUMN, no nullability change. Only the numeric domain changes.
--   - USING clause preserves every row's value. `double precision` →
--     `numeric(15,2)` is deterministic; the largest live amount (฿27,675) is
--     far below the column ceiling (฿99,999,999,999,999.99). Sub-satang
--     fractions round half-away-from-zero (default `::numeric(15,2)`).
--   - Reversible (rollback documented below).
--
-- NOTE — deliberately OUT OF SCOPE (documented follow-ups, NOT silently left):
--   Two other Float money columns exist but are outside the BE-DB-05 finding's
--   verified billing-reconciliation scope and so are not touched here:
--     - subscriptions.priceTHB
--     - payment_reconciliations.totalAmount
--   Migrate them in a separate pass once their code paths are covered.
--
-- Concurrency: ALTER COLUMN TYPE rewrites the table under ACCESS EXCLUSIVE.
-- At GACP volumes (low four digits) this completes well under a second — safe
-- in the standard maintenance window.
-- ============================================================================

ALTER TABLE "invoice_line_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(15, 2) USING "unitPrice"::DECIMAL(15, 2);

ALTER TABLE "invoice_line_items"
  ALTER COLUMN "amount" TYPE DECIMAL(15, 2) USING "amount"::DECIMAL(15, 2);

ALTER TABLE "quotes"
  ALTER COLUMN "subtotal" TYPE DECIMAL(15, 2) USING "subtotal"::DECIMAL(15, 2);

ALTER TABLE "quotes"
  ALTER COLUMN "vat" TYPE DECIMAL(15, 2) USING "vat"::DECIMAL(15, 2);

ALTER TABLE "quotes"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(15, 2) USING "totalAmount"::DECIMAL(15, 2);

-- ============================================================================
-- Rollback (DBA reference — NOT applied automatically).
--
--   ALTER TABLE "invoice_line_items"
--     ALTER COLUMN "unitPrice" TYPE DOUBLE PRECISION USING "unitPrice"::DOUBLE PRECISION;
--   ALTER TABLE "invoice_line_items"
--     ALTER COLUMN "amount" TYPE DOUBLE PRECISION USING "amount"::DOUBLE PRECISION;
--   ALTER TABLE "quotes"
--     ALTER COLUMN "subtotal" TYPE DOUBLE PRECISION USING "subtotal"::DOUBLE PRECISION;
--   ALTER TABLE "quotes"
--     ALTER COLUMN "vat" TYPE DOUBLE PRECISION USING "vat"::DOUBLE PRECISION;
--   ALTER TABLE "quotes"
--     ALTER COLUMN "totalAmount" TYPE DOUBLE PRECISION USING "totalAmount"::DOUBLE PRECISION;
--
-- The reverse cast is lossless for amounts ≤ 2^53 — well above any GACP value.
-- ============================================================================
