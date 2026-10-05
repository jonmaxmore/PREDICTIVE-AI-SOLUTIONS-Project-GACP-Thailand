-- DB-06: add indexes on foreign-key columns that lacked a leading-column index.
-- Postgres does NOT auto-index FK columns; these cover join lookups and the
-- sequential scans Postgres performs on ON DELETE Restrict parent-delete checks
-- (e.g. deleting a farm previously scanned certificates / harvest_batches fully).
-- Index names are the Prisma defaults (<table>_<column>_idx) so the schema's
-- @@index declarations keep `prisma migrate diff` (migrations vs schema) at zero.

-- CreateIndex
CREATE INDEX "applications_standardCode_idx" ON "applications"("standardCode");

-- CreateIndex
CREATE INDEX "certificates_applicationId_idx" ON "certificates"("applicationId");

-- CreateIndex
CREATE INDEX "certificates_farmId_idx" ON "certificates"("farmId");

-- CreateIndex
CREATE INDEX "certificates_standardCode_idx" ON "certificates"("standardCode");

-- CreateIndex
CREATE INDEX "drying_processes_cycleId_idx" ON "drying_processes"("cycleId");

-- CreateIndex
CREATE INDEX "entity_context_switches_fromEntityId_idx" ON "entity_context_switches"("fromEntityId");

-- CreateIndex
CREATE INDEX "harvest_batches_cycleId_idx" ON "harvest_batches"("cycleId");

-- CreateIndex
CREATE INDEX "harvest_batches_farmId_idx" ON "harvest_batches"("farmId");

-- CreateIndex
CREATE INDEX "harvest_batches_plantCode_idx" ON "harvest_batches"("plantCode");

-- CreateIndex
CREATE INDEX "invoices_quoteId_idx" ON "invoices"("quoteId");

-- CreateIndex
CREATE INDEX "invoices_subscriptionId_idx" ON "invoices"("subscriptionId");

-- CreateIndex
CREATE INDEX "meeting_rooms_hostId_idx" ON "meeting_rooms"("hostId");

-- CreateIndex
CREATE INDEX "payment_slips_bankAccountId_idx" ON "payment_slips"("bankAccountId");

-- CreateIndex
CREATE INDEX "payment_slips_subscriptionId_idx" ON "payment_slips"("subscriptionId");

-- CreateIndex
CREATE INDEX "planting_cycles_plantSpeciesId_idx" ON "planting_cycles"("plantSpeciesId");

-- CreateIndex
CREATE INDEX "planting_cycles_plotId_idx" ON "planting_cycles"("plotId");

-- CreateIndex
CREATE INDEX "scope_of_works_assignedAuditorId_idx" ON "scope_of_works"("assignedAuditorId");

-- CreateIndex
CREATE INDEX "work_activities_completedBy_idx" ON "work_activities"("completedBy");
