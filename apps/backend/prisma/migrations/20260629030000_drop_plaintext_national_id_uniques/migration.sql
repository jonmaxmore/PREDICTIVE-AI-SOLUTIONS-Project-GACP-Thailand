-- ============================================================================
-- Detokenize STAGE B3 — drop the now-meaningless PLAINTEXT national-ID @unique
-- ============================================================================
--
-- Migration name: drop_plaintext_national_id_uniques
-- RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md (STAGE B — ENCRYPT)
--
-- STAGE B3 encrypts the plaintext national-ID columns at rest
-- (User.healthId / User.providerId / User.idCard_deprecated / User.taxId /
-- User.communityRegistrationNo / User.laserCode + Entity.thaiCitizenId) with
-- random-IV AES-256-GCM. A random-IV ciphertext column CANNOT carry a useful
-- UNIQUE constraint: the same plaintext encrypts to a different value on every
-- write, so a UNIQUE on the ciphertext is never violated by a real duplicate
-- (cosmetic) — and a UNIQUE on the column would otherwise FORCE collisions to
-- be detected on the plaintext, which we no longer store searchably.
--
-- Uniqueness of the national ID is held by the parallel keyed lookup columns,
-- which are UNTOUCHED here and stay @unique:
--   * users.healthIdHash        (@unique)  + users.healthIdHmac   (@unique, H-4)
--   * users.providerIdHash      (@unique)  + users.providerIdHmac (@unique, H-4)
--   * entities (type, thaiCitizenIdHmac)   (@@unique, B2 keyed HMAC)
--
-- This migration therefore drops THREE now-redundant plaintext uniques:
--   1. users.healthId   plaintext UNIQUE  (auto-named users_healthId_key)
--   2. users.providerId plaintext UNIQUE  (auto-named users_providerId_key)
--   3. entities (type, thaiCitizenIdHash) UNKEYED UNIQUE
--      (entities_type_thaiCitizenIdHash_key)
--
-- KEPT on purpose (NOT dropped here):
--   * The plaintext COLUMNS themselves (healthId/providerId/thaiCitizenId/...)
--     — still read for display (decrypted by the B1 walker) + back-compat.
--   * The non-unique @@index([healthId]) / @@index([providerId]) on users.
--   * The entities.thaiCitizenIdHash COLUMN (only its UNIQUE is removed; the
--     column drop is a deferred later cleanup).
--
-- ## How the healthId/providerId uniques were originally created
--
-- They were added inline as `ALTER TABLE "users" ADD COLUMN ... TEXT UNIQUE`
-- (migration 20260206080000_add_moph_health_provider_id), which in Postgres
-- creates a UNIQUE *constraint* (auto-named `<table>_<column>_key`) backed by
-- an index of the same name. Prisma's `@unique` maps to the same name. To be
-- robust to BOTH the constraint form and a bare-index form across environments,
-- we DROP CONSTRAINT IF EXISTS first (removes the backing index too) and then
-- DROP INDEX IF EXISTS as a fallback. Both are IF EXISTS → idempotent + safe to
-- re-run, and a no-op if a prior environment already lacks one form.
--
-- The Entity unique was created via `CREATE UNIQUE INDEX` (no table
-- constraint), so DROP INDEX IF EXISTS is sufficient; DROP CONSTRAINT IF EXISTS
-- is included defensively and is a no-op when no such constraint exists.
--
-- Additive-safe to apply: dropping a UNIQUE never fails on existing data and
-- the keyed uniques continue to enforce the real invariant. Run with
-- `prisma migrate deploy`. This migration ships in the SAME B3 image as the
-- extension changes; the encrypt-backfill is a SEPARATE explicitly-run script.
-- ============================================================================

-- 1. users.healthId plaintext UNIQUE
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_healthId_key";
DROP INDEX IF EXISTS "users_healthId_key";

-- 2. users.providerId plaintext UNIQUE
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_providerId_key";
DROP INDEX IF EXISTS "users_providerId_key";

-- 3. entities (type, thaiCitizenIdHash) UNKEYED UNIQUE
ALTER TABLE "entities" DROP CONSTRAINT IF EXISTS "entities_type_thaiCitizenIdHash_key";
DROP INDEX IF EXISTS "entities_type_thaiCitizenIdHash_key";
