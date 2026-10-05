-- CreateTable
CREATE TABLE "assignment_ledger_entries" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assigneeUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "role" TEXT,
    "previousAssigneeUserId" TEXT,
    "source" TEXT,
    "reason" TEXT,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "assignment_ledger_entries_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "assignment_ledger_assignee_org_created_idx" ON "assignment_ledger_entries"("assigneeUserId", "organizationId", "createdAt" DESC);
-- CreateIndex
CREATE INDEX "assignment_ledger_assignedby_org_created_idx" ON "assignment_ledger_entries"("assignedByUserId", "organizationId", "createdAt" DESC);
-- CreateIndex
CREATE INDEX "assignment_ledger_entity_created_idx" ON "assignment_ledger_entries"("entityType", "entityId", "createdAt" DESC);
-- CreateIndex
CREATE INDEX "assignment_ledger_entries_organizationId_createdAt_idx" ON "assignment_ledger_entries"("organizationId", "createdAt" DESC);
-- AddForeignKey
ALTER TABLE "assignment_ledger_entries" ADD CONSTRAINT "assignment_ledger_entries_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assignment_ledger_entries" ADD CONSTRAINT "assignment_ledger_entries_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assignment_ledger_entries" ADD CONSTRAINT "assignment_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
