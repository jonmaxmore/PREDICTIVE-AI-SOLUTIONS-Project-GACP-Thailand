/**
 * Application Workflow Routes
 * Extracted from applications.js for readability.
 *
 * Routes: PATCH /:id/reject, GET /:id, PUT /:id/revision, GET /:id/pdf
 *
 * @module routes/api/applications/application-workflow-handlers
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const applicationService = require('../../../services/application-service');
const { authenticateAny: authenticateHealth, authenticateProvider } = require('../../../middleware/auth-middleware');
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { normalizeRole } = require('../../../shared/canonical-rbac');
// M1 audit F1 (2026-08-15) — the FIFTH submit door. This route can carry a
// DRAFT to SUBMITTED (submitRevision's isDraftSubmit leg,
// application-review-revision-methods.js:81-82), so it asks the same question
// the other four doors ask: may this caller act for the entity that holds it?
const { assertSubmitAllowed, SubmitGuardError } = require('../../../services/application-submit-guard');
// M2a (2026-08-15) — the same door asks the document law too. It is a MIXED
// door, like POST /submit: submitRevision accepts DRAFT as well as
// REVISION_REQUESTED (application-review-revision-methods.js:50) and carries a
// DRAFT to SUBMITTED (:84-85). The M2a plan classified it as resubmit-only and
// the audit (F1) found what that costs: a DRAFT has never been judged, carries
// no stamp, and so took the grandfather branch — a first filing admitted with
// no document checked at all. The mode is now read from the SAME predicate the
// service uses, the row's status.
const {
    assertRequiredDocumentsPresent,
    buildRequirementSnapshot,
    isSubmitGateRefusal,
    respondSubmitGateRefusal,
    MODE_FIRST_SUBMIT,
    MODE_RESUBMIT,
} = require('../../../services/application-document-requirements');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
const { mergeClientFormData } = require('../../../shared/form-data-ownership');
// Blocker F (adversarial-verify MUST, 2026-07-07): this reject surface stamps
// the SAME revisionDueAt/carDueAt + RevisionDeadline.revisionDue keys the
// auto-expire cron enforces, so it must use the SAME Thai-holiday-aware
// Asia/Bangkok engine as the canonical provider surface — not the holiday-
// blind services/working-days-service (its holiday sources are never seeded).
const { addWorkingDays } = require('../../../utils/working-days');
// R2 M3 (Law 3.5/3.6 — SSOT เลข 5): the 5-working-day correction window is
// defined ONCE in config/business-rules.js; this surface must not re-spell
// the literal (grep-pinned by __tests__/unit/correction-round.test.js).
const { PAYMENT } = require('../../../config/business-rules');
const {
    getHealthScopeOptions,
    getActorIdentity,
} = require('../helpers/applications-helpers');
// Spec 2026-09-30 §3.1: health reads spread the holder fragment. holderScope is
// called inside each handler, after authentication.
const { holderScope, holderReadWhere } = require('../../../services/holder-access');
const {
    AUDITOR_ROLES,
    REJECTABLE_STATUSES,
    REVISION_DECISION_TYPES,
    asObject,
    asArray,
    isMissingApplicationCommentsTableError,
} = require('../helpers/application-constants');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
const workflowTransitionService = require('../../../services/workflow-transition-service');
const {
    buildApplicationDetailPayload,
} = require('../helpers/application-payload-builders');
const { buildWorkflowEvent } = require('../../../shared/workflow-event-builder');

// WORKFLOW: REJECT, GET BY ID, REVISION, PDF

router.patch('/:id/reject', authenticateProvider, async (req, res) => {
    try {
        const actorRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
        if (!actorRole || !AUDITOR_ROLES.has(actorRole)) {
            return res.status(403).json({ success: false, error: 'Forbidden', message: 'Only auditor roles can request revision' });
        }

        const payload = asObject(req.body);
        const comment = String(payload.comment || '').trim();
        if (!comment) {
            return res.status(400).json({ success: false, error: 'COMMENT_REQUIRED', message: 'Comment is mandatory for revision requests' });
        }

        const decisionTypeRaw = String(payload.type || 'DOC_REVISION').trim().toUpperCase();
        const decisionType = REVISION_DECISION_TYPES.has(decisionTypeRaw) ? decisionTypeRaw : 'DOC_REVISION';
        const targetStatus = decisionType === 'FIELD_CAR' ? 'CAR_PENDING' : 'REVISION_REQUESTED';
        const historyAction = decisionType === 'FIELD_CAR' ? 'CAR_REQUESTED' : 'REVISION_REQUESTED';
        const dueFieldCamel = decisionType === 'FIELD_CAR' ? 'carDueAt' : 'revisionDueAt';
        const dueFieldSnake = decisionType === 'FIELD_CAR' ? 'car_due_at' : 'revision_due_at';

        const application = await prisma.application.findFirst({ where: { id: req.params.id, isDeleted: false } });
        if (!application) { return res.status(404).json({ success: false, error: 'Application not found' }); }

        // PENTEST B2 — SoD assignment-ownership (mirror the canonical surface REV-11
        // at provider/handlers/workflow-transitions-handler.js:145-150). Only the
        // assigned reviewer (DOC_REVISION) / auditor (FIELD_CAR) may drive their own
        // case; a null column means unassigned = allowed. Without this, any reviewer/
        // auditor in the org could request revision/CAR on a colleague's application.
        // แถวที่มอบหมายผ่านประตูเดิม (provider/handlers/applications.js) เก็บผู้ตรวจไว้ใน
        // formData เท่านั้น คอลัมน์เป็น null · ประตูนั้นเขียนคอลัมน์แล้วตั้งแต่วันนี้ แต่
        // แถวเก่ายังอยู่ ด่านจึงต้องอ่านทั้งสองที่ — เหมือนที่
        // shared/application-owner-gate.js ทำอยู่แล้ว
        const legacyReviewerId = asObject(asObject(application.formData).PROVIDERAssignment).reviewerId || null;
        const assignedOwnerId = decisionType === 'FIELD_CAR'
            ? application.auditorId
            : (application.reviewerId || legacyReviewerId);
        if (assignedOwnerId && String(assignedOwnerId) !== String(req.user.id)) {
            return res.status(403).json({
                success: false,
                error: 'FORBIDDEN_NOT_ASSIGNED',
                message: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมายสำหรับคำขอนี้',
            });
        }

        if (!REJECTABLE_STATUSES.has(String(application.status || '').toUpperCase())) {
            return res.status(409).json({ success: false, error: 'INVALID_STATUS_TRANSITION', message: `Application status ${application.status} cannot be rejected` });
        }

        // Canonical edge guard (audit 2.10): REJECTABLE_STATUSES gates the FROM
        // state but not the specific FROM→TO edge, so a DOC_REVISION on a
        // CAR_REVIEWING app (or FIELD_CAR on ASSIGNED_FOR_REVIEW) would write an
        // illegal transition — ASSIGNED_FOR_REVIEW→CAR_PENDING and
        // CAR_REVIEWING→REVISION_REQUESTED are NOT in ALLOWED_TRANSITIONS. Validate
        // the edge against the canonical map (state dimension only; role gating
        // already happened via AUDITOR_ROLES above). The two legitimate edges
        // (ASSIGNED_FOR_REVIEW→REVISION_REQUESTED, CAR_REVIEWING→CAR_PENDING) pass.
        const currentCanonicalState = workflowTransitionService.resolveStateFromApplication(application);
        const legalTargets = workflowTransitionService.ALLOWED_TRANSITIONS[currentCanonicalState];
        if (!legalTargets || !legalTargets.has(targetStatus)) {
            return res.status(409).json({
                success: false,
                error: 'INVALID_STATUS_TRANSITION',
                message: `Cannot apply ${decisionType}: ${currentCanonicalState} → ${targetStatus} is not a valid transition`,
            });
        }

        const now = new Date();
        // Blocker F: Thai-holiday-aware + ICT; returns end-of-business-day.
        const dueDate = addWorkingDays(now, PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS);
        const nowIso = now.toISOString();
        const dueIso = dueDate.toISOString();
        const formData = asObject(application.formData);
        const workflowHistory = asArray(application.workflowHistory);
        // actorUserId = the User UUID (req.user.id). EVERY scalar audit/identity
        // column below (applications.updatedBy via writeApplicationStatus,
        // application_comments.authorId, revision_deadlines.createdBy/updatedBy)
        // MUST receive this UUID — NOT req.user.providerId, which is the DECRYPTED
        // plaintext provider national ID (auth-middleware.js:193-197) and would
        // land a 13-digit PII value in an un-hooked scalar column. See
        // shared/fk-token.js for which req.user field is plaintext vs token vs UUID.
        const actorUserId = String(req.user?.id || '').trim() || null;
        // actorId stays the providerId ONLY for the encrypted JSON workflowHistory
        // payload below, where the staff identity is value-net + hook encrypted
        // (#603 APPLICATION_JSON_PII_COLUMNS includes workflowHistory) and the
        // history row is conventionally a staff identity. The scalar columns use
        // actorUserId exclusively.
        const actorId = String(req.user?.providerId || req.user?.id || '').trim() || null;
        const actorRoleValue = req.user?.canonicalRole || req.user?.role || actorRole;

        const nextFormData = {
            ...formData,
            workflowState: targetStatus,
            workflowStateUpdatedAt: nowIso,
            [dueFieldCamel]: dueIso,
            [dueFieldSnake]: dueIso,
            revisionSlaDays: PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS,
            revision_sla_days: PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS,
            lastReviewerComment: comment,
            lastReviewerDecisionType: decisionType,
        };

        if (decisionType === 'DOC_REVISION') {
            nextFormData.revisionRequestedAt = nowIso;
            nextFormData.revision_requested_at = nowIso;
            nextFormData.revisionReminder48hSentAt = null;
            nextFormData.revisionReminder24hSentAt = null;
        }
        if (decisionType === 'FIELD_CAR') {
            nextFormData.carRequestedAt = nowIso;
            nextFormData.car_requested_at = nowIso;
            nextFormData.carReminder48hSentAt = null;
            nextFormData.carReminder24hSentAt = null;
        }

        const transitionEvent = buildWorkflowEvent({
            action: historyAction,
            fromState: formData.workflowState || application.status,
            toState: targetStatus,
            fromStatus: application.status,
            toStatus: targetStatus,
            actorId,
            actorRole: actorRoleValue,
            comment,
            metadata: { type: decisionType, deadline: dueIso },
        });

        const updated = await prisma.$transaction(async (tx) => {
            await writeApplicationStatus({
                prisma: tx,
                applicationId: application.id,
                fromStatus: application.status,
                toStatus: targetStatus,
                // actorId here is stamped into the scalar applications.updatedBy
                // column (application-status-writer.js:319) → must be the UUID.
                actorId: actorUserId || 'SYSTEM',
                actorRole: actorRoleValue,
                reason: historyAction,
                additionalData: {
                    // Scalar applications.updatedBy override → UUID, never providerId.
                    updatedBy: actorUserId || undefined,
                    formData: nextFormData,
                    workflowHistory: [...workflowHistory, transitionEvent],
                },
            });
            const updatedApplication = await tx.application.findUnique({ where: { id: application.id } });

            // R2 M2 (operator decision D-8, 2026-08-03 — evidence/R2-special-
            // reopen/decisions-final.md): this surface previously sent NOTHING
            // to the farmer (gap-report ข้อ 3ค). The correction decision must
            // carry its official Thai letter (จดหมายราชการในระบบ, M1
            // official-letter kind — ผลไม่ผ่าน + รายการประเด็น + กำหนดส่ง +
            // ช่องทาง) atomically: a failed letter write aborts this
            // transaction, so the status flip AND the RevisionDeadline clock
            // below never land without their letter. Lazy require keeps the
            // router's module load free of the notification stack.
            const { mintCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../../services/decision-letter-service');
            await mintCorrectionLetter({
                tx,
                healthId: application.healthId,
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                stage: decisionType === 'FIELD_CAR'
                    ? CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR
                    : CORRECTION_LETTER_STAGE.DOC_REVIEW,
                items: [],
                message: comment,
                dueAt: dueDate,
            });

            try {
                // C-class: ApplicationComment columns are authorId/role/content
                // (not auditorId/commentText/type/attachments). The old payload
                // threw PrismaClientValidationError → rolled back the whole reject
                // transaction (status flip + revisionDeadline). decisionType +
                // attachments are preserved in the transition metadata/formData.
                // organizationId is injected by the tenant extension (same as the
                // revisionDeadline upsert below).
                // authorId is a scalar String column (no FK) → stamp the User UUID,
                // never req.user.providerId (plaintext national ID).
                await tx.applicationComment.create({ data: { applicationId: application.id, authorId: actorUserId || 'SYSTEM', role: actorRoleValue, content: comment } });
            } catch (commentError) {
                if (!isMissingApplicationCommentsTableError(commentError)) { throw commentError; }
                logger.warn('[Applications Reject] application_comments table missing; skip comment persistence');
            }

            if (decisionType === 'DOC_REVISION' || decisionType === 'FIELD_CAR') {
                const existing = await tx.revisionDeadline.findUnique({ where: { applicationId: application.id }, select: { revisionCount: true } });
                await tx.revisionDeadline.upsert({
                    where: { applicationId: application.id },
                    // createdBy/updatedBy are scalar String columns (no FK) → User UUID.
                    create: { applicationId: application.id, revisionDue: dueDate, revisionCount: 1, status: 'PENDING', createdBy: actorUserId || 'SYSTEM', updatedBy: actorUserId || 'SYSTEM' },
                    update: { revisionDue: dueDate, revisionCount: (existing?.revisionCount || 0) + 1, status: 'PENDING', updatedBy: actorUserId || 'SYSTEM' },
                });
            }

            return updatedApplication;
        });

        return res.json({ success: true, data: { applicationId: updated.id, applicationNumber: updated.applicationNumber, status: updated.status, deadlineAt: dueIso, type: decisionType } });
    } catch (error) {
        logger.error('[Applications Reject] Error:', error);
        return respondError(res, req, error, { message: 'Failed to reject application' });
    }
});

router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        // The identity check stays (an unresolvable caller is refused as before).
        await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const where = {
            id: req.params.id,
            ...holderReadWhere(await holderScope(req), 'Application'),
            isDeleted: false,
        };
        let app;
        try {
            // P1-G leak-guard: applicant reads must never include internal
            // staff notes (ApplicationComment.internalOnly). Latent until the
            // chatter composer ships — guard the WHERE before writes can exist.
            app = await prisma.application.findFirst({ where, include: { comments: { where: { internalOnly: false }, orderBy: { createdAt: 'asc' } }, auditor: { select: { firstName: true, lastName: true } } } });
        } catch (error) {
            if (!isMissingApplicationCommentsTableError(error)) { throw error; }
            logger.warn('[Get By Id] application_comments table missing; fallback without comments');
            app = await prisma.application.findFirst({ where });
            if (app) { app.comments = []; }
        }
        if (!app) { return res.status(404).json({ success: false, error: 'Not Found' }); }
        return res.json({ success: true, data: buildApplicationDetailPayload(app) });
    } catch (error) {
        logger.error('[Get By Id] Error:', error);
        return respondError(res, req, error);
    }
});

// HEALTH-side activity timeline (ADR-016 Phase 6).
// Same applicationId scope as GET /:id (the user must own the application),
// but the response is REDACTED — no assignee names, no internal notes,
// no candidateGroup. Just "what stage of work is happening, and when".
//
// Existing /api/provider/applications/:id/activities returns the full
// internal view for staff. This endpoint is the public-facing twin.
router.get('/:id/activities', authenticateHealth, async (req, res) => {
    try {
        await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const owned = await prisma.application.findFirst({
            where: {
                id: req.params.id,
                ...holderReadWhere(await holderScope(req), 'Application'),
                isDeleted: false,
            },
            select: { id: true },
        });
        if (!owned) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const rows = await prisma.workActivity.findMany({
            where: { applicationId: req.params.id },
            orderBy: [{ createdAt: 'asc' }],
            select: {
                id: true,
                workType: true,
                state: true,
                createdAt: true,
                claimedAt: true,
                completedAt: true,
                cancelledAt: true,
                dueAt: true,
            },
        });

        const WORK_TYPE_LABEL_TH = {
            SLIP_REVIEW: 'ตรวจสลิปการชำระเงิน',
            SCHEDULING: 'จัดคิวมอบหมายเจ้าหน้าที่',
            DOC_REVIEW: 'ตรวจเอกสารใบสมัคร',
            FIELD_AUDIT: 'ตรวจประเมินภาคสนาม',
            CAR_REVIEW: 'ตรวจการแก้ไขข้อบกพร่อง',
            FINAL_APPROVAL: 'อนุมัติออกใบรับรอง',
            // RECEIPT_ISSUE omitted — issuance is automatic (auto-issue +
            // auto-sign on slip approval), never a spawned work-activity.
        };

        // Map internal state → coarser public status. The applicant
        // doesn't need to distinguish CLAIMED vs IN_PROGRESS — just
        // "someone is working on it".
        function publicStatus(state) {
            switch (state) {
                case 'TODO': return 'pending';
                case 'CLAIMED':
                case 'IN_PROGRESS': return 'in_progress';
                case 'DONE': return 'done';
                case 'CANCELLED': return 'cancelled';
                default: return 'pending';
            }
        }

        const now = new Date();
        const data = rows.map((r) => ({
            id: r.id,
            workType: r.workType,
            workTypeLabel: WORK_TYPE_LABEL_TH[r.workType] || r.workType,
            status: publicStatus(r.state),
            createdAt: r.createdAt,
            startedAt: r.claimedAt,
            completedAt: r.completedAt,
            cancelledAt: r.cancelledAt,
            // Show "approaching deadline" hint without leaking the exact
            // SLA hours — just a boolean for the badge.
            isOverdue: r.dueAt && r.dueAt < now && !['DONE', 'CANCELLED'].includes(r.state),
        }));

        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Health Get Activities] Error:', error);
        return respondError(res, req, error);
    }
});

// M1 AC3 — the accepted act says in whose name it was made. `auditLogger.log()`
// opens its own transaction and takes its own advisory lock
// (audit-logger.js:479,505-506), so it runs outside every business transaction
// and is best-effort by design (log() swallows its own errors, :526-541).
async function logRevisionSubmitAccepted({ req, applicationId, entityId }) {
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: 'APPLICATION_REVISION_SUBMIT_ACCEPTED',
            severity: AuditSeverity.INFO,
            actorId: req.user?.id || 'UNKNOWN',
            actorType: 'USER',
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            resourceType: ResourceType.APPLICATION,
            resourceId: applicationId,
            ipAddress: req.ip || null,
            userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
            organizationId: req.user?.organizationId || null,
            result: 'SUCCESS',
            metadata: {
                onBehalfOfEntityId: entityId || null,
                permission: 'SUBMIT_APPLICATION',
                applicationId,
                route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
            },
        });
    } catch (auditErr) {
        logger.warn(`[Revision] accepted-audit write failed (non-fatal): ${auditErr?.message}`);
    }
}

router.put('/:id/revision', authenticateHealth, async (req, res) => {
    try {
        const { formData, notes } = req.body;
        const actorIdentity = getActorIdentity(req.user);
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));

        // M1 audit F1 — gate BEFORE the service writes anything. Visibility
        // (the holder is in the caller's scope) is the read below and is re-checked
        // inside submitRevision; authority ("may I act for its holder": the submit
        // guard, SUBMIT_APPLICATION, spec §3.3) is decided here, keyed off the
        // application row's entityId. A resubmit is a submit: who filed it does
        // not matter.
        const application = await applicationService.findOwnedApplicationForApplicant(req.params.id, {
            holderScope: await holderScope(req),
        });
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        // A null holder is refused by the guard below, never healed (spec 2026-09-30 §3.2 + C3: a null holder is never healed to the caller's personal entity; heal-null-holders.js places legacy rows).
        let onBehalfOfEntityId = null;
        try {
            ({ entityId: onBehalfOfEntityId } = await assertSubmitAllowed({
                userId: healthIdentity.userId,
                application,
                // The guard re-checks a RENEWAL/REPLACEMENT claim's certificate holder.
                holderScope: await holderScope(req),
                auditContext: {
                    actorType: 'USER',
                    actorRole: req.user?.canonicalRole || req.user?.role || null,
                    ipAddress: req.ip || null,
                    userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
                    organizationId: req.user?.organizationId || null,
                    route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
                },
            }));
        } catch (guardErr) {
            if (guardErr instanceof SubmitGuardError) {
                return respondError(res, req, guardErr, { message: guardErr.message });
            }
            throw guardErr;
        }

        // M2a — completeness after authority, and before submitRevision writes
        // anything. `application` is the full row this handler already loaded
        // (findOwnedApplicationForApplicant returns it unprojected —
        // application-draft-query-methods.js:365-370), so status, formData and
        // the evidence are all in hand.
        //
        //   DRAFT  → first submit: read the law in force NOW, refuse what is
        //            missing, and hand the set that judged it to the write below.
        //   else   → resubmit: judged by the stamp it already carries, so a rule
        //            filed after it cannot refuse it (AC3).
        const isFirstSubmit = String(application?.status || '').toUpperCase() === 'DRAFT';
        let requirementStamp = null;
        try {
            // ตัดสิน formData ที่จะถูกเก็บจริง (หลัง merge กับสิ่งที่ผู้ยื่นส่งมา) ไม่ใช่สำเนาเก่าที่เก็บอยู่
            const { appliedRules } = await assertRequiredDocumentsPresent({
                application: {
                    ...application,
                    formData: mergeClientFormData(application.formData, formData),
                },
                previousFormData: application.formData,
                mode: isFirstSubmit ? MODE_FIRST_SUBMIT : MODE_RESUBMIT,
                holderScope: await holderScope(req),
            });
            if (isFirstSubmit) {
                requirementStamp = buildRequirementSnapshot(appliedRules);
            }
        } catch (docErr) {
            if (isSubmitGateRefusal(docErr)) {
                return respondSubmitGateRefusal(res, docErr);
            }
            throw docErr;
        }

        const result = await applicationService.submitRevision(req.params.id, { formData, notes }, {
            userId: healthIdentity.userId,
            healthId: healthIdentity.healthId,
            actorIdentity,
            actorRole: req.user.canonicalRole || req.user.role || null,
        }, {
            // The stamp is SERVER data and travels as such — never mixed into the
            // applicant's `formData` bag, which the service strips (F2).
            serverFormDataPatch: requirementStamp ? { serverRequirementSnapshot: requirementStamp } : {},
            // Spec 2026-09-30 §3.1: the service's ownership re-read carries the holder scope.
            holderScope: await holderScope(req),
        });
        if (result?.status >= 200 && result?.status < 300) {
            await logRevisionSubmitAccepted({ req, applicationId: req.params.id, entityId: onBehalfOfEntityId });
        }
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error('[Revision] Error:', error);
        return respondError(res, req, error);
    }
});

/**
 * The applicant's own filing, on the ministry's form.
 *
 * Both doors below render แบบกัญชา กทล.๑ from ONE renderer
 * (services/pdf/katorlor1-template-service), so the form a farmer reads on
 * screen and the PDF the department receives cannot say different things. The
 * ส่วนที่ ๓ checklist comes from the requirement engine rather than being
 * recomputed here, for the same reason: two answers to "is this paper attached?"
 * is how a screen ends up disagreeing with the submit gate.
 */
async function loadFilingForKatorlor1(req) {
    await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
    // Application has no `documents` Prisma relation — uploaded documents live
    // as JSON in `formData.documents`, and as ApplicationDocument rows. Including
    // `documents: true` here used to 500 every PDF download (UAT 2026-05-03).
    const scope = await holderScope(req);
    const app = await prisma.application.findFirst({
        where: {
            id: req.params.id,
            ...holderReadWhere(scope, 'Application'),
            isDeleted: false,
        },
        include: { applicant: true, entity: true, invoices: { orderBy: { createdAt: 'asc' } } },
    });
    if (!app) { return { app: null, requirements: null }; }

    // The engine's answer, or none. A form must still render for a filing whose
    // requirements cannot be resolved — printing four ส่วน with an empty
    // checklist is honest; refusing the whole document over it is not.
    let requirements = null;
    try {
        // eslint-disable-next-line global-require
        const { resolveApplicationRequirements } = require('../../../services/application-requirements-service');
        const documentRows = await prisma.applicationDocument.findMany({
            where: {
                applicationId: app.id,
                ...holderReadWhere(scope, 'ApplicationDocument'),
            },
            select: {
                documentType: true, fileUrl: true, fileName: true,
                createdAt: true, currentForSlot: true, supersededAt: true,
            },
        });
        requirements = await resolveApplicationRequirements(app, documentRows);
    } catch (err) {
        logger.warn(`[katorlor1] requirements unavailable for ${app.id}: ${err && err.message}`);
    }
    return { app, requirements };
}

// The form as HTML, for the review page, the officer page and [id]/preview.
router.get('/:id/katorlor1', authenticateHealth, async (req, res) => {
    try {
        const { app, requirements } = await loadFilingForKatorlor1(req);
        if (!app) { return res.status(404).json({ success: false, error: 'Application not found' }); }

        const { renderKatorlor1Html } = require('../../../services/pdf/katorlor1-template-service');
        return res.json({ success: true, data: { html: renderKatorlor1Html(app, requirements) } });
    } catch (error) {
        logger.error('[Applications katorlor1] Error:', error);
        return respondError(res, req, error, { message: 'Failed to assemble the กทล.1 form' });
    }
});

router.get('/:id/pdf', authenticateHealth, async (req, res) => {
    try {
        const { app, requirements } = await loadFilingForKatorlor1(req);
        if (!app) { return res.status(404).json({ success: false, error: 'Application not found' }); }

        // Was generateApplicationSummaryPdf — a summary the platform invented.
        // What the department receives is its own form.
        const { renderKatorlor1Pdf } = require('../../../services/pdf/katorlor1-template-service');
        const buffer = await renderKatorlor1Pdf(app, requirements);
        const filename = `katorlor1-${app.applicationNumber || app.id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (error) {
        logger.error('[Applications PDF] Error:', error);
        return respondError(res, req, error, { message: 'Failed to generate PDF' });
    }
});

module.exports = router;
