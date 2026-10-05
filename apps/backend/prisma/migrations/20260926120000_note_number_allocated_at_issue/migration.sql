-- Credit / debit note numbers are allocated at ISSUE, not at DRAFT
-- (operator ruling 2026-09-26: a document's number year equals the year it
-- prints; a draft made on 31 Dec and issued on 2 Jan is a next-year document,
-- and an abandoned draft must not consume a number from the series).
--
-- Expand-only: a DRAFT row now carries no number (NULL). The unique indexes
-- stay; PostgreSQL allows any number of NULLs under a unique index. Code
-- older than this migration still writes a number at DRAFT and keeps working.
--
-- Rollback (only while no DRAFT row has a NULL number):
--   ALTER TABLE "credit_notes" ALTER COLUMN "creditNoteNumber" SET NOT NULL;
--   ALTER TABLE "debit_notes"  ALTER COLUMN "debitNoteNumber"  SET NOT NULL;
ALTER TABLE "credit_notes" ALTER COLUMN "creditNoteNumber" DROP NOT NULL;
ALTER TABLE "debit_notes" ALTER COLUMN "debitNoteNumber" DROP NOT NULL;
