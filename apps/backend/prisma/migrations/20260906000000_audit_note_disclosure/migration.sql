-- F-TNT-M30-01 — PDPA ม.30 disclosure switch on an auditor's checklist note.
--
-- Additive only, and every statement is IF NOT EXISTS so the migration is safe to
-- re-run and cannot abort a deploy half way. No existing row changes meaning:
-- `disclosureWithheld` defaults to FALSE, which is the ม.30 วรรคหนึ่ง default —
-- the farmer may see what was written about them unless someone recorded a reason
-- not to.
ALTER TABLE "farm_audit_checklist_items"
    ADD COLUMN IF NOT EXISTS "disclosureWithheld" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "farm_audit_checklist_items"
    ADD COLUMN IF NOT EXISTS "withholdReason" TEXT;

ALTER TABLE "farm_audit_checklist_items"
    ADD COLUMN IF NOT EXISTS "withheldBy" TEXT;

ALTER TABLE "farm_audit_checklist_items"
    ADD COLUMN IF NOT EXISTS "withheldAt" TIMESTAMP(3);

-- The applicant's own read filters on this column, so it is worth an index only
-- where it is selective; withheld rows are the exception, so a partial index keeps
-- it small.
CREATE INDEX IF NOT EXISTS "farm_audit_checklist_items_withheld_idx"
    ON "farm_audit_checklist_items" ("auditId")
    WHERE "disclosureWithheld" = true;
