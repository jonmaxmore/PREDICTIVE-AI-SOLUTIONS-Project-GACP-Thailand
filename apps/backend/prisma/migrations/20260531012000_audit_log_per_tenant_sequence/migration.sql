-- AuditLog hash chain is per-tenant (ADR-014): replace the global unique on
-- sequenceNumber with a composite unique scoped to the organization, so each
-- tenant owns an independent, gap-free hash chain. Safe drop+create: the
-- audit_logs table carries no rows at cut-over (platform pre-launch), so no
-- existing chain is invalidated.

-- DropIndex
DROP INDEX "audit_logs_sequenceNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_organizationId_sequenceNumber_key" ON "audit_logs"("organizationId", "sequenceNumber");
