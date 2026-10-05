-- ============================================================================
-- ADR-014 Phase E.1 — extend RLS observe-only to remaining tenant tables
--
-- The 2026-04-29 migration covered the 5 highest-risk tables (applications,
-- invoices, certificates, payment_transactions, audit_logs). This migration
-- applies the same observe-only template to the remaining 44 tables that
-- carry an `organizationId` column.
--
-- Same primitives as 20260429100100_rls_phase_e1_observe_only:
--   - current_tenant_id() reads `app.tenant_id` GUC
--   - rls_observe_check(table_name, row_org_id) always returns TRUE (permissive)
--     and RAISES NOTICE on missing-context or cross-tenant access
--
-- After this lands, RLS is enabled on every tenant table in the schema, so
-- the observation window in Phase E.2 (flip permissive → restrictive) sees
-- the full surface, not a partial slice.
--
-- Functional risk: zero. The policy is permissive — queries that worked
-- before still work. The only behaviour change is more NOTICE entries in
-- Postgres logs when calls hit these tables without tenant context.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    t TEXT;
    target_tables TEXT[] := ARRAY[
        'application_bundles',
        'application_comments',
        'application_drafts',
        'audit_checklists',
        'bank_accounts',
        'care_logs',
        'consumer_feedback',
        'controlled_environments',
        'cultivation_logs',
        'curing_processes',
        'drying_dark_rooms',
        'drying_humidity',
        'drying_processes',
        'drying_temperatures',
        'farms',
        'fertilizer_records',
        'growing_media',
        'harvest_batches',
        'invoice_line_items',
        'lots',
        'meeting_rooms',
        'notifications',
        'packaging_details',
        'payment_audits',
        'payment_reconciliations',
        'payment_slips',
        'plant_unit_edit_history',
        'plant_units',
        'planting_cycle_plots',
        'planting_cycles',
        'plots',
        'post_audit_tasks',
        'quotes',
        'report_submissions',
        'revision_deadlines',
        'scope_of_works',
        'seed_sources',
        'site_analyses',
        'sop_documents',
        'subscriptions',
        'trace_qr_scans',
        'trace_qr_security',
        'training_records',
        'user_consents',
        'users',
        'water_sources'
    ];
BEGIN
    FOREACH t IN ARRAY target_tables LOOP
        -- Skip if the table doesn't exist (e.g., a fresh DB that hasn't
        -- run all upstream migrations yet — the migrate runner will fix
        -- ordering, but defensive skipping saves us from race conditions).
        IF NOT EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = t
        ) THEN
            RAISE NOTICE 'RLS-EXTEND: table % does not exist, skipping', t;
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_observe_tenant', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO PUBLIC '
            'USING (rls_observe_check(%L, "organizationId")) '
            'WITH CHECK (rls_observe_check(%L, "organizationId"))',
            t || '_observe_tenant', t, t, t
        );
    END LOOP;

    RAISE NOTICE 'ADR-014 Phase E.1 extended: RLS observe-only now covers all 49 tenant tables.';
    RAISE NOTICE 'Phase E.2 (flip permissive → restrictive) requires 7 days of zero NOTICE entries before flipping.';
END
$$;

COMMIT;
