-- R2 M1 EXPAND — Notification.kind (official letters, operator decision D-9
-- 2026-08-03; evidence/R2-special-reopen/decisions-final.md).
--
-- Adds the letter-class column beside the existing notification columns.
-- EXPAND only: nothing is dropped or altered destructively; every existing
-- row becomes kind = 'GENERAL' through the column default. String + CHECK
-- mirrors the frozen JS vocabulary (shared/notification-kind.js) — same
-- idiom as migration 20260802150000_wave1_checkout_engine_expand.
--
-- Rollback (manual):
--   DROP INDEX IF EXISTS "notifications_userId_kind_idx";
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_kind_check";
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "kind";

BEGIN;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'GENERAL';

-- The DB refuses what the JS vocabulary refuses. ADD CONSTRAINT has no
-- IF NOT EXISTS form in Postgres, so idempotency goes through pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_kind_check'
  ) THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check"
      CHECK ("kind" IN ('GENERAL', 'OFFICIAL_LETTER'));
  END IF;
END $$;

-- Read path for the archived-letters surfaces (M2+): a user's letters.
CREATE INDEX IF NOT EXISTS "notifications_userId_kind_idx"
  ON "notifications"("userId", "kind");

COMMIT;
