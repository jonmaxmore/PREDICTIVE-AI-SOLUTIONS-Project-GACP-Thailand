-- CreateTable
CREATE TABLE "farm_audit_checklist_items" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "auditId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "notes" TEXT,
    "isCritical" BOOLEAN NOT NULL,
    "maxPoints" INTEGER NOT NULL,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_audit_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_audit_photos" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "auditId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "gpsLatitude" DOUBLE PRECISION NOT NULL,
    "gpsLongitude" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "caption" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "checklistItemId" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "farm_audit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farm_audit_checklist_items_auditId_itemCode_key" ON "farm_audit_checklist_items"("auditId", "itemCode");

-- CreateIndex
CREATE INDEX "farm_audit_photos_auditId_idx" ON "farm_audit_photos"("auditId");

-- CreateIndex
CREATE INDEX "farm_audit_photos_organizationId_idx" ON "farm_audit_photos"("organizationId");

-- CreateIndex
CREATE INDEX "farm_audit_photos_attachmentId_idx" ON "farm_audit_photos"("attachmentId");

-- CreateIndex
CREATE INDEX "farm_audit_photos_checklistItemId_idx" ON "farm_audit_photos"("checklistItemId");

-- CreateIndex
CREATE INDEX "farm_audit_photos_uploadedBy_idx" ON "farm_audit_photos"("uploadedBy");

-- AddForeignKey
ALTER TABLE "farm_audit_checklist_items" ADD CONSTRAINT "farm_audit_checklist_items_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audit_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_audit_photos" ADD CONSTRAINT "farm_audit_photos_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audit_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_audit_photos" ADD CONSTRAINT "farm_audit_photos_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "farm_audit_checklist_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_audit_photos" ADD CONSTRAINT "farm_audit_photos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
