-- ============================================================================
-- Add FK constraints from tenant-scoped tables to organizations(id).
-- Multi-tenancy Phase 3a (ADR-014). Additive — column remains NULLABLE so
-- existing INSERTs that don't provide organizationId still succeed; the FK
-- only kicks in when a non-null value is supplied. This catches programmer
-- errors (typos, copy-paste of an obsolete org id) without enforcing that
-- every write provides one. NOT NULL alteration follows in a later migration
-- after the write-path audit.
--
-- Each constraint uses ON DELETE RESTRICT (default) — an Organization row
-- cannot be deleted while any tenant row still references it. If a tenant
-- needs to be archived, the lifecycle should go through Organization.status
-- = 'ARCHIVED' rather than DELETE.
--
-- Validation: ALTER TABLE ... ADD CONSTRAINT runs the FK check against
-- existing rows. The Phase 1.3 backfill (20260427120200_backfill_default
-- _organization) already ensured every row has a valid organizationId, so
-- the constraint creation is expected to succeed without errors.
-- ============================================================================

-- ── auth ────────────────────────────────────────────────────────────────
ALTER TABLE "users"          ADD CONSTRAINT "users_organizationId_fkey"          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_consents"  ADD CONSTRAINT "user_consents_organizationId_fkey"  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── application ─────────────────────────────────────────────────────────
ALTER TABLE "applications"          ADD CONSTRAINT "applications_organizationId_fkey"          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_comments"  ADD CONSTRAINT "application_comments_organizationId_fkey"  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_drafts"    ADD CONSTRAINT "application_drafts_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_bundles"   ADD CONSTRAINT "application_bundles_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── farm + cultivation ──────────────────────────────────────────────────
ALTER TABLE "farms"                    ADD CONSTRAINT "farms_organizationId_fkey"                    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "site_analyses"            ADD CONSTRAINT "site_analyses_organizationId_fkey"            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_records"         ADD CONSTRAINT "training_records_organizationId_fkey"         FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plots"                    ADD CONSTRAINT "plots_organizationId_fkey"                    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "planting_cycles"          ADD CONSTRAINT "planting_cycles_organizationId_fkey"          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "planting_cycle_plots"     ADD CONSTRAINT "planting_cycle_plots_organizationId_fkey"     FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_units"              ADD CONSTRAINT "plant_units_organizationId_fkey"              FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_unit_edit_history"  ADD CONSTRAINT "plant_unit_edit_history_organizationId_fkey"  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "care_logs"                ADD CONSTRAINT "care_logs_organizationId_fkey"                FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cultivation_logs"         ADD CONSTRAINT "cultivation_logs_organizationId_fkey"         FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── GACP compliance ─────────────────────────────────────────────────────
ALTER TABLE "water_sources"           ADD CONSTRAINT "water_sources_organizationId_fkey"           FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "growing_media"           ADD CONSTRAINT "growing_media_organizationId_fkey"           FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seed_sources"            ADD CONSTRAINT "seed_sources_organizationId_fkey"            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fertilizer_records"      ADD CONSTRAINT "fertilizer_records_organizationId_fkey"      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "controlled_environments" ADD CONSTRAINT "controlled_environments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── harvest + trace ─────────────────────────────────────────────────────
ALTER TABLE "harvest_batches"     ADD CONSTRAINT "harvest_batches_organizationId_fkey"     FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drying_temperatures" ADD CONSTRAINT "drying_temperatures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drying_humidity"     ADD CONSTRAINT "drying_humidity_organizationId_fkey"     FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drying_dark_rooms"   ADD CONSTRAINT "drying_dark_rooms_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "curing_processes"    ADD CONSTRAINT "curing_processes_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packaging_details"   ADD CONSTRAINT "packaging_details_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drying_processes"    ADD CONSTRAINT "drying_processes_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lots"                ADD CONSTRAINT "lots_organizationId_fkey"                FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trace_qr_security"   ADD CONSTRAINT "trace_qr_security_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trace_qr_scans"      ADD CONSTRAINT "trace_qr_scans_organizationId_fkey"      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumer_feedback"   ADD CONSTRAINT "consumer_feedback_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── certification ───────────────────────────────────────────────────────
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── billing ─────────────────────────────────────────────────────────────
-- invoice_line_items omitted intentionally — see migration
-- 20260427120100_add_organization_id_columns for the explanation.
ALTER TABLE "invoices"                 ADD CONSTRAINT "invoices_organizationId_fkey"                 FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes"                   ADD CONSTRAINT "quotes_organizationId_fkey"                   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_transactions"     ADD CONSTRAINT "payment_transactions_organizationId_fkey"     FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_audits"           ADD CONSTRAINT "payment_audits_organizationId_fkey"           FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_reconciliations"  ADD CONSTRAINT "payment_reconciliations_organizationId_fkey"  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── audit ───────────────────────────────────────────────────────────────
ALTER TABLE "audit_logs"          ADD CONSTRAINT "audit_logs_organizationId_fkey"          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "post_audit_tasks"    ADD CONSTRAINT "post_audit_tasks_organizationId_fkey"    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revision_deadlines"  ADD CONSTRAINT "revision_deadlines_organizationId_fkey"  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── system / provider ───────────────────────────────────────────────────
ALTER TABLE "notifications"        ADD CONSTRAINT "notifications_organizationId_fkey"        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_submissions"   ADD CONSTRAINT "report_submissions_organizationId_fkey"   FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sop_documents"        ADD CONSTRAINT "sop_documents_organizationId_fkey"        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scope_of_works"       ADD CONSTRAINT "scope_of_works_organizationId_fkey"       FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_checklists"     ADD CONSTRAINT "audit_checklists_organizationId_fkey"     FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meeting_rooms"        ADD CONSTRAINT "meeting_rooms_organizationId_fkey"        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
