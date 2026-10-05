-- ============================================================================
-- ADR-014 Phase D — organizationId NOT NULL
-- (operator decisions ก + ค, 2026-04-29)
--
-- Background:
--   Multi-tenancy was rolled out in 4 steps:
--     1. 20260427120000  — create `organizations` table + seed `default` row
--     2. 20260427120100  — add nullable organizationId TEXT column to 47 tables
--     3. 20260427120200  — backfill organizationId = default-org for every row
--     4. 20260427120300  — add FK constraints (still nullable)
--
--   This is **step 5 of ADR-014 Phase D**: now that every row is backfilled,
--   we can safely flip the column to NOT NULL. After this migration, no row
--   in any tenant-scoped table can be inserted without an organizationId,
--   and the read-side RLS work in Phase E.1 (next migration) becomes
--   meaningful.
--
-- Pre-flight assertion:
--   The first DO block fails fast if any table still has NULL rows. If you
--   see this fire, run the backfill migration (20260427120200) first.
--
-- Idempotency:
--   `ALTER COLUMN ... SET NOT NULL` is idempotent — running this twice on
--   a column that's already NOT NULL is a no-op (no error). Safe to re-run.
--
-- Rollback:
--   `ALTER TABLE "x" ALTER COLUMN "organizationId" DROP NOT NULL;` for each
--   table reverses the change. Phase E RLS doesn't depend on NOT NULL
--   semantically (RLS policies tolerate NULL) but enforcement is much
--   easier to reason about with NOT NULL.
-- ============================================================================

-- ── Just-in-time backfill for any NULL stragglers ──
-- The 20260427120200_backfill_default_organization migration ran 2 days ago.
-- New rows have been inserted into audit_logs and possibly other tables since
-- (e.g. from deploy-time audit entries) without an organizationId. Top up
-- against the default org first so the strict pre-flight always passes.
DO $$
DECLARE
    default_org_id TEXT;
    t TEXT;
    n_filled BIGINT;
    tbls TEXT[] := ARRAY[
        'users', 'user_consents',
        'applications', 'application_comments', 'application_drafts', 'application_bundles',
        'farms', 'site_analyses', 'training_records', 'plots',
        'planting_cycles', 'planting_cycle_plots', 'plant_units', 'plant_unit_edit_history',
        'cultivation_logs', 'care_logs', 'fertilizer_records', 'controlled_environments',
        'water_sources', 'seed_sources', 'growing_media',
        'harvest_batches', 'curing_processes', 'drying_processes',
        'drying_dark_rooms', 'drying_humidity', 'drying_temperatures',
        'packaging_details', 'lots',
        'invoices', 'quotes', 'payment_transactions', 'payment_reconciliations', 'payment_audits',
        'certificates',
        'audit_logs', 'audit_checklists', 'post_audit_tasks', 'scope_of_works',
        'meeting_rooms', 'revision_deadlines', 'report_submissions',
        'trace_qr_scans', 'trace_qr_security',
        'consumer_feedback', 'notifications', 'sop_documents'
    ];
BEGIN
    SELECT id INTO default_org_id FROM "organizations" WHERE slug = 'default';
    IF default_org_id IS NULL THEN
        RAISE EXCEPTION
            'ADR-014 Phase D: Default Organization (slug=default) not found. Run migration 20260427120000_add_organization_table first.';
    END IF;

    FOREACH t IN ARRAY tbls LOOP
        EXECUTE format(
            'UPDATE %I SET "organizationId" = $1 WHERE "organizationId" IS NULL',
            t
        ) USING default_org_id;
        GET DIAGNOSTICS n_filled = ROW_COUNT;
        IF n_filled > 0 THEN
            RAISE NOTICE 'ADR-014 Phase D top-up: backfilled % rows in %', n_filled, t;
        END IF;
    END LOOP;
END
$$;

-- ── Pre-flight: assert backfill is complete (after top-up) ──
DO $$
DECLARE
    t TEXT;
    n_null BIGINT;
    tbls TEXT[] := ARRAY[
        'users', 'user_consents',
        'applications', 'application_comments', 'application_drafts', 'application_bundles',
        'farms', 'site_analyses', 'training_records', 'plots',
        'planting_cycles', 'planting_cycle_plots', 'plant_units', 'plant_unit_edit_history',
        'cultivation_logs', 'care_logs', 'fertilizer_records', 'controlled_environments',
        'water_sources', 'seed_sources', 'growing_media',
        'harvest_batches', 'curing_processes', 'drying_processes',
        'drying_dark_rooms', 'drying_humidity', 'drying_temperatures',
        'packaging_details', 'lots',
        'invoices', 'quotes', 'payment_transactions', 'payment_reconciliations', 'payment_audits',
        'certificates',
        'audit_logs', 'audit_checklists', 'post_audit_tasks', 'scope_of_works',
        'meeting_rooms', 'revision_deadlines', 'report_submissions',
        'trace_qr_scans', 'trace_qr_security',
        'consumer_feedback', 'notifications', 'sop_documents'
    ];
BEGIN
    FOREACH t IN ARRAY tbls LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE "organizationId" IS NULL', t)
            INTO n_null;
        IF n_null > 0 THEN
            -- PL/pgSQL RAISE uses % as placeholder (single percent), not %% (which
            -- is for the format() function). Earlier migration version had %%
            -- which caused "too many parameters specified for RAISE".
            RAISE EXCEPTION
                'ADR-014 Phase D pre-flight: table % still has % rows with NULL organizationId. Run migration 20260427120200_backfill_default_organization first.',
                t, n_null;
        END IF;
    END LOOP;
    RAISE NOTICE 'ADR-014 Phase D pre-flight: all tenant-scoped tables fully backfilled.';
END
$$;

-- ── auth ────────────────────────────────────────────────────────────
ALTER TABLE "users"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "user_consents"  ALTER COLUMN "organizationId" SET NOT NULL;

-- ── application ─────────────────────────────────────────────────────
ALTER TABLE "applications"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "application_comments"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "application_drafts"    ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "application_bundles"   ALTER COLUMN "organizationId" SET NOT NULL;

-- ── farm ────────────────────────────────────────────────────────────
ALTER TABLE "farms"                    ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "site_analyses"            ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "training_records"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "plots"                    ALTER COLUMN "organizationId" SET NOT NULL;

-- ── cultivation ─────────────────────────────────────────────────────
ALTER TABLE "planting_cycles"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "planting_cycle_plots"     ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "plant_units"              ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "plant_unit_edit_history"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "cultivation_logs"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "care_logs"                ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "fertilizer_records"       ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "controlled_environments"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "water_sources"            ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "seed_sources"             ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "growing_media"            ALTER COLUMN "organizationId" SET NOT NULL;

-- ── harvest / lot ───────────────────────────────────────────────────
ALTER TABLE "harvest_batches"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "curing_processes"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "drying_processes"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "drying_dark_rooms"        ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "drying_humidity"          ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "drying_temperatures"      ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "packaging_details"        ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "lots"                     ALTER COLUMN "organizationId" SET NOT NULL;

-- ── billing ─────────────────────────────────────────────────────────
ALTER TABLE "invoices"                 ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "quotes"                   ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "payment_transactions"     ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "payment_reconciliations"  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "payment_audits"           ALTER COLUMN "organizationId" SET NOT NULL;

-- ── certification ───────────────────────────────────────────────────
ALTER TABLE "certificates"             ALTER COLUMN "organizationId" SET NOT NULL;

-- ── audit + governance ──────────────────────────────────────────────
ALTER TABLE "audit_logs"               ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "audit_checklists"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "post_audit_tasks"         ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "scope_of_works"           ALTER COLUMN "organizationId" SET NOT NULL;

-- ── system ──────────────────────────────────────────────────────────
ALTER TABLE "meeting_rooms"            ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "revision_deadlines"       ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "report_submissions"       ALTER COLUMN "organizationId" SET NOT NULL;

-- ── trace ───────────────────────────────────────────────────────────
ALTER TABLE "trace_qr_scans"           ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "trace_qr_security"        ALTER COLUMN "organizationId" SET NOT NULL;

-- ── consumer / system ───────────────────────────────────────────────
ALTER TABLE "consumer_feedback"        ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "notifications"            ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "sop_documents"            ALTER COLUMN "organizationId" SET NOT NULL;

-- ── Done ────────────────────────────────────────────────────────────
DO $$
BEGIN
    RAISE NOTICE 'ADR-014 Phase D complete: organizationId NOT NULL on 47 tenant-scoped tables.';
    RAISE NOTICE 'Phase E.1 (RLS observe-only policies) is the next migration.';
END
$$;
