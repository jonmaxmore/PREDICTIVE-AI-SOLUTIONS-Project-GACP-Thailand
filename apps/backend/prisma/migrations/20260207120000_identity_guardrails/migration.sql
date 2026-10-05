-- Identity guardrails for ERP-grade RBAC model
-- Enforce single identity per user record:
--   - Either healthId (farmer) or providerId (staff), but never both.
--
-- NOTE:
-- Added as NOT VALID to avoid breaking existing legacy rows immediately.
-- Constraint is still enforced for new/updated rows.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_single_identity_ck'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_single_identity_ck"
    CHECK (NOT ("healthId" IS NOT NULL AND "providerId" IS NOT NULL))
    NOT VALID;
  END IF;
END $$;
