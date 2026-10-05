/**
 * Workflow Transition Side-Effects
 * Extracted from workflow-transitions-handler.js for readability.
 *
 * Handles: revision deadlines, notifications, certificate issuance, audit logging.
 *
 * @module routes/api/provider/handlers/workflow-side-effects
 */

const { writeApplicationStatus } = require('../../../../services/application-status-writer');
const { createNotification } = require('../../../../services/notification-service');
// Closing-review NEW-2 (2026-05-15): mask the raw 13-digit identifier before
// writing it into the hash-chained audit row (PDPA Section 27).
const { maskThaiId } = require('../../../../utils/field-encryption');
// Batch 10 — Prisma bypass cleanup. The revisionDeadline reads/writes now
// route through admin-application-service so the service is the single
// audit point for the deadline-state machine. The `prisma` parameter on
// these functions is still required: writeApplicationStatus needs it as the
// canonical transaction handle.
const adminApplicationService = require('../../../../services/admin-application-service');
const { DEFAULT_TIME_ZONE, addWorkingDays } = require('../../../../utils/working-days');
const { PAYMENT } = require('../../../../config/business-rules');

/**
 * The revision clock, in one place. Every door that moves an application to
 * REVISION_REQUESTED stamps the SAME fields: the generic /workflow-transitions door and the
 * reviewer screen's per-slot "ขอเพิ่มเอกสาร" (document-reviews.js POST /:id/document-decision).
 * Only the first used to, so a per-slot request had no RevisionDeadline and no revisionDueAt:
 * the revision-deadline-checker (reads RevisionDeadline rows) never expired it, and
 * revision-resubmit (reads revisionDueAt) never refused a late answer.
 *
 * Thai-holiday-aware and Asia/Bangkok (utils/working-days), the canonical 5 working days
 * (config/business-rules PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).
 *
 * @param {object} p
 * @param {object} [p.baseFormData]  the application's formData the fields are merged onto
 * @param {Date}   [p.requestedAt]
 * @param {string|null} [p.category]
 * @param {string|null} [p.message]
 * @param {Array}  [p.items]
 * @param {string|null} [p.requestedBy]
 * @param {string|null} [p.requestedByRole]
 * @returns {{ dueAt: Date, requestedAt: Date, slaDays: number, formData: object, eventMetadata: object }}
 */
function buildRevisionDeadlineFormData({
    baseFormData = {}, requestedAt = new Date(), category = null, message = null, items = [],
    requestedBy = null, requestedByRole = null,
} = {}) {
    const slaDays = PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS;
    // Blocker F: Thai-holiday-aware + Asia/Bangkok (utils/working-days).
    // The old services/working-days-service path counted Thai public
    // holidays as working days (its holiday sources were never seeded)
    // → too-short deadline → early auto-EXPIRE → farmer forfeits งวด 1.
    const dueAt = addWorkingDays(requestedAt, slaDays);
    const requestedIso = requestedAt.toISOString();
    const dueIso = dueAt.toISOString();
    const formData = {
        ...baseFormData,
        revisionRequestedAt: requestedIso,
        revisionDueAt: dueIso,
        revisionSlaDays: slaDays,
        revision_requested_at: requestedIso,
        revision_due_at: dueIso,
        revision_sla_days: slaDays,
        revisionRequest: {
            category,
            message,
            items,
            requestedAt: requestedIso,
            dueAt: dueIso,
            requestedBy,
            requestedByRole,
        },
    };
    const eventMetadata = {
        revisionRequestedAt: requestedIso,
        revisionDueAt: dueIso,
        revisionSlaDays: slaDays,
        revision_requested_at: requestedIso,
        revision_due_at: dueIso,
        revision_sla_days: slaDays,
        revisionCategory: category,
        revisionMessage: message,
        revisionItems: items,
    };
    return { dueAt, requestedAt, slaDays, formData, eventMetadata };
}

/**
 * Manage revision deadline records when transitioning states.
 */
async function handleRevisionDeadlines(prisma, { application, transition, reqUser, getRevisionDueAt, updated, arr, logger }) {
    if (transition.nextState === 'REVISION_REQUESTED') {
        const dueAt = getRevisionDueAt(transition.updateData?.formData);
        if (dueAt) {
            // adminApplicationService.findRevisionDeadlineByApplicationId —
            // replaces prisma.revisionDeadline.findUnique.
            const existingDeadline = await adminApplicationService.findRevisionDeadlineByApplicationId(
                application.id,
                { select: { revisionCount: true } },
            );
            const nextRevisionCount = (existingDeadline?.revisionCount || 0) + 1;
            // adminApplicationService.upsertRevisionDeadline — replaces
            // prisma.revisionDeadline.upsert.
            await adminApplicationService.upsertRevisionDeadline({
                applicationId: application.id,
                update: {
                    revisionDue: dueAt,
                    status: 'PENDING',
                    revisionCount: nextRevisionCount,
                    updatedBy: reqUser.id,
                },
                create: {
                    applicationId: application.id,
                    revisionDue: dueAt,
                    status: 'PENDING',
                    revisionCount: 1,
                    createdBy: reqUser.id,
                },
            });
        }
    } else if (transition.previousState === 'REVISION_REQUESTED' && transition.nextState === 'ASSIGNED_FOR_REVIEW') {
        // adminApplicationService.bulkUpdateRevisionDeadlineStatus — replaces
        // prisma.revisionDeadline.updateMany for the SUBMITTED transition.
        await adminApplicationService.bulkUpdateRevisionDeadlineStatus({
            applicationId: application.id,
            fromStatuses: ['PENDING', 'EXTENDED'],
            data: {
                status: 'SUBMITTED',
                submittedAt: new Date(),
                submittedBy: reqUser.id,
                updatedBy: reqUser.id,
            },
        });
    } else if (transition.nextState === 'CAR_PENDING') {
        // hardening-iter4 fix: CAR_PENDING needs a RevisionDeadline row too. The hourly
        // revision-deadline-checker cron already scans RevisionDeadline rows AND
        // handles CAR_PENDING (its isRevisionState check includes CAR_PENDING, and
        // ROLE_TRANSITIONS[SYSTEM] has CAR_PENDING->EXPIRED) — but nothing ever
        // CREATED a row for a CAR, so CAR apps never auto-EXPIRED after the 5
        // working-day SLA (REVISION did). The route stuffs formData.carDueAt; mirror
        // the REVISION_REQUESTED upsert with that due date. Empirically verified on
        // staging: CAR_PENDING + overdue RevisionDeadline → cron expires it.
        const carDueRaw = transition.updateData?.formData?.carDueAt
            || transition.updateData?.formData?.car_due_at;
        const dueAt = carDueRaw ? new Date(carDueRaw) : null;
        if (dueAt && !Number.isNaN(dueAt.getTime())) {
            const existingDeadline = await adminApplicationService.findRevisionDeadlineByApplicationId(
                application.id,
                { select: { revisionCount: true } },
            );
            const nextRevisionCount = (existingDeadline?.revisionCount || 0) + 1;
            await adminApplicationService.upsertRevisionDeadline({
                applicationId: application.id,
                update: {
                    revisionDue: dueAt,
                    status: 'PENDING',
                    revisionCount: nextRevisionCount,
                    updatedBy: reqUser.id,
                },
                create: {
                    applicationId: application.id,
                    revisionDue: dueAt,
                    status: 'PENDING',
                    revisionCount: 1,
                    createdBy: reqUser.id,
                },
            });
        }
    } else if (transition.previousState === 'CAR_PENDING' && transition.nextState === 'CAR_REVIEWING') {
        // hardening-iter4 fix: applicant answered the CAR in time → mark the deadline
        // SUBMITTED (mirrors REVISION_REQUESTED->ASSIGNED_FOR_REVIEW), so the cron
        // doesn't later expire a CAR that was resolved. (The cron also auto-completes
        // a deadline once the app leaves a revision state, but flipping it here is
        // immediate + symmetric.)
        await adminApplicationService.bulkUpdateRevisionDeadlineStatus({
            applicationId: application.id,
            fromStatuses: ['PENDING', 'EXTENDED'],
            data: {
                status: 'SUBMITTED',
                submittedAt: new Date(),
                submittedBy: reqUser.id,
                updatedBy: reqUser.id,
            },
        });
    } else if (transition.nextState === 'DOC_APPROVED') {
        // adminApplicationService.bulkUpdateRevisionDeadlineStatus — replaces
        // prisma.revisionDeadline.updateMany for the APPROVED transition.
        await adminApplicationService.bulkUpdateRevisionDeadlineStatus({
            applicationId: application.id,
            fromStatuses: ['PENDING', 'SUBMITTED', 'EXTENDED'],
            data: {
                status: 'APPROVED',
                updatedBy: reqUser.id,
            },
        });

        // Auto-chain: DOC_APPROVED → PENDING_AUDIT_FEE
        const chainTs = new Date().toISOString();
        const chainedFormData = {
            ...transition.updateData.formData,
            workflowState: 'PENDING_AUDIT_FEE',
            workflowStateUpdatedAt: chainTs,
            docApprovedAt: chainTs,
        };
        const arrFn = arr || ((v) => Array.isArray(v) ? v : []);
        const chainedHistory = [
            ...arrFn(transition.updateData.workflowHistory),
            {
                timestamp: chainTs,
                action: 'AUDIT_FEE_PAYMENT_REQUIRED',
                fromState: 'DOC_APPROVED',
                toState: 'PENDING_AUDIT_FEE',
                actorId: 'SYSTEM',
                actorRole: 'system',
            },
        ];
        await writeApplicationStatus({
            prisma,
            applicationId: application.id,
            fromStatus: 'DOC_APPROVED',
            toStatus: 'PENDING_AUDIT_FEE',
            actorId: 'SYSTEM',
            actorRole: 'system',
            reason: 'AUDIT_FEE_PAYMENT_REQUIRED',
            additionalData: {
                formData: chainedFormData,
                workflowHistory: chainedHistory,
            },
        });
        // เดิมตรงนี้เรียก ensurePhaseInvoices('PHASE_2') ตอนเอกสารผ่าน เพื่อให้มีใบแจ้งหนี้
        // งวดที่ 2 ไว้ให้จ่าย · การแยกใบรัฐ/บริษัทถูกปิดไปตั้งแต่ F-G4-35 และถูกลบทั้งเครื่อง
        // เมื่อ 2026-09-11 ตอน operator สั่งเลิกแยกค่าธรรมเนียม
        // ใบแจ้งหนี้จริงมินต์ที่ /api/payments/checkout ใบเดียวต่องวด ตอนผู้ยื่นกดจ่าย
        // Update local refs so the response and notification reflect final status
        transition.nextState = 'PENDING_AUDIT_FEE';
        transition.nextLegacyStatus = 'PENDING_AUDIT_FEE';
        if (updated) {
            updated.status = 'PENDING_AUDIT_FEE';
            updated.formData = chainedFormData;
        }
        if (logger) {
            logger.info(`[provider] Auto-chained DOC_APPROVED → PENDING_AUDIT_FEE for ${application.applicationNumber}`);
        }
    }
}

/**
 * Send notifications to the health user for workflow state changes.
 */
async function sendTransitionNotifications(prisma, logger, { application, transition, healthUserId, getRevisionDueAt, revisionCategory, revisionMessage, effectiveComment, revisionItems }) {
    if (!healthUserId) {return;}

    if (transition.nextState === 'REVISION_REQUESTED') {
        const dueAt = getRevisionDueAt(transition.updateData.formData);
        // Farmer-facing copy must be Thai. Format the deadline as Buddhist-era
        // Thai date (DD/MM/YYYY+543) so rural users don't see a raw ISO string.
        let dueAtThai = 'ภายในเวลาที่กำหนด';
        if (dueAt) {
            try {
                const d = new Date(dueAt);
                dueAtThai = d.toLocaleDateString('th-TH', {
                    timeZone: DEFAULT_TIME_ZONE,
                    year: 'numeric', month: 'long', day: 'numeric',
                });
            } catch (_e) {
                dueAtThai = dueAt.toISOString();
            }
        }
        await createNotification({
            userId: healthUserId,
            type: 'WARNING',
            title: 'ใบสมัครต้องการการแก้ไข',
            message: `ใบสมัครเลขที่ ${application.applicationNumber} ของท่านได้รับการตรวจสอบและต้องการการแก้ไข กรุณาดำเนินการแก้ไขภายในวันที่ ${dueAtThai}`,
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                action: 'REVISION_REQUESTED',
                revisionCategory,
                revisionMessage: revisionMessage || effectiveComment,
                revisionItems,
                revisionDueAt: dueAt ? dueAt.toISOString() : null,
            },
        }).catch((err) => {
            logger.warn('[provider] revision notification failed', { message: err.message, applicationId: application.id });
        });
    }

    if (transition.nextState === 'PENDING_AUDIT_FEE') {
        await createNotification({
            userId: healthUserId,
            type: 'INFO',
            title: 'เอกสารผ่านการตรวจ กรุณาชำระงวดที่ 2',
            message: `ใบสมัครเลขที่ ${application.applicationNumber} ผ่านการตรวจสอบเอกสารแล้ว กรุณาชำระงวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง เพื่อดำเนินการในขั้นตอนถัดไป`,
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                action: 'PENDING_AUDIT_FEE',
                nextRequiredAction: 'PAY_PHASE_2',
            },
        }).catch((err) => {
            logger.warn('[provider] pending-audit-fee notification failed', { message: err.message, applicationId: application.id });
        });
    }

    // CERTIFIED — terminal positive outcome. Celebratory Thai notification with
    // the certificate number (and download URL if the dispatch context has one)
    // so the farmer can immediately verify / download their GACP certificate.
    if (transition.nextState === 'CERTIFIED') {
        const certificateNumber =
            transition.updateData?.formData?.certificateNumber ||
            transition.updateData?.certificateNumber ||
            application.certificateNumber ||
            '-';
        const certificateUrl =
            transition.updateData?.formData?.certificateUrl ||
            transition.updateData?.certificateUrl ||
            null;
        await createNotification({
            userId: healthUserId,
            type: 'SUCCESS',
            title: 'ยินดีด้วย! ใบสมัคร GACP ได้รับการรับรอง',
            message: `ใบสมัครของท่านได้รับการรับรอง GACP เรียบร้อยแล้ว เลขที่ใบรับรอง: ${certificateNumber}`,
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                action: 'CERTIFIED',
                certificateNumber,
                certificateUrl,
            },
        }).catch((err) => {
            logger.warn('[provider] certified notification failed', { message: err.message, applicationId: application.id });
        });
    }

    // Terminal rejection — only path that the applicant might never hear
    // about otherwise. Reviewer sets REVISION_REQUESTED for fixable issues
    // (handled above). REJECTED is the auditor / admin "this fails GACP and
    // there's no path back" outcome from AUDIT_CONFIRMED. The applicant must
    // be told, with the reasonCode + comment so support can answer "why".
    if (transition.nextState === 'REJECTED') {
        await createNotification({
            userId: healthUserId,
            type: 'ERROR',
            title: '❌ คำขอไม่ผ่านการพิจารณา',
            message: `คำขอเลขที่ ${application.applicationNumber} ไม่ผ่านการพิจารณา${effectiveComment ? ` — ${effectiveComment}` : ''}`,
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                action: 'REJECTED',
                reason: effectiveComment || null,
                previousState: transition.previousState,
            },
        }).catch((err) => {
            logger.warn('[provider] rejection notification failed', { message: err.message, applicationId: application.id });
        });
    }
}

/**
 * Issue certificate on APPROVED transition and notify health user.
 */
async function handleCertificateIssuance(prisma, logger, { application, transition, reqUser, healthUserId, ensureCertificateIssuedForApplication }) {
    if (transition.nextState !== 'APPROVED') {return null;}

    // PDPA close-natid-round2 (2026-06-30): pass the User UUID (reqUser.id),
    // NOT reqUser.providerId. This flows into Certificate.issuedBy + signedBy
    // via generateCertificate; a providerId is a 13-digit national ID that
    // would otherwise land plaintext on the cert and on the rendered "ออกโดย" /
    // trace surfaces. The UUID eliminates the national ID at SOURCE and matches
    // the AUDIT_PASSED auto-issue path (application-status-writer.js passes the
    // UUID actorId). issuedBy/signedBy are also encrypted at rest (defence in
    // depth) — see prisma-pdpa-extension CERTIFICATE_PII_COLUMNS.
    const issuedCertificate = await ensureCertificateIssuedForApplication(
        application.id,
        reqUser.id,
    );

    if (healthUserId && issuedCertificate?.certificateNumber) {
        await createNotification({
            userId: healthUserId,
            type: 'SUCCESS',
            title: 'ออกใบรับรอง GACP เรียบร้อยแล้ว',
            message: `ใบรับรองเลขที่ ${issuedCertificate.certificateNumber} ของใบสมัคร ${application.applicationNumber} ได้รับการออกเรียบร้อยแล้ว ท่านสามารถดาวน์โหลดใบรับรองได้จากระบบ`,
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                certificateId: issuedCertificate.id,
                certificateNumber: issuedCertificate.certificateNumber,
            },
        }).catch((err) => {
            logger.warn('[provider] certificate notification failed', { message: err.message, applicationId: application.id });
        });
    }

    return issuedCertificate;
}

/**
 * Log the workflow transition to the audit trail.
 */
async function logTransitionAudit(auditLogger, logger, { AuditCategory, AuditSeverity, ResourceType, application, transition, reqUser, reasonCode, effectiveComment, force, issuedCertificate, getRequestIp, req }) {
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: force ? 'WORKFLOW_FORCE_TRANSITION' : 'WORKFLOW_TRANSITION',
            severity: force ? AuditSeverity.WARNING : AuditSeverity.INFO,
            actorId: reqUser.id || 'SYSTEM',
            actorRole: reqUser.canonicalRole || reqUser.role || 'UNKNOWN',
            actorType: 'PROVIDER',
            resourceType: ResourceType.APPLICATION,
            resourceId: application.id,
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: {
                applicationNumber: application.applicationNumber,
                previousWorkflowState: transition.previousState,
                nextWorkflowState: transition.nextState,
                previousStatus: application.status,
                nextStatus: transition.nextLegacyStatus,
                reasonCode,
                comment: effectiveComment,
                force,
                certificateId: issuedCertificate?.id || null,
                certificateNumber: issuedCertificate?.certificateNumber || null,
                actorIdentity: maskThaiId(reqUser.providerId) || maskThaiId(reqUser.healthId) || null,
            },
        });
    } catch (auditError) {
        logger.warn('[provider] workflow transition audit failed', {
            message: auditError.message,
            applicationId: application.id,
        });
    }
}


/**
 * What a document approval CAUSES, wherever the approval was decided.
 *
 * Two doors approve documents now: the generic workflow-transition handler and,
 * since 2026-09-05, the per-slot document-decision screen. The consequences are
 * the same either way — close the revision deadlines this approval settles, and
 * open the audit fee, because `DOC_APPROVED → PENDING_AUDIT_FEE` is a chain the
 * applicant cannot trigger themselves.
 *
 * The new door wrote DOC_APPROVED and stopped, so a filing approved through it sat
 * there forever: the applicant was told their papers passed and was never asked
 * for the audit fee, and no job picks such a filing up (payment-closure-job only
 * closes applications ALREADY in PENDING_AUDIT_FEE). Rather than copy the chain
 * into the second door — where the two copies would drift the first time either
 * changed — it lives here and both call it.
 *
 * Dependencies are injected so this is testable without the whole handler graph,
 * and so the caller decides which prisma/transaction client is in play.
 *
 * NEVER THROWS. The status write that produced DOC_APPROVED has already
 * committed; a throw here would 500 a decision that did happen and the officer
 * would press the button again. Same discipline as the notification branches.
 *
 * @returns {{chained: boolean, error: string|null}}
 */
async function applyDocumentApprovalConsequences({
    prisma, applicationId, actorId, actorRole, formData, workflowHistory,
    writeApplicationStatus, bulkUpdateRevisionDeadlineStatus, logger: log,
    // Injected so the consequence can be tested without dragging the numbering
    // chain into this module's load; defaults to the real issuer.
    issueQuotationOnSubmit: issueQuotation,
}) {
    const at = new Date().toISOString();
    try {
        await bulkUpdateRevisionDeadlineStatus({
            applicationId,
            fromStatuses: ['PENDING', 'SUBMITTED', 'EXTENDED'],
            data: { status: 'APPROVED', updatedBy: actorId },
        });

        await writeApplicationStatus({
            prisma,
            applicationId,
            fromStatus: 'DOC_APPROVED',
            toStatus: 'PENDING_AUDIT_FEE',
            actorId: 'SYSTEM',
            actorRole: 'system',
            reason: 'AUDIT_FEE_PAYMENT_REQUIRED',
            additionalData: {
                formData: {
                    ...(formData || {}),
                    workflowState: 'PENDING_AUDIT_FEE',
                    workflowStateUpdatedAt: at,
                    docApprovedAt: at,
                },
                workflowHistory: [
                    ...(Array.isArray(workflowHistory) ? workflowHistory : []),
                    {
                        timestamp: at,
                        action: 'AUDIT_FEE_PAYMENT_REQUIRED',
                        fromState: 'DOC_APPROVED',
                        toState: 'PENDING_AUDIT_FEE',
                        actorId: 'SYSTEM',
                        actorRole: 'system',
                        decidedBy: actorId || null,
                        decidedByRole: actorRole || null,
                    },
                ],
            },
        });
        // ── F-G4-71 — the งวดที่ 2 document, issued by the system (operator ruling
        //    2026-09-06, option ก) ───────────────────────────────────────────────
        //
        // Opening PENDING_AUDIT_FEE without a quotation opens a debt nobody can pay:
        // the checkout gate answers QUOTATION_NOT_ISSUED and the applicant's payments
        // page reads ฿0. The submit door already issues one, so the ordinary path was
        // covered — this closes the shapes that arrive without having gone through it.
        //
        // AFTER the status write, deliberately: a transition that did not happen must
        // not leave a price behind. Idempotent, so a filing that already carries a
        // quotation gets the same row rather than a second document. And it cannot
        // throw — DOC_APPROVED has committed, so a billing fault is logged and the
        // approval stands, exactly like the branches above it.
        let quotationIssued = false;
        try {
            const issue = issueQuotation
                || require('../../../../services/quotation-issuance-on-submit').issueQuotationOnSubmit;
            const outcome = await issue({
                application: { id: applicationId },
                actorId: 'SYSTEM',
                actorRole: 'system',
            });
            quotationIssued = Boolean(outcome && outcome.issued !== false);
        } catch (quotationErr) {
            const why = quotationErr && quotationErr.message ? quotationErr.message : String(quotationErr);
            if (log && typeof log.error === 'function') {
                log.error(
                    `[workflow-side-effects] audit-fee quotation not issued for ${applicationId} — `
                    + `the applicant cannot pay งวดที่ 2 until it is: ${why}`,
                );
            }
        }

        return { chained: true, error: null, quotationIssued };
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (log && typeof log.warn === 'function') {
            log.warn(`[workflow-side-effects] audit-fee chain failed for ${applicationId}: ${message}`);
        }
        return { chained: false, error: message, quotationIssued: false };
    }
}

module.exports = {
    buildRevisionDeadlineFormData,
    handleRevisionDeadlines,
    sendTransitionNotifications,
    handleCertificateIssuance,
    logTransitionAudit,
    applyDocumentApprovalConsequences,
};
