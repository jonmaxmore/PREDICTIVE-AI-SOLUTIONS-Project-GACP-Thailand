/**
 * ส่งกลับให้เจ้าหน้าที่ตรวจ — the applicant returns ONE paper, not the whole filing.
 *
 *   POST /api/applications/:id/revision-resubmit
 *
 * ── THE ROUND TRIP THIS ENDS ──────────────────────────────────────────────────
 * Before the per-slot review an application came back as "แก้ไข" with one note,
 * so the applicant re-uploaded everything they had — they could not tell which
 * paper was the problem — and the officer then re-read nine documents to find
 * the one that had changed. Both sides paid for one bad scan of a title deed.
 *
 * This door is the other end of routes/api/provider/document-reviews.js. It
 * accepts only when every paper the officer actually asked for has been REPLACED
 * — not merely present, replaced — and then walks the filing back into the
 * review queue and tells the officer.
 *
 * ── WHAT IT REFUSES, AND WHY THAT ORDER ───────────────────────────────────────
 * Wrong state first (the filing is not under revision at all), then the papers.
 * An applicant on the wrong screen should hear that, not a list of documents
 * that has nothing to do with their problem.
 *
 * @module routes/api/applications/revision-resubmit
 */

'use strict';

const express = require('express');

const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { lookup, getMessage } = require('../../../shared/error-codes');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const applicationService = require('../../../services/application-service');
const { getHealthScopeOptions } = require('../helpers/applications-helpers');
const { holderScope, r1ApplicationHolderOrPin, r1HolderOrLegacy } = require('../../../services/holder-access');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
const { documentTypesOfSlot } = require('../../../services/application-document-sync');
const {
    assertRevisionSlotsRefreshed,
    nextRound,
    REVISION_INCOMPLETE,
} = require('../../../services/application-document-review-service');

const router = express.Router();

/** The state a revision resubmit walks out of, and into. */
const FROM_STATE = 'REVISION_REQUESTED';
const TO_STATE = 'ASSIGNED_FOR_REVIEW';
const WRONG_STATE = 'REVISION_RESUBMIT_WRONG_STATE';

const ANSWERABLE = new Set([REVISION_INCOMPLETE, WRONG_STATE, 'VALIDATION_ERROR']);

function answer(res, err, where) {
    const code = err && err.code;
    if (code && ANSWERABLE.has(code)) {
        const row = lookup(code);
        return res.status(row ? row.httpStatus : 409).json({
            success: false,
            error: code,
            code,
            message: err.message,
            // `message` is a reserved envelope key stripped from non-2xx bodies
            // by the browser client; messageTh survives into .meta.
            messageTh: err.messageTh || (row ? getMessage(code, 'th') : null),
            // Named, so the screen highlights the rows still outstanding rather
            // than making the applicant compare two lists by eye.
            ...(err.slotIds ? { slotIds: err.slotIds } : {}),
        });
    }
    logger.error(`[revision-resubmit] ${where} failed: ${err && err.message}`, { stack: err && err.stack });
    return res.status(500).json({
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        code: 'REVISION_RESUBMIT_FAILED',
        messageTh: 'ระบบส่งคำขอกลับให้เจ้าหน้าที่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    });
}


/**
 * Where-clause for "the papers the applicant has attached for these slots".
 *
 * ApplicationDocument stores the slot TWICE — `slotId` ('land_rights') and the
 * derived `documentType` ('LAND_RIGHTS') — and `slotId` is nullable, so rows
 * written before that column existed carry only the type. This door queried
 * `documentType` using the review rows' `slotId` vocabulary, so it matched
 * nothing at all: every requested slot looked un-refreshed and EVERY resubmit
 * was refused, telling the applicant to upload a document they had just
 * uploaded. Proved on a real Postgres in the 2026-09-05 UAT walk —
 * `documentType IN ('land_rights')` returned 0 rows, `slotId IN ('land_rights')`
 * returned 1.
 *
 * Both spellings, one application.
 */
function buildRequestedSlotDocumentFilter(applicationId, slotIds) {
    const slots = Array.from(new Set((slotIds || []).filter(Boolean).map(String)));
    const types = Array.from(new Set(slots.flatMap((slotId) => documentTypesOfSlot(slotId))));
    return {
        applicationId,
        OR: [
            { slotId: { in: slots } },
            { documentType: { in: types } },
        ],
    };
}

router.post('/:id/revision-resubmit', authenticateHealth, async (req, res) => {
    try {
        const identity = await applicationService.resolveHealthIdentity(
            req.user.id, getHealthScopeOptions(req.user),
        );
        const scope = await holderScope(req);
        const application = await prisma.application.findFirst({
            where: {
                id: req.params.id,
                // No capability gate runs before this door writes the status, so the
                // filer pin is what keeps a co-member out (R1-legacy-pin: removed in Task 12,
                // when Task 9's submit gate covers this door).
                // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(scope, 'Application')).
                // OR form: neutral also when no entity context is bound (final review C1).
                ...r1ApplicationHolderOrPin(scope, { healthId: identity.healthId }),
                isDeleted: false,
            },
        });
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const fromStatus = String(application.status || '').toUpperCase();
        if (fromStatus !== FROM_STATE) {
            // Before the document check: someone on the wrong screen needs to
            // hear THAT, not a list of papers unrelated to their problem.
            return answer(res, Object.assign(
                new Error(`A revision resubmit needs the filing to be ${FROM_STATE}, not ${fromStatus}`),
                {
                    code: WRONG_STATE,
                    messageTh: 'คำขอนี้ไม่ได้อยู่ในสถานะรอแก้ไขเอกสาร จึงส่งกลับให้เจ้าหน้าที่ไม่ได้',
                },
            ), 'POST /:id/revision-resubmit');
        }

        const reviews = await prisma.applicationDocumentReview.findMany({
            where: { applicationId: application.id },
            orderBy: { createdAt: 'asc' },
        });
        const round = nextRound(reviews);
        const requestedRows = reviews.filter(
            (r) => r.round === round && r.verdict === 'MORE_REQUESTED',
        );

        // What the applicant has attached for those slots, newest wins.
        const documents = await prisma.applicationDocument.findMany({
            where: {
                // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere, with the filter
                // spread back): the gated application decides. The filter carries its own
                // OR, so it moves into AND.
                ...r1HolderOrLegacy(scope, 'ApplicationDocument', { applicationId: application.id }),
                AND: [buildRequestedSlotDocumentFilter(
                    application.id,
                    requestedRows.map((r) => r.slotId),
                )],
            },
            select: { slotId: true, documentType: true, createdAt: true },
        });

        // Replaced, not merely present — the paper WAS attached when the officer
        // refused it.
        // A row may carry the slot under either spelling, so report the one the
        // review rows speak — `slotId` when present, the derived type otherwise.
        const canonicalSlotOf = (doc) => (doc.slotId
            || requestedRows.find((r) => documentTypesOfSlot(r.slotId).includes(doc.documentType))?.slotId
            || doc.documentType);
        assertRevisionSlotsRefreshed(
            requestedRows.map((r) => ({ slotId: r.slotId, createdAt: r.createdAt })),
            documents.map((d) => ({ slotId: canonicalSlotOf(d), uploadedAt: d.createdAt })),
        );

        // Never a raw status write: the transition service owns the edge, the
        // audit row and the workflow history.
        await writeApplicationStatus({
            prisma,
            applicationId: application.id,
            fromStatus,
            toStatus: TO_STATE,
            actorId: identity.userId,
            actorRole: req.user.canonicalRole || req.user.role || 'health',
            reason: 'REVISION_RESUBMITTED',
            holderScope: scope,
        });

        // The next round opens on the officer's next verdict, not here: writing
        // empty round-N+1 rows now would put a round in the record that nobody
        // has judged.
        return res.json({
            success: true,
            data: {
                status: TO_STATE,
                resubmittedSlotIds: requestedRows.map((r) => r.slotId),
                round,
            },
        });
    } catch (error) {
        return answer(res, error, 'POST /:id/revision-resubmit');
    }
});

module.exports = router;
module.exports.buildRequestedSlotDocumentFilter = buildRequestedSlotDocumentFilter;
