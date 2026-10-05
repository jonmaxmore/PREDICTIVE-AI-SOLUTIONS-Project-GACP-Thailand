-- Debt #2: Fix fee defaults to match canonical total fees
-- Phase 1: 5,000 (state fee only) → 5,535 (total: state + platform + VAT)
-- Phase 2: 25,000 (state fee only) → 27,675 (total: state + platform + VAT)
--
-- Reference: docs/handoffs/debt-2-fee-defaults/01-impact-analysis.md
--
-- NOTE: This migration only changes column DEFAULTS for newly inserted rows.
-- Existing rows are unchanged. Application code already overrides defaults
-- on insert (wizard-controller.js, seed-real-fees.js, etc.).

ALTER TABLE "applications" ALTER COLUMN "phase1Amount" SET DEFAULT 5535;
ALTER TABLE "applications" ALTER COLUMN "phase2Amount" SET DEFAULT 27675;
