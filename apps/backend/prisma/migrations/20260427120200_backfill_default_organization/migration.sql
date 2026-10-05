-- ============================================================================
-- Backfill organizationId = 'default' Organization for all existing rows.
-- Multi-tenancy Phase 1, step 3 (ADR-014).
--
-- Background:
--   The previous migration (20260427120100_add_organization_id_columns)
--   added nullable organizationId on 48 tenant-scoped tables. This migration
--   populates them all to point at the seeded 'default' Organization that
--   migration 20260427120000_add_organization_table inserted.
--
--   After this migration, no row in any tenant-scoped table has
--   organizationId IS NULL. The next phase (NOT NULL alteration + FK
--   constraints) can then run safely.
--
-- Idempotency:
--   Each UPDATE is guarded by `WHERE organizationId IS NULL` so re-running
--   the migration is a no-op. The DO block at the end fails fast if the
--   default Organization is missing rather than silently leaving rows
--   unscoped.
-- ============================================================================

DO $$
DECLARE
    default_org_id TEXT;
BEGIN
    SELECT id INTO default_org_id FROM "organizations" WHERE slug = 'default';

    IF default_org_id IS NULL THEN
        RAISE EXCEPTION
            'Default Organization (slug=''default'') not found. The seed in '
            'migration 20260427120000_add_organization_table must run first.';
    END IF;

    -- ── auth ────────────────────────────────────────────────────────────
    UPDATE "users"          SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "user_consents"  SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── application ─────────────────────────────────────────────────────
    UPDATE "applications"          SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "application_comments"  SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "application_drafts"    SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "application_bundles"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── farm + cultivation ──────────────────────────────────────────────
    UPDATE "farms"                    SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "site_analyses"            SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "training_records"         SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "plots"                    SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "planting_cycles"          SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "planting_cycle_plots"     SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "plant_units"              SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "plant_unit_edit_history"  SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "care_logs"                SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "cultivation_logs"         SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── GACP compliance ─────────────────────────────────────────────────
    UPDATE "water_sources"           SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "growing_media"           SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "seed_sources"            SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "fertilizer_records"      SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "controlled_environments" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── harvest + trace ─────────────────────────────────────────────────
    UPDATE "harvest_batches"     SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "drying_temperatures" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "drying_humidity"     SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "drying_dark_rooms"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "curing_processes"    SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "packaging_details"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "drying_processes"    SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "lots"                SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "trace_qr_security"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "trace_qr_scans"      SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "consumer_feedback"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── certification ───────────────────────────────────────────────────
    UPDATE "certificates" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── billing ─────────────────────────────────────────────────────────
    -- invoice_line_items omitted intentionally — see migration
    -- 20260427120100_add_organization_id_columns for the explanation.
    UPDATE "invoices"                 SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "quotes"                   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "payment_transactions"     SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "payment_audits"           SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "payment_reconciliations"  SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── audit ───────────────────────────────────────────────────────────
    UPDATE "audit_logs"          SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "post_audit_tasks"    SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "revision_deadlines"  SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;

    -- ── system / provider ───────────────────────────────────────────────
    UPDATE "notifications"        SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "report_submissions"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "sop_documents"        SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "scope_of_works"       SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "audit_checklists"     SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "meeting_rooms"        SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────
-- Fail the migration if any tenant-scoped table still has unscoped rows.
-- This catches the case where a new tenant-scoped table was added in a later
-- migration but its backfill statement was forgotten here. List is kept in
-- sync with the @@map names in apps/backend/prisma/schema/*.prisma.
DO $$
DECLARE
    rec     RECORD;
    cnt     BIGINT;
    failed  TEXT := '';
BEGIN
    FOR rec IN
        SELECT unnest(ARRAY[
            'users','user_consents',
            'applications','application_comments','application_drafts','application_bundles',
            'farms','site_analyses','training_records','plots',
            'planting_cycles','planting_cycle_plots','plant_units','plant_unit_edit_history',
            'care_logs','cultivation_logs',
            'water_sources','growing_media','seed_sources','fertilizer_records',
            'controlled_environments',
            'harvest_batches','drying_temperatures','drying_humidity','drying_dark_rooms',
            'curing_processes','packaging_details','drying_processes',
            'lots','trace_qr_security','trace_qr_scans','consumer_feedback',
            'certificates',
            'invoices','quotes','payment_transactions',
            'payment_audits','payment_reconciliations',
            'audit_logs','post_audit_tasks','revision_deadlines',
            'notifications','report_submissions','sop_documents','scope_of_works',
            'audit_checklists','meeting_rooms'
        ]) AS table_name
    LOOP
        EXECUTE format(
            'SELECT COUNT(*) FROM %I WHERE "organizationId" IS NULL',
            rec.table_name
        ) INTO cnt;

        IF cnt > 0 THEN
            failed := failed || format(' %s(%s)', rec.table_name, cnt);
        END IF;
    END LOOP;

    IF failed <> '' THEN
        RAISE EXCEPTION
            'Backfill verification failed — tables still have NULL organizationId:%s',
            failed;
    END IF;
END $$;
