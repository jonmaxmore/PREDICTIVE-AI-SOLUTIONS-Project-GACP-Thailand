/**
 * application-document-sync
 *
 * Best-effort dual-write that mirrors a draft-document upload into the
 * relational `application_documents` table so the fraud-detection scan (which
 * reads `prisma.applicationDocument`) has real rows to work on. The canonical
 * upload storage remains `Application.formData.draftDocuments` (JSON); this
 * sync is additive and MUST NOT block an upload if it fails.
 *
 * documentType is derived from the existing slot taxonomy (validation-slot-utils)
 * so the fraud filters `contains 'PHOTO'` / `'ID'` keep matching. fileHash /
 * photoHash are SHA-256 of the file bytes (exact-duplicate detection). idNumber
 * is intentionally not populated here (needs OCR-at-ingest — deferred).
 *
 * F-G4-15 — WHICH DOCUMENT IS BEING JUDGED.
 *
 * A slot is re-uploadable, and re-uploading used to insert: one draft ended the
 * G4 walk holding 67 rows, six of them ภท.11, and no rule anywhere said which of
 * the six an officer was deciding from. Ordering is not a rule — "the newest"
 * has to be re-derived by every reader, and two rows written in the same
 * millisecond leave it undecided.
 *
 * The rule this module implements is VERSIONED WITH A NAMED CURRENT ROW:
 *   - every upload is still recorded, and nothing is ever deleted;
 *   - at most one row per (application, slot) carries `currentForSlot`, and that
 *     row IS the document the application is judged on. The DB enforces the
 *     "at most one" (@@unique([applicationId, currentForSlot]));
 *   - the rows it replaced keep `supersededAt` + `supersededById`, so the
 *     history reads forwards without sorting anything.
 *
 * Replace-in-place (delete the row that was replaced) was the other candidate
 * and is wrong here: that row is the only owner record the static uploads gate
 * can resolve (middleware/uploads-access.js:311), and an earlier correction
 * round's CorrectionSubmissionVersion.attachments still points at the file it
 * replaced — deleting would make an already-reviewed round's evidence
 * unopenable.
 */

const crypto = require('crypto');
const fs = require('fs');
const logger = require('../shared/logger');
const { getCanonicalSlotId, slotIdSpellings } = require('../routes/api/applications/validation-slot-utils');

// The documentType of an upload that named no slot. Such a row holds no slot,
// so it supersedes nothing and nothing supersedes it.
const UNSLOTTED_DOCUMENT_TYPE = 'UNKNOWN';

function deriveDocumentType(slotId) {
  const canonical = getCanonicalSlotId(slotId);
  if (!canonical) { return UNSLOTTED_DOCUMENT_TYPE; }
  return String(canonical).toUpperCase();
}

/**
 * Every documentType a row of THIS slot could be carrying, past names included.
 *
 * documentType is the canonical slot id AS OF THE DAY THE ROW WAS WRITTEN, and
 * nothing rewrites the old rows. The กทล.1 v2 fold (spec 2026-09-01) renamed six
 * slots, so an application open since before it holds
 * `currentForSlot='LICENSE_BT11'` while a fresh upload of that same ภท.11 derives
 * 'CONTROLLED_HERB_LICENSE'. Matching by exact string would release nothing, and
 * the application would carry TWO rows both claiming to be the current document
 * for one attachment — the F-G4-15 invariant, broken in a way the unique index
 * cannot see because the two strings differ.
 */
function documentTypesOfSlot(slotId) {
  return slotIdSpellings(slotId).map((spelling) => String(spelling).toUpperCase());
}

function sha256OfFile(absolutePath) {
  try {
    if (!absolutePath || !fs.existsSync(absolutePath)) { return null; }
    const buf = fs.readFileSync(absolutePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (err) {
    logger.warn(`[appDocSync] hash failed for ${absolutePath}: ${err.message}`);
    return null;
  }
}

/**
 * Record an uploaded draft document, and make it the slot's current document.
 *
 * Best-effort: logs and swallows errors (never throws to the caller). A
 * swallowed failure degrades safely — `Application.formData.draftDocuments` is
 * still the canonical upload store, and both the uploads gate and the
 * mandatory-document check fall back to it.
 */
async function syncApplicationDocument(prisma, {
  applicationId, documentId, slotId, stepKey,
  fileName, fileUrl, fileSize, mimeType, uploadedBy, absolutePath,
  holderScope = null,
}) {
  try {
    if (!prisma?.applicationDocument || !applicationId || !fileUrl) { return null; }
    // The upload door passes the applicant's holder scope (spec 2026-09-30 §3.1):
    // the three reads below carry its fragment. The backfill script passes none.
    // R1-legacy-pin: removed in Task 12 (→ holderReadWhere): the application the door
    // resolved decides (OR-registered beside the fragment), exactly as pre-R1.
    const scoped = holderScope && Array.isArray(holderScope.readIds)
      ? require('./holder-access').r1HolderOrLegacy(holderScope, 'ApplicationDocument', { applicationId })
      : {};
    const documentType = deriveDocumentType(slotId);
    const isImage = typeof mimeType === 'string' && mimeType.startsWith('image/');
    const hash = sha256OfFile(absolutePath);

    const data = {
      applicationId, documentId: documentId || null, slotId: slotId || null,
      stepKey: stepKey || null, documentType,
      fileName: fileName || null, fileUrl, fileSize: Number.isInteger(fileSize) ? fileSize : null,
      mimeType: mimeType || null,
      fileHash: hash, photoHash: isImage ? hash : null, uploadedBy: uploadedBy || null,
    };

    // Same documentId = the same upload being re-recorded (a retry, or the
    // backfill script re-reading a JSON entry it already mirrored). That is a
    // correction of this row's metadata, NOT a second document for the slot, so
    // it must not supersede anything or bump the version.
    const existing = documentId
      ? await prisma.applicationDocument.findFirst({ where: { applicationId, documentId, ...scoped } })
      : null;
    if (existing) {
      return await prisma.applicationDocument.update({ where: { id: existing.id }, data });
    }

    // An upload that named no slot holds no slot: it stays out of the
    // supersession chain entirely, and out of the unique index — which is what
    // lets two of them coexist.
    if (documentType === UNSLOTTED_DOCUMENT_TYPE) {
      return await prisma.applicationDocument.create({ data: { ...data, currentForSlot: null } });
    }

    // Every name this slot has ever been stored under, so both the version count
    // and the release below address the SLOT and not one spelling of it.
    const slotDocumentTypes = documentTypesOfSlot(slotId);

    const takeTheSlot = async (tx) => {
      // The id is minted here rather than by the column default so the rows
      // this upload supersedes can name their successor in the same write.
      const id = crypto.randomUUID();
      const slotHistory = await tx.applicationDocument.findMany({
        where: { applicationId, documentType: { in: slotDocumentTypes }, ...scoped },
        select: { slotVersion: true },
      });
      const slotVersion = slotHistory.reduce(
        (highest, row) => Math.max(highest, Number(row && row.slotVersion) || 1),
        0,
      ) + 1;

      // THREE steps, because two constraints pull in opposite directions and a
      // single update cannot satisfy both:
      //
      //   @@unique([applicationId, currentForSlot])  the old row must let go
      //                                              BEFORE the insert claims it
      //   supersededById → application_documents.id  nothing may name the
      //                                              successor before it EXISTS
      //
      // Naming the successor in the release (the original shape) failed the FK on
      // every real database — the row it pointed at was created on the next
      // statement — so the transaction aborted and this function, which swallows
      // its errors by design, returned null while the caller answered HTTP 200.
      // Replacing a document in an occupied slot therefore never once worked:
      // three re-uploads in the 2026-09-05 UAT walk left the original row
      // untouched, slotVersion still 1, supersededAt still null.

      // 1 — who currently holds the slot, so step 3 can address exactly them.
      const outgoing = await tx.applicationDocument.findMany({
        where: { applicationId, currentForSlot: { in: slotDocumentTypes }, ...scoped },
        select: { id: true },
      });

      // 2 — release the slot, WITHOUT naming a successor that does not exist yet.
      await tx.applicationDocument.updateMany({
        where: { applicationId, currentForSlot: { in: slotDocumentTypes } },
        data: { currentForSlot: null, supersededAt: new Date() },
      });

      // 3 — the successor exists from here on.
      const created = await tx.applicationDocument.create({
        data: { ...data, id, currentForSlot: documentType, slotVersion },
      });

      // 4 — now the FK can be satisfied: point the released rows at it.
      if (outgoing.length > 0) {
        await tx.applicationDocument.updateMany({
          where: { id: { in: outgoing.map((row) => row.id) } },
          data: { supersededById: id },
        });
      }

      return created;
    };

    // One transaction, so the slot is never left with zero current rows:
    // either the handover happens or neither half of it does.
    return typeof prisma.$transaction === 'function'
      ? await prisma.$transaction(takeTheSlot)
      : await takeTheSlot(prisma);
  } catch (err) {
    logger.warn(`[appDocSync] sync failed (non-fatal) for app ${applicationId}: ${err.message}`);
    return null;
  }
}

/**
 * The applicant deleted the document, so the slot becomes empty.
 *
 * The rows behind it are deliberately NOT promoted back into the slot: the
 * farmer asked for this attachment to be gone, and a file they had already
 * replaced is not their answer either. They keep their supersededAt, and the
 * SetNull self-FK clears their supersededById rather than leaving it pointing
 * at a row that no longer exists.
 */
async function removeApplicationDocument(prisma, applicationId, documentId) {
  try {
    if (!prisma?.applicationDocument || !applicationId || !documentId) { return; }
    await prisma.applicationDocument.deleteMany({ where: { applicationId, documentId } });
  } catch (err) {
    logger.warn(`[appDocSync] remove failed (non-fatal): ${err.message}`);
  }
}

module.exports = {
  syncApplicationDocument,
  removeApplicationDocument,
  deriveDocumentType,
  // Exported 2026-09-05: the resubmit door needs the same "every name this slot
  // has been stored under" answer this module already computes for supersession.
  // It was matching one column against the other column's vocabulary instead.
  documentTypesOfSlot,
  sha256OfFile,
  UNSLOTTED_DOCUMENT_TYPE,
};
