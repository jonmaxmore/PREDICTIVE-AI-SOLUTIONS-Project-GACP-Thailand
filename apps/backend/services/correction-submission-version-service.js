'use strict';

/**
 * Correction submitted-formData version service — R2 M7 (D-6, operator
 * 2026-08-03; evidence/R2-special-reopen/decisions-final.md:23,67).
 *
 * D-6: correction submissions are append-only. Before M7 a farmer's resubmit
 * OVERWROTE Application.formData each round (routes/api/applications/
 * applications.js POST /submit resubmit branch + services/application-service/
 * application-review-revision-methods.js submitRevision), destroying the
 * previously-submitted version. This service ADDS one immutable
 * CorrectionSubmissionVersion row per round so the submitted formData survives
 * the overwrite.
 *
 * EXPAND (Law 3.10): the overwrite of Application.formData is UNCHANGED — the
 * column still holds the latest working copy. This only appends durable history
 * BESIDE it.
 *
 * Contract (mirrors decision-letter-service's round mint):
 *   - MUST be called with the SAME transaction client `prisma` (a tx handle) as
 *     the formData write, so the snapshot and the overwrite commit/rollback
 *     together. A P2002 (same round submitted twice) aborts the transaction,
 *     which rolls the overwrite back too — the previous version is protected.
 *   - roundNo is NOT computed here: it is read from the per-stage CorrectionRound
 *     ledger (M3) for (applicationId, stage) — the current (max) round is the one
 *     the farmer is responding to — so the two ledgers stay consistent.
 *   - Append-only: NEVER updates or deletes a row; a re-write of the same
 *     (applicationId, stage, roundNo) is a DB UNIQUE conflict, not an overwrite.
 *   - No-op (never throws) when the status is not a correction resubmit, or when
 *     no CorrectionRound exists yet (legacy apps that entered the correction
 *     state before M3) — nothing to attribute the submission to.
 */

const { roundStageForResubmitStatus } = require('../shared/correction-round-stage');

/**
 * Best-effort document-refs snapshot from the submitted formData. The resubmit
 * payload carries document references under `formData.draftDocuments`; capture
 * that array when present, else null ("attachments … at submit, if available").
 *
 * @param {unknown} formDataSnapshot
 * @returns {Array<unknown>|null}
 */
function deriveAttachmentsSnapshot(formDataSnapshot) {
    if (formDataSnapshot && typeof formDataSnapshot === 'object' && Array.isArray(formDataSnapshot.draftDocuments)) {
        return formDataSnapshot.draftDocuments;
    }
    return null;
}

/**
 * Append one immutable CorrectionSubmissionVersion for a correction resubmit.
 *
 * @param {object} args
 * @param {object} args.prisma           Prisma client OR (preferred) tx handle
 *   of the formData write.
 * @param {string} args.applicationId
 * @param {string} args.fromStatus       Application.status the resubmit departs
 *   from (REVISION_REQUESTED → DOC_REVIEW; CAR_PENDING → FIELD_AUDIT; anything
 *   else → no-op).
 * @param {object} args.formDataSnapshot The exact formData written to
 *   Application.formData for this round (the immutable snapshot).
 * @param {Array<unknown>|null} [args.attachmentsSnapshot] Explicit attachments
 *   snapshot; when omitted, derived from formDataSnapshot.draftDocuments.
 * @returns {Promise<{ snapshotted: boolean, stage?: string, roundNo?: number, id?: string, reason?: string }>}
 * @throws {Error} code CORRECTION_SUBMISSION_ALREADY_RECORDED on a P2002 — the
 *   round's submission was already recorded (append-only conflict).
 */
async function snapshotCorrectionSubmission({
    prisma,
    applicationId,
    fromStatus,
    formDataSnapshot,
    attachmentsSnapshot,
}) {
    if (!prisma) { throw new TypeError('snapshotCorrectionSubmission: prisma required'); }
    if (!applicationId) { throw new TypeError('snapshotCorrectionSubmission: applicationId required'); }

    const stage = roundStageForResubmitStatus(fromStatus);
    if (!stage) {
        // Not a correction resubmit (e.g. DRAFT initial submit) — nothing to
        // version. No-op, no history row.
        return { snapshotted: false, reason: 'NOT_A_CORRECTION_RESUBMIT' };
    }

    // roundNo comes from the M3 ledger: the current (max) round for this
    // (application, stage) is the one the farmer is responding to. organizationId
    // mirrors the round's tenant (tx clients bypass the tenant extension, so it
    // is stamped explicitly — M1/M3 idiom).
    const round = await prisma.correctionRound.findFirst({
        where: { applicationId, stage },
        orderBy: { roundNo: 'desc' },
        select: { roundNo: true, organizationId: true },
    });
    if (!round) {
        // Legacy app that entered the correction state before M3 minted rounds —
        // no round to key the snapshot to. No-op (do not fabricate a round).
        return { snapshotted: false, reason: 'NO_CORRECTION_ROUND' };
    }

    const attachments = attachmentsSnapshot !== undefined
        ? attachmentsSnapshot
        : deriveAttachmentsSnapshot(formDataSnapshot);

    try {
        const row = await prisma.correctionSubmissionVersion.create({
            data: {
                applicationId,
                stage,
                roundNo: round.roundNo,
                // formDataSnapshot is a NOT NULL Json column — store the submitted
                // working copy (default to {} only if the caller passed nothing).
                formDataSnapshot: (formDataSnapshot && typeof formDataSnapshot === 'object') ? formDataSnapshot : {},
                attachmentsSnapshot: attachments,
                organizationId: round.organizationId,
            },
            select: { id: true },
        });
        return { snapshotted: true, stage, roundNo: round.roundNo, id: row.id };
    } catch (error) {
        if (error?.code === 'P2002') {
            // Append-only guarantee: a submission for this (app, stage, round) is
            // already recorded. This is a DB-level conflict, NOT an overwrite —
            // fail loudly so the caller's transaction rolls the overwrite back too.
            const conflict = new Error(
                `[CorrectionSubmissionVersion] round ${round.roundNo} (${stage}) already recorded for application ${applicationId} `
                + '— append-only: a round\'s submission cannot be overwritten (P2002)',
            );
            conflict.code = 'CORRECTION_SUBMISSION_ALREADY_RECORDED';
            conflict.statusCode = 409;
            conflict.status = 409;
            throw conflict;
        }
        throw error;
    }
}

module.exports = {
    snapshotCorrectionSubmission,
    deriveAttachmentsSnapshot,
};
