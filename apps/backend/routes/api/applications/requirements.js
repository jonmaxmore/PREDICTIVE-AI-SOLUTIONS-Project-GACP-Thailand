'use strict';

/**
 * GET /api/applications/:id/requirements — the one lens, over the wire.
 *
 * Every APPLICANT surface that has to say "which papers does this filing still need"
 * reads THIS door: the 6-step wizard's per-step cards (T6-T9) and the server-truth
 * review page (T11). Before it existed each of them computed its own answer in its own
 * language, and a farmer could be told ครบ by the wizard and ไม่ครบ by the submit gate in
 * the same minute.
 *
 * The officer's per-slot checklist (T12-T13) reads the SAME lens but not this door: a
 * staff token authenticates here and then resolves to a healthId that owns no filing,
 * so every application would answer 404. T12 opens the officer's own door
 * (GET /api/provider/applications/:id/document-check) with the reviewer guard the rest
 * of the provider tree uses. The lens is shared; the ownership question is not.
 *
 * Ownership is resolved the way every other applicant-facing application door resolves
 * it (spec 2026-09-30 §3.1): the row is read with the holder fragment of the caller's
 * membership set (holderScope/holderReadWhere), never with an id from the request
 * body. In R1 the pre-R1 healthId pin rides along (R1-legacy-pin, removed in Task 12).
 * resolveHealthIdentity still runs first and refuses a non-health account.
 * A filing that is not yours answers 404 rather than
 * 403 — the same anti-probe convention the rest of this tree follows, so that asking
 * about someone else's application cannot even confirm that it exists.
 */

const express = require('express');

const router = express.Router();

const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { respondError } = require('../../../shared/api-response');
const { authenticateAny: authenticateHealth } = require('../../../middleware/auth-middleware');
const applicationService = require('../../../services/application-service');
const { getHealthScopeOptions } = require('../helpers/applications-helpers');
const { holderScope, r1ApplicationHolderOrPin, r1HolderOrLegacy } = require('../../../services/holder-access');
const {
    resolveApplicationRequirements,
} = require('../../../services/application-requirements-service');
const documentPrecheck = require('../../../services/document-precheck/service');
const { isApplicantEditable } = require('../../../constants/applicant-editable-statuses');

/**
 * The document pre-check's observations, per slot, as the APPLICANT may see
 * them: check, result and reason — never the confidence, the snippet quoted off
 * the page, or the extracted text (those are the officer's). Warn-only: a read
 * that fails leaves every slot's `precheck` null and the door answers as it did
 * before the pre-check existed, rather than failing the whole page.
 */
async function withApplicantPrechecks(applicationId, slots, scope) {
    let current = null;
    try {
        current = await documentPrecheck.currentForSlots(applicationId, { holderScope: scope });
    } catch (error) {
        logger.warn(`[requirements] pre-check unavailable for ${applicationId}: ${error && error.message}`);
    }
    return (slots || []).map((slot) => ({
        ...slot,
        precheck: documentPrecheck.precheckViewFor(current, slot.slotId, 'applicant'),
    }));
}

router.get('/:id/requirements', authenticateHealth, async (req, res) => {
    try {
        const applicationId = req.params.id;
        const identity = await applicationService.resolveHealthIdentity(
            req.user.id,
            getHealthScopeOptions(req.user),
        );

        const scope = await holderScope(req);
        const application = await prisma.application.findFirst({
            where: {
                id: applicationId,
                // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(scope, 'Application')).
                // OR form: neutral also when no entity context is bound (final review C1).
                ...r1ApplicationHolderOrPin(scope, { healthId: identity.healthId }),
                isDeleted: false,
            },
            include: { entity: true },
        });
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        // The rows the sync service keeps, which is where a document uploaded under an
        // old slot name still lives. formData.draftDocuments is read by the lens itself.
        const documentRows = await prisma.applicationDocument.findMany({
            // R1-legacy-pin: removed in Task 12 (→ holderReadWhere): the gated application decides.
            where: { applicationId: application.id, ...r1HolderOrLegacy(scope, 'ApplicationDocument', { applicationId: application.id }) },
            select: {
                documentId: true,
                documentType: true,
                fileUrl: true,
                fileName: true,
                createdAt: true,
                currentForSlot: true,
                supersededAt: true,
            },
        });

        const data = await resolveApplicationRequirements(application, documentRows);
        // appliedRules / requiredSlotIds are the submit gate's business (they carry raw
        // rule rows); the wire contract is what a surface needs to render.
        const { appliedRules: _appliedRules, requiredSlotIds: _requiredSlotIds, ...payload } = data;
        payload.slots = await withApplicantPrechecks(application.id, payload.slots, scope);
        // Whether the draft-document doors would take a write on this filing (walk D3):
        // the wizard's delete control reads it, from the same set the doors refuse with.
        payload.editable = isApplicantEditable(application.status);

        // ?includeReviews=1 — what the OFFICER asked this applicant to fix.
        //
        // Only the current round, and only the MORE_REQUESTED rows. An applicant
        // never sees the internals of a row the officer ACCEPTED: those carry the
        // reviewer's id and their working notes, which are the officer's record
        // of their own decision, not correspondence addressed to the applicant.
        // What the applicant needs is the ask — which paper, why, and by when.
        if (String(req.query.includeReviews || '') === '1') {
            let requestedDocuments = [];
            try {
                // eslint-disable-next-line global-require
                const { nextRound } = require('../../../services/application-document-review-service');
                const reviews = await prisma.applicationDocumentReview.findMany({
                    where: { applicationId: application.id },
                    orderBy: { createdAt: 'asc' },
                });
                const round = nextRound(reviews);
                requestedDocuments = reviews
                    .filter((r) => r.round === round && r.verdict === 'MORE_REQUESTED')
                    .map((r) => ({
                        slotId: r.slotId,
                        reason: r.reason,
                        dueDate: r.dueDate,
                        requestedAt: r.createdAt,
                    }));
            } catch (reviewErr) {
                // The table may not exist yet where the migration has not been
                // applied. An applicant should still see their document list; the
                // absence of the ask is reported, never faked as "nothing asked".
                logger.warn(`[requirements] reviews unavailable for ${application.id}: ${reviewErr && reviewErr.message}`);
                return res.json({ success: true, data: { ...payload, requestedDocuments: null } });
            }
            return res.json({ success: true, data: { ...payload, requestedDocuments } });
        }

        return res.json({ success: true, data: payload });
    } catch (error) {
        logger.error('[Applications requirements] Error:', error);
        return respondError(res, req, error, { message: 'Failed to resolve document requirements' });
    }
});

/**
 * POST /api/applications/:id/prechecks/:precheckId/acknowledge — the applicant
 * has read this pre-check's observations.
 *
 * The application is resolved exactly as GET /:id/requirements resolves it (the
 * holder fragment); the acknowledgement itself stays the filer's
 * (document-precheck acknowledge checks the healthId, and its refusal maps to
 * 404 below). The pre-check must belong to the application named in the path. Anything else — another applicant's filing, a
 * pre-check of a different filing, an unknown id — is 404, never 403.
 *
 * Records the time only. It never touches the application: nothing about a
 * pre-check blocks, unblocks or moves a filing.
 */
router.post('/:id/prechecks/:precheckId/acknowledge', authenticateHealth, async (req, res) => {
    const notFound = () => res.status(404).json({ success: false, error: 'Pre-check not found' });
    try {
        const identity = await applicationService.resolveHealthIdentity(
            req.user.id,
            getHealthScopeOptions(req.user),
        );
        const scope = await holderScope(req);
        const application = await prisma.application.findFirst({
            where: {
                id: req.params.id,
                // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(scope, 'Application')).
                // OR form: neutral also when no entity context is bound (final review C1).
                ...r1ApplicationHolderOrPin(scope, { healthId: identity.healthId }),
                isDeleted: false,
            },
            select: { id: true },
        });
        if (!application) {
            return notFound();
        }
        const precheck = await prisma.documentPrecheck.findFirst({
            where: {
                id: req.params.precheckId,
                applicationId: application.id,
                // R1-legacy-pin: removed in Task 12 (→ holderReadWhere): the gated application decides.
                ...r1HolderOrLegacy(scope, 'DocumentPrecheck', { applicationId: application.id }),
            },
            select: { id: true },
        });
        if (!precheck) {
            return notFound();
        }
        try {
            await documentPrecheck.acknowledge(precheck.id, identity.healthId, { holderScope: scope });
        } catch (error) {
            if (error && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
                return notFound();
            }
            throw error;
        }
        const acknowledged = await prisma.documentPrecheck.findFirst({
            where: {
                id: precheck.id,
                applicationId: application.id,
                ...r1HolderOrLegacy(scope, 'DocumentPrecheck', { applicationId: application.id }), // R1-legacy-pin: removed in Task 12
            },
            select: { applicantAcknowledgedAt: true },
        });
        return res.json({
            success: true,
            data: {
                precheckId: precheck.id,
                acknowledgedAt: (acknowledged && acknowledged.applicantAcknowledgedAt) || null,
            },
        });
    } catch (error) {
        logger.error('[Applications precheck acknowledge] Error:', error);
        return respondError(res, req, error, { message: 'Failed to acknowledge the pre-check' });
    }
});

module.exports = router;
