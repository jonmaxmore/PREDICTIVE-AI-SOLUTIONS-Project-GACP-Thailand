-- ============================================================================
-- Drop the orphan trg_sync_app_state_status trigger and its function.
--
-- Background:
--   Migration 20260425090000_add_application_phase2_expires_at_and_resync_schema
--   dropped the obsolete `state` column from the applications table. A
--   trigger and function that referenced NEW.state and NEW.status were
--   never cleaned up — they had been created outside the migration history
--   (most likely via an early `prisma db push` that pre-dated the formal
--   migration set).
--
--   The orphan was dormant until the Phase 1.3 backfill in
--   20260427120200_backfill_default_organization issued an UPDATE on
--   applications, which fired the trigger and crashed with
--   `record "new" has no field "state"` on the production database.
--
--   The trigger was dropped surgically on production during the deploy
--   that lit up this bug. This migration captures the same drop in code
--   so any other environment (staging, fresh dev DB, future tenant
--   onboarding) gets the same cleanup applied automatically.
--
-- Idempotency:
--   `IF EXISTS` makes the migration a no-op on environments that never had
--   the orphan in the first place. It is safe to apply unconditionally.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_app_state_status ON applications;
DROP FUNCTION IF EXISTS sync_app_state_status();
