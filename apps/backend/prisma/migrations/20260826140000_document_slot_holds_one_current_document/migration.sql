-- =============================================================================
-- A document slot holds ONE current document, and says which one it is.
-- =============================================================================
--
-- Ledger F-G4-15. Every upload into `application_documents` was an INSERT, so a
-- single draft from the G4 walk ended up holding 67 rows — six of them the ภท.11
-- slot, because the farmer re-uploaded that slot six times. Nothing in the data
-- said which of the six an officer was judging, and "the newest one" is not an
-- answer: it has to be re-derived by every reader, and two rows written in the
-- same millisecond leave it undecided.
--
-- ADDITIVE ONLY. No row is deleted here, and no row's existing column changes.
-- Superseded rows are KEPT on purpose — three readers need them to exist:
--   * middleware/uploads-access.js:311 authorises a stored file by finding its
--     row, so deleting the row makes a file an officer may still legitimately
--     open (see the next point) unauthorised;
--   * CorrectionSubmissionVersion.attachments snapshots the file URLs of an
--     earlier correction round — an already-reviewed round must stay openable
--     after the farmer replaces a file for the next round;
--   * the fraud scan's cross-application photo-duplicate search reads every row
--     ever recorded (services/fraud-detection/duplicate-farm-methods.js:279).
--
-- Ships in the same change as prisma/schema/application-document.prisma and
-- services/application-document-sync.js, because .github/workflows/ci.yml runs
-- `migration-drift-check` (prisma migrate diff --from-migrations --to-schema-
-- datamodel --exit-code) as a required gate: SQL whose columns are absent from
-- the schema turns that job red the moment it lands.
--
-- -----------------------------------------------------------------------------
-- 1. The columns
-- -----------------------------------------------------------------------------
-- "currentForSlot" holds the row's own "documentType" for exactly as long as the
-- row is the slot's live document, and NULL once another upload takes the slot.
-- Postgres treats NULLs as distinct inside a unique index, which is what makes
-- the index in step 3 read "at most ONE live document per (application, slot),
-- any number of superseded ones".
ALTER TABLE "application_documents"
  ADD COLUMN "currentForSlot" TEXT,
  ADD COLUMN "slotVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "supersededById" TEXT;

-- -----------------------------------------------------------------------------
-- 2. Backfill: record the answer the existing data already gives, and ONLY that
-- -----------------------------------------------------------------------------
-- A slot that holds exactly one row is not ambiguous — that row is the document
-- being judged, and saying so is a transcription, not a decision.
--
-- A slot that holds several rows IS ambiguous, and this migration deliberately
-- does NOT pick for it. Every one of those rows stays NULL, i.e. "no row here is
-- marked as the one being judged", which is the truth about data written before
-- the rule existed. Choosing among them (or deleting the losers) is an operator
-- decision on real farmer evidence, not something a schema migration may do
-- quietly. The query that lists exactly those slots is at the bottom of this
-- file.
UPDATE "application_documents" AS d
SET "currentForSlot" = d."documentType"
WHERE d."documentType" <> 'UNKNOWN'
  AND NOT EXISTS (
    SELECT 1
    FROM "application_documents" AS other
    WHERE other."applicationId" = d."applicationId"
      AND other."documentType" = d."documentType"
      AND other."id" <> d."id"
  );

-- -----------------------------------------------------------------------------
-- 3. The guarantee
-- -----------------------------------------------------------------------------
-- Written after the backfill so it validates against the backfilled data: if any
-- application somehow ends up with two live rows for one slot, this migration
-- fails loudly here instead of shipping a rule that is not enforced.
CREATE UNIQUE INDEX "application_documents_applicationId_currentForSlot_key"
  ON "application_documents"("applicationId", "currentForSlot");

-- The supersession pointer is a real FK so it can never dangle. ON DELETE SET
-- NULL: when the applicant deletes the current document, the rows it replaced
-- keep their "supersededAt" and lose only the pointer to a row that is gone.
ALTER TABLE "application_documents"
  ADD CONSTRAINT "application_documents_supersededById_fkey"
  FOREIGN KEY ("supersededById") REFERENCES "application_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- LEFT FOR THE OPERATOR — the slots this migration refused to decide
-- -----------------------------------------------------------------------------
-- Rows written before the rule existed, in slots that hold more than one of
-- them, have no current document. New uploads are unaffected: the next upload
-- into such a slot becomes its current document and the old rows stay history.
-- What is left undecided is an application that never re-uploads again.
--
-- To see them:
--
--   SELECT "applicationId", "documentType", COUNT(*) AS rows,
--          MIN("createdAt") AS first_upload, MAX("createdAt") AS last_upload
--   FROM "application_documents"
--   WHERE "currentForSlot" IS NULL AND "supersededAt" IS NULL
--     AND "documentType" <> 'UNKNOWN'
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1
--   ORDER BY rows DESC;
--
-- Deciding them means, per (applicationId, documentType): pick the row the
-- application is to be judged on, set its "currentForSlot" to its
-- "documentType", and stamp the rest with "supersededAt" and "supersededById"
-- pointing at the winner. The defensible pick is the row whose "documentId"
-- still appears in that application's Application.formData.draftDocuments —
-- that JSON is the canonical upload store and already keeps one entry per slot,
-- so it is the copy the farmer sees and the copy the mandatory-document check
-- reads. Where the JSON has no matching entry the document was deleted from the
-- wizard and NONE of the rows should be made current.
--
-- Rollback (this migration is reversible; no data is lost by undoing it):
--   ALTER TABLE "application_documents"
--     DROP CONSTRAINT "application_documents_supersededById_fkey";
--   DROP INDEX "application_documents_applicationId_currentForSlot_key";
--   ALTER TABLE "application_documents"
--     DROP COLUMN "supersededById", DROP COLUMN "supersededAt",
--     DROP COLUMN "slotVersion", DROP COLUMN "currentForSlot";
