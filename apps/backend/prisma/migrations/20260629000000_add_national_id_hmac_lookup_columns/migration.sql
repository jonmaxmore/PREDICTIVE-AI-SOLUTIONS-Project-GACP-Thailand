-- ============================================================================
-- H-4 Phase 1, Migration 1 — additive national-ID HMAC lookup columns (INERT)
-- ============================================================================
--
-- Migration name: add_national_id_hmac_lookup_columns
--
-- Adds five NULLABLE, @unique lookup columns on `users`, mirroring the existing
-- legacy `*Hash` columns (raw SHA-256) but intended to hold the keyed
-- HMAC-SHA-256 produced by `utils/field-encryption.js computeLookupHmac()`:
--
--   healthIdHash                -> healthIdHmac
--   providerIdHash              -> providerIdHmac
--   idCardHash                  -> idCardHmac
--   taxIdHash                   -> taxIdHmac
--   communityRegistrationNoHash -> communityRegistrationNoHmac
--
-- Why this is SAFE / INERT:
--   * Every column is NULLABLE — no backfill required for the migration to
--     apply, no row is touched, no DEFAULT.
--   * The unique indexes are partial-by-nature (Postgres treats multiple NULLs
--     as distinct), so an all-NULL column has no uniqueness pressure.
--   * NO application code READS these columns while the feature flag
--     `AUTH_LOOKUP_USE_HMAC` is off (the default). With the flag off the login
--     lookup + register/create paths are byte-for-byte the current behaviour
--     (they read/write the legacy `*Hash` columns only).
--
-- Rollout (see docs/handoffs/H-4-national-id-hmac-migration-rfc.md §5, Option A):
--   1. Apply THIS migration (additive, no behaviour change).
--   2. Run scripts/backfill-national-id-hmac.js (computes computeLookupHmac of
--      each plaintext column into the matching `*Hmac` column; idempotent,
--      batched, asserts "0 active rows missing *Hmac").
--   3. Flip `AUTH_LOOKUP_USE_HMAC=true` — login then resolves by `*Hmac` and
--      register/create dual-writes both `*Hash` and `*Hmac`.
--   Rollback at any point = unset the flag (config flip). These columns can
--   stay; they remain inert when the flag is off.
--
-- Additive, non-breaking. Run with `prisma migrate deploy` (backfill is a
-- SEPARATE, explicitly-run script — NOT part of this migration).
-- ============================================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "communityRegistrationNoHmac" TEXT,
ADD COLUMN     "healthIdHmac" TEXT,
ADD COLUMN     "idCardHmac" TEXT,
ADD COLUMN     "providerIdHmac" TEXT,
ADD COLUMN     "taxIdHmac" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_healthIdHmac_key" ON "users"("healthIdHmac");

-- CreateIndex
CREATE UNIQUE INDEX "users_providerIdHmac_key" ON "users"("providerIdHmac");

-- CreateIndex
CREATE UNIQUE INDEX "users_idCardHmac_key" ON "users"("idCardHmac");

-- CreateIndex
CREATE UNIQUE INDEX "users_taxIdHmac_key" ON "users"("taxIdHmac");

-- CreateIndex
CREATE UNIQUE INDEX "users_communityRegistrationNoHmac_key" ON "users"("communityRegistrationNoHmac");
