-- The fee column defaults follow the current formula.
--
-- applications.phase1Amount and phase2Amount defaulted to 5535 and 27675 — the
-- single-scope totals under the formula that charged VAT on the platform slice alone.
-- That formula was retired on 2026-08-22, when the operator ruled a single issuer and
-- VAT on the whole service fee. The current single-scope totals are 5885 and 29425.
--
-- Why it went unnoticed for three days: the draft path sets both columns explicitly from
-- the fee service (application-draft-query-methods.js:70-71), so nothing read the default.
-- A default nothing reads is a number nobody checks — until some path omits the column and
-- quietly charges a farmer last month's price.
--
-- Existing rows are untouched. A column default applies only to inserts that omit the
-- column, so applications already priced keep the amount they were priced at, which is the
-- correct behaviour for anything already quoted or invoiced.
--
-- __tests__/unit/schema-fee-defaults-match-fee-service.test.js compares these defaults
-- against what the fee service computes rather than against literals, so the schema and the
-- fee model cannot drift apart again without a test failing.

ALTER TABLE "applications" ALTER COLUMN "phase1Amount" SET DEFAULT 5885;
ALTER TABLE "applications" ALTER COLUMN "phase2Amount" SET DEFAULT 29425;
