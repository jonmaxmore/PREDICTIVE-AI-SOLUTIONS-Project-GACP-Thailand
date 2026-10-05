-- Remove unused external identity token columns from users table.
-- Safe to apply even if columns were absent in some environments.
ALTER TABLE "users" DROP COLUMN IF EXISTS "mophToken";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mophTokenExpiry";
