/**
 * กทล.๑ ส่วนสำหรับเจ้าหน้าที่ ข้อ ๑.๑ — the officer's per-slot document check.
 *
 *   GET  /api/provider/applications/:id/document-check
 *   POST /api/provider/applications/:id/document-reviews    { slotId, verdict, reason?, dueDate? }
 *   POST /api/provider/applications/:id/document-decision   { action: ACCEPT_ALL | REQUEST_MORE }
 *
 * ── WHAT THIS CHANGES FOR AN APPLICANT ────────────────────────────────────────
 * Review has been all-or-nothing: a filing with nine papers and one problem came
 * back as "แก้ไข" with a free-text note, and the applicant had to work out which
 * paper — usually by re-uploading everything. The form the ministry actually uses
 * is a line per document. These doors record that, so the applicant is asked to
 * fix ONE paper and every line the officer already accepted stays accepted.
 *
 * ── WHERE THE RULES LIVE ──────────────────────────────────────────────────────
 * In services/application-document-review-service.js, as pure functions, and NOT
 * here. This file resolves the application, asks the requirement engine what the
 * filing owes, asks the service whether the officer may do what they asked, and
 * writes. A rule reachable only through an HTTP door is a rule that mostly is not
 * tested.
 *
 * The requirement list is the engine's answer, never recomputed — two answers to
 * "is this paper required?" is how a review screen ends up disagreeing with the
 * submit gate.
 *
 * @module routes/api/provider/document-reviews
 */

'use strict';

const express = require('express');

const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { lookup, getMessage } = require('../../../shared/error-codes');
const {
    authenticateProvider,
    requireCanonicalPermission,
    PERMISSIONS,
} = require('./handlers/shared');
const { resolveApplicationRequirements } = require('../../../services/application-requirements-service');
const documentPrecheck = require('../../../services/document-precheck/service');
const {
    assertReviewInput,
    assertReviewSlotState,
    decideDocumentOutcome,
    nextRound,
} = require('../../../services/application-document-review-service');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
const adminApplicationService = require('../../../services/admin-application-service');
const {
    applyDocumentApprovalConsequences,
    buildRevisionDeadlineFormData,
    handleRevisionDeadlines,
} = require('./handlers/workflow-side-effects');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const {
    assertDecisionNotByReviewerAndInspector, answerSeparation,
} = require('../../../shared/reviewer-inspector-separation');
const {
    notifyRevisionRequired, notifyDocumentApproved,
} = require('../../../services/notification/domain-helpers');

/**
 * The two edges a document decision walks, and the state it must start from.
 *
 * workflow-transition-service.ALLOWED_TRANSITIONS:
 *   ASSIGNED_FOR_REVIEW → DOC_APPROVED | REVISION_REQUESTED
 *
 * Read here rather than assumed: a decision taken from any other state would be
 * an edge the state machine does not have, and the writer would either refuse it
 * or — worse — record it.
 */
const DECISION_FROM_STATE = 'ASSIGNED_FOR_REVIEW';
const DECISION_TO_STATE = Object.freeze({
    ACCEPT_ALL: 'DOC_APPROVED',
    REQUEST_MORE: 'REVISION_REQUESTED',
});

const router = express.Router();

/**
 * Refusals from the rules layer are ANSWERS an officer must read and act on.
 * Collapsing them into a 500 would tell them only that something went wrong with
 * a filing they are responsible for.
 */
const ANSWERABLE = new Set([
    'VALIDATION_ERROR',
    'REVIEW_REASON_REQUIRED',
    'REVIEW_DUE_DATE_INVALID',
    // F-WALK-05 (walked 2026-09-06): this refusal existed with a good Thai sentence,
    // but was missing from this set — so accepting an empty slot answered 500
    // "ระบบตรวจเอกสารทำงานผิดพลาด", a system-error claim about a correct business refusal.
    'REVIEW_SLOT_NOT_ATTACHED',
    'DOCUMENT_CHECK_INCOMPLETE',
    'DOCUMENT_CHECK_NOTHING_REQUESTED',
    'DOCUMENT_DECISION_WRONG_STATE',
]);

function answer(res, err, where) {
    const code = err && err.code;
    if (code && ANSWERABLE.has(code)) {
        const row = lookup(code);
        return res.status(row ? row.httpStatus : 422).json({
            success: false,
            error: code,
            code,
            message: err.message,
            // `message` is a reserved envelope key and is stripped from every
            // non-2xx body by the browser client; messageTh survives into .meta.
            messageTh: err.messageTh || (row ? getMessage(code, 'th') : null),
            // Named rows, so the screen can point at them instead of making the
            // officer re-read every line to find the one that blocks.
            ...(err.slotIds ? { slotIds: err.slotIds } : {}),
        });
    }
    logger.error(`[document-review] ${where} failed: ${err && err.message}`, { stack: err && err.stack });
    return res.status(500).json({
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        code: 'DOCUMENT_REVIEW_FAILED',
        messageTh: 'ระบบตรวจเอกสารทำงานผิดพลาด กรุณาแจ้งผู้ดูแลระบบ',
    });
}

/** The filing, its requirement answer, and this round's verdicts. */
/**
 * ใบที่มอบหมายแล้ว มีเจ้าของคนเดียว
 *
 * ความหมายที่ระบบใช้อยู่แล้วสองที่ (provider/handlers/reviewer.js,
 * provider/handlers/workflow-transitions-handler.js):
 *   reviewerId = null      -> กองงานร่วม ใครก็หยิบได้
 *   reviewerId = someone   -> คนนั้นเท่านั้น (ผู้ดูแลระบบข้ามได้)
 *
 * ไฟล์นี้เป็นไฟล์เดียวที่เดิน edge ASSIGNED_FOR_REVIEW -> DOC_APPROVED /
 * REVISION_REQUESTED โดยข้ามการตรวจนี้
 *
 * วัดจริงบน GACP Lite ซึ่งใช้โค้ดชุดเดียวกัน 2026-09-09 ก่อนแก้: ผู้ตรวจเอกสารที่ไม่ได้
 * รับมอบหมาย เรียก GET /:id/document-check ได้ 200 พร้อมรายการเอกสารทั้งใบ และ
 * POST /document-decision ผ่านด่านสิทธิ์เข้าไปถึงกฎธุรกิจ
 *
 * ผลที่ตามมาไม่ใช่แค่การอ่านข้อมูลของคนอื่น — มันทำให้การมอบหมายของคนจัดคิวไม่มี
 * ความหมาย และไม่มีใครตอบได้ว่าใครควรเป็นคนตัดสินใบนั้น
 *
 * @returns {boolean} true = ปฏิเสธแล้ว (เขียน response ไปแล้ว) · false = ผ่าน
 */
function refuseIfNotTheAssignedReviewer(req, res, application) {
    const actorRole = normalizeRole(req.user?.role);
    if (actorRole === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM
        || actorRole === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM) { return false; }
    if (!application?.reviewerId) { return false; }
    if (application.reviewerId === req.user?.id) { return false; }

    res.status(403).json({
        success: false,
        code: 'NOT_THE_ASSIGNED_REVIEWER',
        error: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมายสำหรับคำขอนี้',
        message: 'You are not the reviewer assigned to this application',
        messageTh: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมายสำหรับคำขอนี้',
    });
    return true;
}

/**
 * Separation of duties (operator ruling 2026-10-05): a person who is both the document
 * reviewer and the field inspector of this application decides neither half of it. Runs
 * beside refuseIfNotTheAssignedReviewer on every door that writes a verdict.
 *
 * @returns {boolean} true = refused (response written)
 */
function refuseIfReviewerIsAlsoInspector(req, res, application) {
    try {
        assertDecisionNotByReviewerAndInspector({
            actorId: req.user?.id,
            reviewerId: application?.reviewerId,
            auditorId: application?.auditorId,
        });
    } catch (err) {
        if (answerSeparation(res, err)) { return true; }
        throw err;
    }
    return false;
}

async function loadCheck(applicationId) {
    const application = await prisma.application.findFirst({
        where: { id: applicationId, isDeleted: false },
        include: { entity: true },
    });
    if (!application) { return null; }

    const documentRows = await prisma.applicationDocument.findMany({
        where: { applicationId: application.id },
        select: {
            documentType: true, fileUrl: true, fileName: true,
            createdAt: true, currentForSlot: true, supersededAt: true,
        },
    });
    const requirements = await resolveApplicationRequirements(application, documentRows);

    const reviews = await prisma.applicationDocumentReview.findMany({
        where: { applicationId: application.id },
        orderBy: { createdAt: 'asc' },
    });
    const round = nextRound(reviews);

    return {
        application,
        requirements,
        round,
        currentReviews: reviews.filter((r) => r.round === round),
    };
}

/**
 * The officer checklist กทล.๑ derives from the filing — 1.2 scope, 1.3
 * qualification, 1.4 overall. Derived, never stored: a stored copy would be a
 * second answer to a question the requirement engine already answers.
 */
function officerChecklist(requirements, slots) {
    const dims = (requirements && requirements.dims) || {};
    // `.every()` on an empty list is true, so a filing with NO required documents used
    // to report ครบถ้วน — the same empty-checklist defect the decision door now refuses
    // (application-document-review-service). Nothing required means nothing was verified.
    const requiredSlots = slots.filter((s) => s.required);
    const everyRequiredAccepted = requiredSlots.length > 0
        && requiredSlots.every((s) => s.verdict === 'ACCEPTED');
    return {
        // 1.2 ขอบข่าย — the filing named a scope the register knows.
        scope: dims.certScope ? 'IN' : 'OUT',
        // 1.3 คุณสมบัติ — the filing named a holder type and a plant with law filed.
        qualification: dims.holderType && dims.plantCode ? 'PASS' : 'FAIL',
        // 1.4 ผลตรวจเบื้องต้น
        overall: everyRequiredAccepted ? 'COMPLETE' : 'INCOMPLETE',
    };
}

/** Slot rows joined with this round's verdicts — the shape both doors decide on. */
function joinSlots(requirements, currentReviews) {
    const byId = new Map(currentReviews.map((r) => [r.slotId, r]));
    return ((requirements && requirements.slots) || []).map((s) => {
        const review = byId.get(s.slotId) || null;
        return {
            ...s,
            verdict: review ? review.verdict : null,
            reviewReason: review ? review.reason : null,
            reviewDueDate: review ? review.dueDate : null,
        };
    });
}

// ─── GET — what the officer sees ──────────────────────────────────────────────
router.get(
    '/:id/document-check',
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_DOC_REVIEW),
    async (req, res) => {
        try {
            const loaded = await loadCheck(req.params.id);
            if (!loaded) { return res.status(404).json({ success: false, error: 'Application not found' }); }
            if (refuseIfNotTheAssignedReviewer(req, res, loaded.application)) { return undefined; }

            const slots = joinSlots(loaded.requirements, loaded.currentReviews);
            // The document pre-check's observations — the applicant's view plus
            // confidence and the snippet. Warn-only: a failed pre-check read
            // leaves `precheck` null on every slot rather than failing the page.
            // This does NOT make the door safe to deploy ahead of migration
            // 20260927160720_document_precheck: loadCheck reads
            // application_document_reviews with no select, so a missing
            // precheck_id column fails it (500) before this line. Run
            // `migrate deploy` before the image.
            let current = null;
            try {
                current = await documentPrecheck.currentForSlots(loaded.application.id);
            } catch (precheckErr) {
                logger.warn(`[document-review] pre-check unavailable for ${loaded.application.id}: ${precheckErr && precheckErr.message}`);
            }
            const slotsWithPrecheck = slots.map((s) => ({
                ...s,
                precheck: documentPrecheck.precheckViewFor(current, s.slotId, 'officer'),
            }));
            return res.json({
                success: true,
                data: {
                    round: loaded.round,
                    slots: slotsWithPrecheck,
                    officerChecklist: officerChecklist(loaded.requirements, slots),
                },
            });
        } catch (error) {
            return answer(res, error, 'GET /:id/document-check');
        }
    },
);

// ─── POST — one slot verdict ──────────────────────────────────────────────────
router.post(
    '/:id/document-reviews',
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_DOC_REVIEW),
    async (req, res) => {
        try {
            const { slotId, verdict, reason, dueDate } = req.body || {};
            if (!slotId || typeof slotId !== 'string') {
                return answer(res, Object.assign(new Error('slotId is required'), {
                    code: 'VALIDATION_ERROR', messageTh: 'กรุณาระบุรายการเอกสาร',
                }), 'POST /:id/document-reviews');
            }
            // The rules, before the write.
            assertReviewInput({ verdict, reason, dueDate });

            const loaded = await loadCheck(req.params.id);
            if (!loaded) { return res.status(404).json({ success: false, error: 'Application not found' }); }
            if (refuseIfNotTheAssignedReviewer(req, res, loaded.application)) { return undefined; }
            if (refuseIfReviewerIsAlsoInspector(req, res, loaded.application)) { return undefined; }

            const slot = ((loaded.requirements && loaded.requirements.slots) || [])
                .find((s) => s.slotId === slotId);
            const known = Boolean(slot);
            if (!known) {
                // A verdict on a paper this filing was never asked for would sit
                // in the record forever with nothing to explain it.
                return answer(res, Object.assign(new Error(`Slot ${slotId} is not part of this filing`), {
                    code: 'VALIDATION_ERROR',
                    messageTh: 'รายการเอกสารนี้ไม่ได้อยู่ในคำขอฉบับนี้',
                }), 'POST /:id/document-reviews');
            }

            // รับได้เฉพาะช่องที่มีเอกสารอยู่จริง · ขอเพิ่มได้เสมอ
            assertReviewSlotState(verdict, slot);

            // The pre-check this verdict was taken over: the slot's current
            // DONE one, or null. Server-chosen — a precheckId in the body is
            // never read. Recorded only — it never changes the verdict, and a
            // failed read records null rather than refusing the verdict.
            //
            // That null is permanent on this row, so a read that failed because
            // the schema is behind (P2021 table / P2022 column missing — the
            // migration was not applied) is an ERROR an operator must see, not
            // a warning. Any other read failure stays a warning.
            let precheckId = null;
            try {
                precheckId = await documentPrecheck.currentDonePrecheckId(loaded.application.id, slotId);
            } catch (precheckErr) {
                const code = precheckErr && precheckErr.code;
                if (code === 'P2021' || code === 'P2022') {
                    logger.error(`[document-review] pre-check schema missing (${code}) — verdict for ${loaded.application.id}/${slotId} recorded with precheckId null: ${precheckErr.message}`);
                } else {
                    logger.warn(`[document-review] pre-check id unavailable for ${loaded.application.id}/${slotId}: ${precheckErr && precheckErr.message}`);
                }
            }

            const row = await prisma.applicationDocumentReview.upsert({
                where: {
                    applicationId_slotId_round: {
                        applicationId: loaded.application.id, slotId, round: loaded.round,
                    },
                },
                update: {
                    verdict,
                    reason: verdict === 'MORE_REQUESTED' ? String(reason).trim() : null,
                    dueDate: verdict === 'MORE_REQUESTED' ? new Date(dueDate) : null,
                    reviewerId: req.user.id,
                    precheckId,
                },
                create: {
                    applicationId: loaded.application.id,
                    slotId,
                    round: loaded.round,
                    verdict,
                    reason: verdict === 'MORE_REQUESTED' ? String(reason).trim() : null,
                    dueDate: verdict === 'MORE_REQUESTED' ? new Date(dueDate) : null,
                    reviewerId: req.user.id,
                    precheckId,
                    organizationId: loaded.application.organizationId,
                },
            });

            return res.json({ success: true, data: { review: row, round: loaded.round } });
        } catch (error) {
            return answer(res, error, 'POST /:id/document-reviews');
        }
    },
);

// ─── POST — the decision over the filing ──────────────────────────────────────
router.post(
    '/:id/document-decision',
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_DOC_REVIEW),
    async (req, res) => {
        try {
            const action = (req.body || {}).action;
            const loaded = await loadCheck(req.params.id);
            if (!loaded) { return res.status(404).json({ success: false, error: 'Application not found' }); }
            if (refuseIfNotTheAssignedReviewer(req, res, loaded.application)) { return undefined; }
            if (refuseIfReviewerIsAlsoInspector(req, res, loaded.application)) { return undefined; }

            const slots = joinSlots(loaded.requirements, loaded.currentReviews);
            // Refuses here if the officer may not take this decision. Before any
            // state is touched — a refused decision must move nothing and tell
            // nobody.
            const outcome = decideDocumentOutcome(action, slots, { requestType: loaded.application.formData?.requestType });

            const fromStatus = String(loaded.application.status || '').toUpperCase();
            if (fromStatus !== DECISION_FROM_STATE) {
                return answer(res, Object.assign(
                    new Error(`A document decision needs the filing to be ${DECISION_FROM_STATE}, not ${fromStatus}`),
                    {
                        code: 'DOCUMENT_DECISION_WRONG_STATE',
                        messageTh: 'คำขอนี้ไม่ได้อยู่ในขั้นตรวจเอกสาร จึงตัดสินผลการตรวจไม่ได้',
                    },
                ), 'POST /:id/document-decision');
            }

            // A request for more papers starts the 5-working-day revision clock, exactly as
            // the generic /workflow-transitions door does (same builder). Without it the
            // "due date" was only a sentence in a notification: no RevisionDeadline row, so
            // the cron never expired the filing, and no revisionDueAt, so a late resubmit was
            // never refused.
            const revisionClock = action === 'REQUEST_MORE'
                ? buildRevisionDeadlineFormData({
                    baseFormData: (loaded.application.formData && typeof loaded.application.formData === 'object')
                        ? loaded.application.formData : {},
                    category: 'DOCUMENT_REVIEW',
                    message: 'ขอเอกสารเพิ่มเติมรายรายการ',
                    items: slots.filter((s) => s.verdict === 'MORE_REQUESTED').map((s) => s.slotId),
                    requestedBy: req.user.id,
                    requestedByRole: req.user.canonicalRole || req.user.role || null,
                })
                : null;

            // Never a raw status write. The transition service owns the edge,
            // the audit row and the workflow history.
            await writeApplicationStatus({
                prisma,
                applicationId: loaded.application.id,
                fromStatus,
                toStatus: DECISION_TO_STATE[action],
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role || null,
                reason: action === 'ACCEPT_ALL'
                    ? 'DOCUMENT_CHECK_ACCEPTED'
                    : 'DOCUMENT_CHECK_MORE_REQUESTED',
                ...(revisionClock ? { additionalData: { formData: revisionClock.formData } } : {}),
            });

            // The row the hourly revision-deadline-checker reads. After the status write, as on
            // the generic door. The due date is already in formData above (what resubmit
            // reads), so a failure here is reported to the officer rather than swallowed.
            let revisionDeadlineRecorded = null;
            if (revisionClock) {
                try {
                    await handleRevisionDeadlines(prisma, {
                        application: loaded.application,
                        transition: {
                            previousState: fromStatus,
                            nextState: 'REVISION_REQUESTED',
                            updateData: { formData: revisionClock.formData },
                        },
                        reqUser: req.user,
                        getRevisionDueAt: (fd) => (fd && fd.revisionDueAt ? new Date(fd.revisionDueAt) : null),
                        updated: null,
                        arr: (v) => (Array.isArray(v) ? v : []),
                        logger,
                    });
                    revisionDeadlineRecorded = true;
                } catch (deadlineErr) {
                    revisionDeadlineRecorded = false;
                    logger.error(
                        `[document-review] revision deadline row NOT recorded for ${loaded.application.id}: `
                        + `${deadlineErr && deadlineErr.message}`,
                    );
                }
            }

            // The applicant learns WHICH papers and by when. An applicant told
            // only "แก้ไข" re-uploads everything, which is the round trip this
            // whole task exists to remove.
            let notified = false;
            if (action === 'REQUEST_MORE') {
                const requested = slots.filter((s) => s.verdict === 'MORE_REQUESTED');
                const lines = requested.map((s) => {
                    // The paper's own name, never its slot id — nobody outside
                    // this codebase knows what `sop_manual` is.
                    const label = s.labelTH || s.slotId;
                    return s.reviewReason ? `${label} — ${s.reviewReason}` : label;
                });
                // The date the system enforces (the revision clock stamped above), never the
                // officer-chosen per-slot date: the notice must state the real deadline.
                const deadline = revisionClock ? revisionClock.formData.revisionDueAt : null;
                try {
                    await notifyRevisionRequired(loaded.application.id, lines.join('\n'), deadline);
                    notified = true;
                } catch (notifyErr) {
                    // Telling the applicant matters; it does not matter more than
                    // the filing having actually moved. A throw here would 500 a
                    // decision whose status write has already committed, and the
                    // officer would press the button again.
                    logger.warn(
                        `[document-review] revision notification failed for ${loaded.application.id}: `
                        + `${notifyErr && notifyErr.message}`,
                    );
                }
            }

            // An approval nobody is told about moves the filing and leaves the
            // applicant looking at a screen that has not changed. ACCEPT_ALL used
            // to notify nothing at all — the papers passed, the status became
            // DOC_APPROVED, and the next thing they owe (the audit fee) was never
            // announced. Same swallow-and-log discipline as the branch above: the
            // status write has already committed, so a throw here would 500 a
            // decision that DID happen and the officer would press again.
            if (action === 'ACCEPT_ALL') {
                // What the approval CAUSES — closing the revision deadlines it
                // settles and opening the audit fee. `DOC_APPROVED →
                // PENDING_AUDIT_FEE` is a chain the applicant cannot trigger, and
                // this door used to stop at DOC_APPROVED, so a filing approved
                // here sat there and was never asked to pay. Shared with the
                // generic workflow-transition door rather than copied, so the two
                // cannot drift. It never throws: the DOC_APPROVED write has
                // already committed.
                await applyDocumentApprovalConsequences({
                    prisma,
                    applicationId: loaded.application.id,
                    actorId: req.user && req.user.id,
                    actorRole: req.user && (req.user.canonicalRole || req.user.role),
                    formData: loaded.application.formData,
                    workflowHistory: loaded.application.workflowHistory,
                    writeApplicationStatus,
                    bulkUpdateRevisionDeadlineStatus:
                        adminApplicationService.bulkUpdateRevisionDeadlineStatus.bind(adminApplicationService),
                    logger,
                });

                try {
                    await notifyDocumentApproved(loaded.application.id, null);
                    notified = true;
                } catch (notifyErr) {
                    logger.warn(
                        `[document-review] approval notification failed for ${loaded.application.id}: `
                        + `${notifyErr && notifyErr.message}`,
                    );
                }
            }

            return res.json({
                success: true,
                data: {
                    action,
                    round: loaded.round,
                    ...(outcome.requestedSlotIds ? { requestedSlotIds: outcome.requestedSlotIds } : {}),
                    status: DECISION_TO_STATE[action],
                    ...(revisionDeadlineRecorded === null ? {} : { revisionDeadlineRecorded }),
                    // Reported honestly: the officer can see the applicant was
                    // not reached and follow up, instead of assuming they were.
                    notified,
                },
            });
        } catch (error) {
            return answer(res, error, 'POST /:id/document-decision');
        }
    },
);

module.exports = router;
