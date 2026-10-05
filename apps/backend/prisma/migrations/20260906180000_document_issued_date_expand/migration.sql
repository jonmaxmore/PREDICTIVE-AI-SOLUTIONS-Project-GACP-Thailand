-- Expand-only: the date printed ON an uploaded paper, so RequirementRule.maxDocumentAgeMonths
-- ("ออกให้ไม่เกิน 6 เดือน") finally has something to compare against. Nullable, no backfill:
-- a paper already on file has no stated issue date and must read as UNKNOWN, never as fresh.
ALTER TABLE "application_documents" ADD COLUMN IF NOT EXISTS "issuedDate" TIMESTAMP(3);
