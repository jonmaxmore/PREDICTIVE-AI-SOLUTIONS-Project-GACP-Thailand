-- ============================================================================
-- Add nullable organizationId to all tenant-scoped tables — multi-tenancy
-- Phase 1, step 2 (ADR-014).
--
-- This migration is additive only:
--   - column is nullable (no impact on existing INSERTs)
--   - no FK constraint yet (added in Phase 4 with NOT NULL alteration)
--   - secondary index on organizationId on every table to keep tenant-scoped
--     scans fast once population begins
--
-- Tables NOT in this migration (intentionally global / platform-level):
--   organizations, system_configs, wizard_step_configs, document_templates,
--   role_job_descriptions, certification_standards, standard_requirements,
--   supplementary_criteria, plant_species, document_requirements
-- ============================================================================

-- ── auth domain ─────────────────────────────────────────────────────────
ALTER TABLE "users"          ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "user_consents"  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "users_organizationId_idx"         ON "users"("organizationId");
CREATE INDEX IF NOT EXISTS "user_consents_organizationId_idx" ON "user_consents"("organizationId");

-- ── application domain ──────────────────────────────────────────────────
ALTER TABLE "applications"          ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "application_comments"  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "application_drafts"    ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "application_bundles"   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "applications_organizationId_idx"         ON "applications"("organizationId");
CREATE INDEX IF NOT EXISTS "application_comments_organizationId_idx" ON "application_comments"("organizationId");
CREATE INDEX IF NOT EXISTS "application_drafts_organizationId_idx"   ON "application_drafts"("organizationId");
CREATE INDEX IF NOT EXISTS "application_bundles_organizationId_idx"  ON "application_bundles"("organizationId");

-- ── farm + cultivation domain ───────────────────────────────────────────
ALTER TABLE "farms"                    ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "site_analyses"            ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "training_records"         ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "plots"                    ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "planting_cycles"          ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "planting_cycle_plots"     ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "plant_units"              ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "plant_unit_edit_history"  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "care_logs"                ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "cultivation_logs"         ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "farms_organizationId_idx"                   ON "farms"("organizationId");
CREATE INDEX IF NOT EXISTS "site_analyses_organizationId_idx"           ON "site_analyses"("organizationId");
CREATE INDEX IF NOT EXISTS "training_records_organizationId_idx"        ON "training_records"("organizationId");
CREATE INDEX IF NOT EXISTS "plots_organizationId_idx"                   ON "plots"("organizationId");
CREATE INDEX IF NOT EXISTS "planting_cycles_organizationId_idx"         ON "planting_cycles"("organizationId");
CREATE INDEX IF NOT EXISTS "planting_cycle_plots_organizationId_idx"    ON "planting_cycle_plots"("organizationId");
CREATE INDEX IF NOT EXISTS "plant_units_organizationId_idx"             ON "plant_units"("organizationId");
CREATE INDEX IF NOT EXISTS "plant_unit_edit_history_organizationId_idx" ON "plant_unit_edit_history"("organizationId");
CREATE INDEX IF NOT EXISTS "care_logs_organizationId_idx"               ON "care_logs"("organizationId");
CREATE INDEX IF NOT EXISTS "cultivation_logs_organizationId_idx"        ON "cultivation_logs"("organizationId");

-- ── GACP compliance domain ──────────────────────────────────────────────
ALTER TABLE "water_sources"           ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "growing_media"           ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "seed_sources"            ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "fertilizer_records"      ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "controlled_environments" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "water_sources_organizationId_idx"           ON "water_sources"("organizationId");
CREATE INDEX IF NOT EXISTS "growing_media_organizationId_idx"           ON "growing_media"("organizationId");
CREATE INDEX IF NOT EXISTS "seed_sources_organizationId_idx"            ON "seed_sources"("organizationId");
CREATE INDEX IF NOT EXISTS "fertilizer_records_organizationId_idx"      ON "fertilizer_records"("organizationId");
CREATE INDEX IF NOT EXISTS "controlled_environments_organizationId_idx" ON "controlled_environments"("organizationId");

-- ── harvest + trace domain ──────────────────────────────────────────────
ALTER TABLE "harvest_batches"     ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "drying_temperatures" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "drying_humidity"     ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "drying_dark_rooms"   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "curing_processes"    ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "packaging_details"   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "drying_processes"    ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "lots"                ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "trace_qr_security"   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "trace_qr_scans"      ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "consumer_feedback"   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "harvest_batches_organizationId_idx"     ON "harvest_batches"("organizationId");
CREATE INDEX IF NOT EXISTS "drying_temperatures_organizationId_idx" ON "drying_temperatures"("organizationId");
CREATE INDEX IF NOT EXISTS "drying_humidity_organizationId_idx"     ON "drying_humidity"("organizationId");
CREATE INDEX IF NOT EXISTS "drying_dark_rooms_organizationId_idx"   ON "drying_dark_rooms"("organizationId");
CREATE INDEX IF NOT EXISTS "curing_processes_organizationId_idx"    ON "curing_processes"("organizationId");
CREATE INDEX IF NOT EXISTS "packaging_details_organizationId_idx"   ON "packaging_details"("organizationId");
CREATE INDEX IF NOT EXISTS "drying_processes_organizationId_idx"    ON "drying_processes"("organizationId");
CREATE INDEX IF NOT EXISTS "lots_organizationId_idx"                ON "lots"("organizationId");
CREATE INDEX IF NOT EXISTS "trace_qr_security_organizationId_idx"   ON "trace_qr_security"("organizationId");
CREATE INDEX IF NOT EXISTS "trace_qr_scans_organizationId_idx"      ON "trace_qr_scans"("organizationId");
CREATE INDEX IF NOT EXISTS "consumer_feedback_organizationId_idx"   ON "consumer_feedback"("organizationId");

-- ── certification domain ────────────────────────────────────────────────
ALTER TABLE "certificates" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "certificates_organizationId_idx" ON "certificates"("organizationId");

-- ── billing domain ──────────────────────────────────────────────────────
-- NOTE: invoice_line_items is intentionally OMITTED here — the
-- InvoiceLineItem Prisma model exists in schema but no migration has
-- ever created the underlying table (it is unused by code today; line
-- items are stored as JSON on invoices.items via the
-- buildTaxInvoiceLineItems calculator). When/if the table is created
-- later, the schema already declares organizationId so it will be
-- present from day one.
ALTER TABLE "invoices"                 ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "quotes"                   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "payment_transactions"     ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "payment_audits"           ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "payment_reconciliations"  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_organizationId_idx"                ON "invoices"("organizationId");
CREATE INDEX IF NOT EXISTS "quotes_organizationId_idx"                  ON "quotes"("organizationId");
CREATE INDEX IF NOT EXISTS "payment_transactions_organizationId_idx"    ON "payment_transactions"("organizationId");
CREATE INDEX IF NOT EXISTS "payment_audits_organizationId_idx"          ON "payment_audits"("organizationId");
CREATE INDEX IF NOT EXISTS "payment_reconciliations_organizationId_idx" ON "payment_reconciliations"("organizationId");

-- ── audit domain ────────────────────────────────────────────────────────
ALTER TABLE "audit_logs"          ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "post_audit_tasks"    ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "revision_deadlines"  ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "audit_logs_organizationId_idx"         ON "audit_logs"("organizationId");
CREATE INDEX IF NOT EXISTS "post_audit_tasks_organizationId_idx"   ON "post_audit_tasks"("organizationId");
CREATE INDEX IF NOT EXISTS "revision_deadlines_organizationId_idx" ON "revision_deadlines"("organizationId");

-- ── system / provider domain (tenant-scoped parts) ──────────────────────
ALTER TABLE "notifications"        ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "report_submissions"   ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "sop_documents"        ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "scope_of_works"       ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "audit_checklists"     ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "meeting_rooms"        ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

CREATE INDEX IF NOT EXISTS "notifications_organizationId_idx"      ON "notifications"("organizationId");
CREATE INDEX IF NOT EXISTS "report_submissions_organizationId_idx" ON "report_submissions"("organizationId");
CREATE INDEX IF NOT EXISTS "sop_documents_organizationId_idx"      ON "sop_documents"("organizationId");
CREATE INDEX IF NOT EXISTS "scope_of_works_organizationId_idx"     ON "scope_of_works"("organizationId");
CREATE INDEX IF NOT EXISTS "audit_checklists_organizationId_idx"   ON "audit_checklists"("organizationId");
CREATE INDEX IF NOT EXISTS "meeting_rooms_organizationId_idx"      ON "meeting_rooms"("organizationId");
