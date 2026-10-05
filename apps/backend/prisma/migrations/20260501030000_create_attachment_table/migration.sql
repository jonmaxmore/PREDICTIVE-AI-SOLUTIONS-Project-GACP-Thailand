-- Wave A Phase 32 (G1 foundation) — polymorphic Attachment table.
--
-- Pure additive migration. Existing file-pointer fields scattered across
-- 15+ models stay where they are; consumer migration happens in
-- follow-up PRs. The pattern mirrors Rails ActiveStorage and Odoo
-- ir.attachment — polymorphism via (resModel, resId) instead of a
-- proper FK because Prisma doesn't support polymorphic relations.
--
-- See apps/backend/prisma/schema/attachment.prisma for the full
-- rationale.

CREATE TABLE "attachments" (
    "id"             TEXT NOT NULL,
    "uuid"           TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "resModel"       TEXT NOT NULL,
    "resId"          TEXT NOT NULL,
    "field"          TEXT,
    "fileName"       TEXT NOT NULL,
    "fileUrl"        TEXT NOT NULL,
    "fileSize"       INTEGER NOT NULL,
    "mimeType"       TEXT,
    "fileHash"       TEXT,
    "uploadedBy"     TEXT,
    "isDeleted"      BOOLEAN NOT NULL DEFAULT FALSE,
    "deletedAt"      TIMESTAMP(3),
    "deletedBy"      TEXT,
    "deleteReason"   TEXT,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_uuid_key" ON "attachments" ("uuid");

-- Hot-path indexes (per the schema comment):
CREATE INDEX "attachments_resModel_resId_idx"
    ON "attachments" ("resModel", "resId");
CREATE INDEX "attachments_resModel_resId_field_idx"
    ON "attachments" ("resModel", "resId", "field");
CREATE INDEX "attachments_uploadedBy_idx"
    ON "attachments" ("uploadedBy");
CREATE INDEX "attachments_fileHash_idx"
    ON "attachments" ("fileHash");
CREATE INDEX "attachments_isDeleted_idx"
    ON "attachments" ("isDeleted");
CREATE INDEX "attachments_organizationId_idx"
    ON "attachments" ("organizationId");

-- Tenant FK constraint (matches the pattern from
-- 20260427120300_add_organization_fk_constraints).
ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
