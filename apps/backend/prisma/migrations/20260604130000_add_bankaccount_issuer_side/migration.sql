-- B-PAY-SIDE (2026-06-04): two-money-flow per-side applicant bank accounts.
-- Each phase emits a STATE-fee invoice (→ DTAM/Treasury account) and a
-- PLATFORM-fee+VAT invoice (→ company account); the applicant transfers each
-- to its own account. BankAccount.issuerType lets /active resolve the account
-- for the invoice's side. Additive + nullable: existing rows become
-- issuerType=NULL and keep the legacy side-agnostic behaviour (no data loss).
ALTER TABLE "bank_accounts" ADD COLUMN "issuerType" TEXT;

CREATE INDEX "bank_accounts_organizationId_issuerType_isActive_idx"
  ON "bank_accounts" ("organizationId", "issuerType", "isActive");
