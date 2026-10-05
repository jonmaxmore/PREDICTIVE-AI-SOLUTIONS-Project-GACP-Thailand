const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    obj,
    arr,
    prisma,
    workflowTransitionService,
    getRequestIp,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    resolveUserIdFromHealthId,
    getRevisionDueAt,
    REVISION_SLA_DAYS,
    // Blocker F: the Thai-holiday-aware Asia/Bangkok engine (utils/working-days
    // via the deps barrel) — its calendar is built in, no holiday Set needed.
    addWorkingDays,
    ensureCertificateIssuedForApplication,
} = require('./workflow-handler-deps');
const { writeApplicationStatus } = require('../../../../services/application-status-writer');
const { answerSeparation } = require('../../../../shared/reviewer-inspector-separation');
const { buildRevisionDeadlineFormData } = require('./workflow-side-effects');
const { assertOnsiteEvidenceForPass } = require('../../../../services/onsite-evidence-gate');
const { onsiteEvidenceRefusal } = require('../../../../services/audit-decision-error-response');
const { statusTransitionAuditHook } = require('../../../../middleware/audit-logger');
// A2 (integrity-audit 2026-07-06): void the auto-issued certificate when a pass
// is reversed on this canonical endpoint (AUDIT_PASSED -> CAR_REVIEWING). Mirrors
// the auditor.js reject-to-auditor path — required directly (not via
// workflow-handler-deps) so the reversal void stays co-located with its caller.
const certificateService = require('../../../../services/certificate-service');
const { withVisibility } = require('../../../../shared/application-visibility');
// Batch 10 — Prisma bypass cleanup. The workflow handler's direct entity
// reads (application lookup + re-fetch, comment insert, revisionDeadline
// updateMany) now route through application-service + admin-application-service.
// `prisma` is preserved only as the transaction handle for canonical writers
// (writeApplicationStatus) and passed-through helpers.
const applicationService = require('../../../../services/application-service');
const adminApplicationService = require('../../../../services/admin-application-service');

// R2 M3 (Law 3.5/3.6 — SSOT เลข 5): the CAR window is the SAME canonical
// 5-working-day rule as the revision window (FINAL ข้อ 2: one clock length
// per stage) — config/business-rules.js PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS
// via the deps barrel. The alias is kept because the carSlaDays formData/
// metadata keys and the Blocker-F holiday pin reference CAR_SLA_DAYS by name.
const CAR_SLA_DAYS = REVISION_SLA_DAYS;

const getCarDueAt = (formData) => {
    const payload = obj(formData);
    const value = payload.carDueAt || payload.car_due_at || payload.carRequest?.dueAt || null;
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const applicationsWorkflowTransitions = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION),
    async (req, res) => {
        try {
            const idOrNumber = String(req.params.id || '').trim();
            const toState = String(req.body?.toState || '').trim().toUpperCase();
            const comment = req.body?.comment || null;
            const reasonCode = req.body?.reasonCode || null;
            const metadata = obj(req.body?.metadata);
            const revisionCategory = String(req.body?.revisionCategory || metadata.revisionCategory || '').trim() || null;
            const revisionMessage = String(req.body?.revisionMessage || metadata.revisionMessage || '').trim() || null;
            const revisionItems = arr(req.body?.revisionItems || metadata.revisionItems)
                .map((item) => String(item || '').trim())
                .filter(Boolean);
            const force = !!req.body?.force;
            const requestedState = workflowTransitionService.normalizeWorkflowStateInput(toState) || toState;
            const effectiveComment = comment || revisionMessage || null;
            const transitionMetadata = {
                ...metadata,
                ...(requestedState === 'REVISION_REQUESTED'
                    ? {
                        revisionCategory,
                        revisionMessage: revisionMessage || effectiveComment,
                        revisionItems,
                    }
                    : {}),
            };
            if (!idOrNumber || !toState) {
                return res.status(400).json({
                    success: false,
                    error: 'application id and toState are required',
                });
            }
            if (force && (!reasonCode || !comment)) {
                return res.status(400).json({
                    success: false,
                    error: 'force transition requires reasonCode and comment',
                });
            }
            if (!force && requestedState === 'REVISION_REQUESTED' && !effectiveComment) {
                return res.status(400).json({
                    success: false,
                    error: 'revisionMessage or comment is required when requesting revision',
                });
            }
            // Wave A Phase 28 — gate workflow transitions by application
            // visibility. The existing REV-11 inline ownership check at
            // line ~107 only fires for REVISION_REQUESTED and DOC_APPROVED;
            // other transitions weren't gated. The visibility helper
            // narrows auditors to their assigned applications across ALL
            // transition targets. Non-auditor roles fall through unchanged
            // (helper returns null).
            // applicationService.findFirstWithWhere — replaces
            // prisma.application.findFirst with the visibility-wrapped
            // OR(id, applicationNumber) predicate.
            const application = await applicationService.findFirstWithWhere({
                where: withVisibility(
                    {
                        OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                        isDeleted: false,
                    },
                    req.user,
                ),
                select: {
                    id: true,
                    applicationNumber: true,
                    healthId: true,
                    status: true,
                    formData: true,
                    workflowHistory: true,
                    reviewerId: true,
                    // auditorId retained for queue/visibility context (the former
                    // ISO 17065 §7.6 two-person check was removed 2026-06-05).
                    auditorId: true,
                },
            });
            if (!application) {
                return res.status(404).json({
                    success: false,
                    error: 'Application not found',
                });
            }
            const healthUserId = await resolveUserIdFromHealthId(application.healthId);
            const currentState = workflowTransitionService.resolveStateFromApplication(application);
            const currentFormData = obj(application.formData);

            // REV-11: Ownership check — only the assigned reviewer can approve/revision.
            //
            // Reads the canonical Application.reviewerId column (the single source
            // of truth for reviewer assignment). The legacy
            // formData.PROVIDERAssignment.reviewerId fallback was removed once the
            // column was backfilled for pre-Phase-44 rows
            // (scripts/backfill-reviewer-id.js). A null column = unassigned.
            if (!force && ['REVISION_REQUESTED', 'DOC_APPROVED'].includes(requestedState)) {
                if (application.reviewerId && application.reviewerId !== req.user.id) {
                    return res.status(403).json({
                        success: false,
                        error: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมายสำหรับคำขอนี้',
                    });
                }
            }

            // REV-12 (the all-9-steps approve gate) was DROPPED 2026-06-23 (owner
            // decision, pilot-simplify): the per-step review-progress UI was never
            // wired (its writer had no FE caller), so the gate could only ever block.
            // Document review is a holistic approve / request-revision decision gated
            // by reviewer-ownership (REV-11) + the mandatory comment on revision + the
            // role/edge checks. The 9 sections remain a reference checklist in the UI.

            const markAsCancelledExpired = async (expiredReason, fromState) => {
                const ts = new Date().toISOString();
                await writeApplicationStatus({
                    prisma,
                    applicationId: application.id,
                    fromStatus: application.status,
                    toStatus: 'EXPIRED',
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role || null,
                    reason: expiredReason === 'REVISION_OVERDUE' ? 'REVISION_DEADLINE_EXPIRED' : 'CAR_DEADLINE_EXPIRED',
                    additionalData: {
                        updatedBy: req.user.id,
                        formData: {
                            ...currentFormData,
                            workflowState: 'EXPIRED',
                            workflowStateUpdatedAt: ts,
                            canceledExpiredAt: ts,
                            cancelReason: expiredReason,
                        },
                        workflowHistory: [
                            ...arr(application.workflowHistory),
                            {
                                timestamp: ts,
                                action: expiredReason === 'REVISION_OVERDUE'
                                    ? 'REVISION_DEADLINE_EXPIRED'
                                    : 'CAR_DEADLINE_EXPIRED',
                                fromState,
                                toState: 'EXPIRED',
                                actorId: req.user.id,
                                actorRole: req.user.canonicalRole || req.user.role || null,
                            },
                        ],
                    },
                });

                if (expiredReason === 'REVISION_OVERDUE') {
                    // adminApplicationService.bulkUpdateRevisionDeadlineStatus —
                    // replaces prisma.revisionDeadline.updateMany.
                    await adminApplicationService.bulkUpdateRevisionDeadlineStatus({
                        applicationId: application.id,
                        fromStatuses: ['PENDING', 'EXTENDED'],
                        data: { status: 'FAILED', updatedBy: req.user.id },
                    });
                }
            };

            if (!force && currentState === 'REVISION_REQUESTED' && requestedState === 'ASSIGNED_FOR_REVIEW') {
                const dueAt = getRevisionDueAt(currentFormData);
                if (dueAt && new Date() > dueAt) {
                    await markAsCancelledExpired('REVISION_OVERDUE', currentState);
                    return res.status(400).json({
                        success: false,
                        error: 'Revision deadline exceeded. Application has been cancelled.',
                    });
                }
            }

            if (!force && currentState === 'CAR_PENDING' && requestedState === 'CAR_REVIEWING') {
                const carDueAt = getCarDueAt(currentFormData);
                if (carDueAt && new Date() > carDueAt) {
                    await markAsCancelledExpired('CAR_OVERDUE', currentState);
                    return res.status(400).json({
                        success: false,
                        error: 'CAR deadline exceeded. Application has been cancelled.',
                    });
                }
            }

            const transition = workflowTransitionService.buildTransitionUpdate({
                application,
                toState,
                actorId: req.user.id,
                actorRole: req.user.canonicalRole,
                reasonCode,
                comment: effectiveComment,
                metadata: transitionMetadata,
                force,
            });

            if (transition.nextState === 'REVISION_REQUESTED') {
                // Shared with the reviewer screen's per-slot request (document-reviews.js):
                // one definition of the revision clock.
                const revisionClock = buildRevisionDeadlineFormData({
                    baseFormData: transition.updateData.formData,
                    category: revisionCategory,
                    message: revisionMessage || effectiveComment,
                    items: revisionItems,
                    requestedBy: req.user.providerId || req.user.id,
                    requestedByRole: req.user.canonicalRole || req.user.role || null,
                });
                transition.updateData.formData = revisionClock.formData;
                transition.transitionEvent.metadata = {
                    ...(obj(transition.transitionEvent.metadata)),
                    ...revisionClock.eventMetadata,
                };
            } else if (transition.nextState === 'CAR_PENDING') {
                const requestedAt = new Date();
                // Blocker F: same Thai-holiday-aware engine as the REVISION path
                // above (and as car-deadline-service.js on the sibling surfaces).
                const dueAt = addWorkingDays(requestedAt, CAR_SLA_DAYS);
                transition.updateData.formData = {
                    ...transition.updateData.formData,
                    carRequestedAt: requestedAt.toISOString(),
                    carDueAt: dueAt.toISOString(),
                    carSlaDays: CAR_SLA_DAYS,
                    car_requested_at: requestedAt.toISOString(),
                    car_due_at: dueAt.toISOString(),
                    car_sla_days: CAR_SLA_DAYS,
                    carRequest: {
                        message: effectiveComment,
                        requestedAt: requestedAt.toISOString(),
                        dueAt: dueAt.toISOString(),
                        requestedBy: req.user.providerId || req.user.id,
                        requestedByRole: req.user.canonicalRole || req.user.role || null,
                    },
                };
                transition.transitionEvent.metadata = {
                    ...(obj(transition.transitionEvent.metadata)),
                    carRequestedAt: requestedAt.toISOString(),
                    carDueAt: dueAt.toISOString(),
                    carSlaDays: CAR_SLA_DAYS,
                    car_requested_at: requestedAt.toISOString(),
                    car_due_at: dueAt.toISOString(),
                    car_sla_days: CAR_SLA_DAYS,
                };
            }

            if (['REVISION_REQUESTED', 'DOC_APPROVED'].includes(transition.nextState)) {
                const reviewHistory = arr(currentFormData.reviewHistory);
                transition.updateData.formData = {
                    ...transition.updateData.formData,
                    reviewHistory: [
                        ...reviewHistory,
                        {
                            timestamp: new Date().toISOString(),
                            action: transition.nextState === 'DOC_APPROVED' ? 'approve' : 'revision',
                            category: revisionCategory,
                            comment: effectiveComment,
                            items: revisionItems,
                            by: req.user.providerId || req.user.id,
                            byRole: req.user.canonicalRole || req.user.role || null,
                        },
                    ],
                };
            }

            // Use the canonical writer instead of a direct prisma.update so
            // every transition spawns its corresponding work-activity row
            // (ADR-016 Phase 1A) and cancels open activities on terminal
            // states (REJECTED / EXPIRED / CERTIFIED). Bypassing this
            // wrapper meant the work queue stayed populated with rows for
            // applications that had already moved on, and the new-stage
            // owner saw nothing in their queue for the freshly-arrived
            // transition. transition.updateData already has the right
            // shape; we just split status off so writeApplicationStatus
            // gets toStatus separately.
            const { status: toStatus, ...transitionExtras } = transition.updateData;
            // A1 (integrity-audit 2026-07-06): an ADMIN `force` transition bypasses
            // the role/edge gate, so a FORCED landing on AUDIT_PASSED (or APPROVED)
            // must NOT let the writer's cert hook auto-mint a certificate with no
            // fresh audit — that is the single-auditor SoD back-door. This is the
            // 4th sibling of the 3 admin force/revert paths that already pass
            // autoIssueCertificate:false (admin.js, admin/applications.js,
            // admin-application-service.js force+revert). A LEGITIMATE (non-force)
            // auditor AUDIT_PASSED still auto-issues, and the legitimate APPROVED
            // issuance still runs via handleCertificateIssuance below regardless of
            // this flag (it is gated on transition.nextState === 'APPROVED').
            const writeArgs = {
                applicationId: application.id,
                fromStatus: application.status,
                toStatus,
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role || null,
                reason: reasonCode || `WORKFLOW_${transition.nextState}`,
                additionalData: transitionExtras,
                autoIssueCertificate: !force,
            };

            // Full-system audit area H (2026-07-11): this canonical DOCUMENT_REVIEWER
            // + admin-force transition path previously wrote its ONLY AuditLog row
            // AFTER commit, best-effort (workflow-side-effects.logTransitionAudit,
            // swallows failure) — so a DOC_APPROVED/REVISION_REQUESTED/APPROVED/force
            // transition could commit with NO immutable hash-chained attribution on a
            // transient fault. Wire the same in-$transaction onAudit hook every
            // consequential sibling uses (auditor cert path #646 audits.js, admin
            // force/revert admin-application-service.js) so the transition row is
            // written through the tx, atomic with the status flip. (The post-commit
            // rich WORKFLOW_TRANSITION event below is kept as extra operational
            // context — additive, no behavior removed.)
            const transitionAuditMetadata = {
                applicationNumber: application.applicationNumber,
                previousWorkflowState: transition.previousState,
                nextWorkflowState: transition.nextState,
                reasonCode: reasonCode || null,
                comment: effectiveComment || null,
                force,
            };

            // A2 (integrity-audit 2026-07-06): reversing a pass (AUDIT_PASSED ->
            // CAR_REVIEWING) on this canonical endpoint must VOID the certificate
            // that was auto-issued on the pass — otherwise the public QR keeps
            // reporting the cert VALID for a farm now under corrective action.
            // Mirror the auditor.js reject-to-auditor void: run the status write +
            // cert void (which also invalidates the audit-pass record, #15) in ONE
            // transaction so we never leave a live cert for a reverted application
            // and a re-pass can mint a fresh one. Keyed on the transition EDGE so it
            // covers BOTH the auditor (non-force) and the ADMIN (force) reversal.
            // revokeCertificateForApplication is a no-op when no live cert exists.
            // A2 (integrity-audit 2026-07-06): void on EVERY reversal off a cert-live
            // state, not just the one AUDIT_PASSED->CAR_REVIEWING edge. A cert is live
            // after AUDIT_PASSED (writer hook auto-issues) and stays live through
            // APPROVED/CERTIFIED. The narrow predicate missed ADMIN force reversals
            // (AUDIT_PASSED->REJECTED, CERTIFIED->REJECTED, APPROVED->CAR_REVIEWING) —
            // admins WILL use force for AUDIT_PASSED->REJECTED (no non-force edge
            // exists) — leaving a public-VALID cert on /verify + QR for a
            // rejected/reverted farm. Void when LEAVING a cert-live state and NOT
            // staying on the cert track (APPROVED/CERTIFIED). Forward edges
            // AUDIT_PASSED->APPROVED and APPROVED->CERTIFIED stay on-track (next ∈
            // CERT_KEEP) → not voided. revokeCertificateForApplication is a no-op
            // when no live cert exists, so this is safe on all covered edges.
            const CERT_LIVE = new Set(['AUDIT_PASSED', 'APPROVED', 'CERTIFIED']);
            const CERT_KEEP = new Set(['APPROVED', 'CERTIFIED']);
            const isCertVoidingReversal =
                CERT_LIVE.has(transition.previousState) && !CERT_KEEP.has(transition.nextState);

            // R2 M2 (operator decision D-8, 2026-08-03 — evidence/R2-special-
            // reopen/decisions-final.md): a correction decision
            // (REVISION_REQUESTED / CAR_PENDING) must mint its official letter
            // (จดหมายราชการในระบบ, M1 official-letter kind) INSIDE the same
            // transaction as the status write — the 5-working-day clock starts
            // at "บันทึกผล+ออกจดหมาย" as ONE atomic event, so a letter that
            // cannot be written must fail the whole transition. The plain
            // in-app/email notices in workflow-side-effects stay best-effort
            // AFTER commit (side channels must not fire inside an uncommitted
            // tx). decision-letter-service is required lazily (mirrors the
            // side-effects require below) so transitions that never mint a
            // letter don't load the notification stack.
            //
            // R2 M3b (same evidence file, §TERMINAL_DECISION letter): a transition
            // landing on REJECTED is terminal, so it mints the ADMINISTRATIVE-ORDER
            // letter instead — different element set (no deadline, no round), same
            // atomicity rule. This covers the auditor's AUDIT_CONFIRMED->REJECTED
            // edge AND the admin `force` rejections off a cert-live state, which are
            // the only other ways this endpoint reaches REJECTED.
            const isCorrectionDecision = ['REVISION_REQUESTED', 'CAR_PENDING'].includes(transition.nextState);
            const isTerminalRejection = transition.nextState === 'REJECTED';
            const mintDecisionLetter = async (tx) => {
                if (isTerminalRejection) {
                    const { mintTerminalDecisionLetter } = require('../../../../services/decision-letter-service');
                    await mintTerminalDecisionLetter({
                        tx,
                        healthId: application.healthId,
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        // stage ที่ตัดสิน = the canonical state the case was decided in.
                        stage: transition.previousState,
                        // REJECTED is a mandatory-comment target in the canonical
                        // state machine and `force` requires reasonCode + comment, so
                        // a ground always exists on the legitimate paths. A blank one
                        // refuses the letter and rolls the transition back (D-8).
                        reason: effectiveComment || reasonCode,
                    });
                    return;
                }
                if (!isCorrectionDecision) { return; }
                const { mintCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../../../services/decision-letter-service');
                const decidedFormData = obj(transition.updateData.formData);
                const isCar = transition.nextState === 'CAR_PENDING';
                await mintCorrectionLetter({
                    tx,
                    healthId: application.healthId,
                    applicationId: application.id,
                    applicationNumber: application.applicationNumber,
                    stage: isCar ? CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR : CORRECTION_LETTER_STAGE.DOC_REVIEW,
                    items: isCar ? [] : revisionItems,
                    message: isCar ? effectiveComment : (revisionMessage || effectiveComment),
                    dueAt: isCar ? decidedFormData.carDueAt : decidedFormData.revisionDueAt,
                });
            };

            if (isCertVoidingReversal) {
                await prisma.$transaction(async (tx) => {
                    await writeApplicationStatus({
                        ...writeArgs,
                        prisma: tx,
                        onAudit: statusTransitionAuditHook({ tx, metadata: transitionAuditMetadata }),
                    });
                    await certificateService.revokeCertificateForApplication(application.id, {
                        revokedBy: req.user.id,
                        reason: `Audit pass reversed: ${effectiveComment || reasonCode || 'CAR review'}`,
                        prisma: tx,
                    });
                    await mintDecisionLetter(tx);
                });
            } else {
                await prisma.$transaction(async (tx) => {
                    // The inspector's PASS through this door asks the same onsite-evidence
                    // question as the job sheet and the audit-result door; a refusal writes
                    // nothing. `force` is admin recovery, which this door has always kept
                    // outside the evidence rules.
                    if (transition.nextState === 'AUDIT_PASSED' && !force) {
                        await assertOnsiteEvidenceForPass({ prisma: tx, application });
                    }
                    await writeApplicationStatus({
                        ...writeArgs,
                        prisma: tx,
                        onAudit: statusTransitionAuditHook({ tx, metadata: transitionAuditMetadata }),
                    });
                    await mintDecisionLetter(tx);
                });
            }
            // Re-fetch with the original select shape since writeApplicationStatus
            // returns the full row. Downstream side-effects below
            // (handleRevisionDeadlines, sendTransitionNotifications,
            // handleCertificateIssuance, logTransitionAudit) all read from
            // this `updated` reference.
            // applicationService.getById — replaces prisma.application.findUnique
            // re-fetch after writeApplicationStatus.
            const updated = await applicationService.getById(application.id, {
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    updatedAt: true,
                    updatedBy: true,
                },
            });

            // Persist ApplicationComment for revision/CAR transitions (audit trail)
            if (['REVISION_REQUESTED', 'CAR_PENDING'].includes(transition.nextState) && effectiveComment) {
                // applicationService.isApplicationCommentModelAvailable +
                // applicationService.createApplicationCommentIfAvailable —
                // replaces direct prisma.applicationComment.create. Split into
                // two calls so the "model unavailable" branch still emits the
                // same dedicated warning as before.
                if (applicationService.isApplicationCommentModelAvailable()) {
                    await applicationService.createApplicationCommentIfAvailable({
                        applicationId: application.id,
                        authorId: req.user.id,
                        role: req.user.canonicalRole || req.user.role || 'PROVIDER',
                        // commentType (DOC_REVISION/FIELD_CAR) + revisionItems are
                        // persisted in the transition metadata/formData; the comment
                        // row carries the human-readable text.
                        content: effectiveComment,
                    }).catch((commentErr) => {
                        logger.warn('[provider] ApplicationComment creation failed', {
                            message: commentErr.message,
                            applicationId: application.id,
                        });
                    });
                } else {
                    logger.warn('[provider] ApplicationComment model unavailable, skip comment persistence', {
                        applicationId: application.id,
                        transition: transition.nextState,
                    });
                }
            }
            // ─── Side Effects (extracted to workflow-side-effects.js) ───
            const sideEffects = require('./workflow-side-effects');

            await sideEffects.handleRevisionDeadlines(prisma, {
                application, transition, reqUser: req.user, getRevisionDueAt,
                updated, arr, logger,
            });

            let issuedCertificate = null;
            // A1 (integrity-audit 2026-07-06): force-gate this SECOND cert-mint path
            // too. buildTransitionUpdate lets ADMIN+force land APPROVED from ANY state
            // (incl. CERTIFIED), and revokeCertificate does NOT clear the audit-pass
            // record, so a compromised ADMIN force→APPROVED after a revoke would mint a
            // FRESH active cert off the surviving pass = a hidden un-revoke (public
            // /verify + QR flip back to VALID). The writer's auto-issue hook is already
            // force-gated (autoIssueCertificate:!force above); this path must match.
            if (transition.nextState === 'APPROVED' && !force) {
                try {
                    issuedCertificate = await sideEffects.handleCertificateIssuance(prisma, logger, {
                        application, transition, reqUser: req.user, healthUserId: healthUserId,
                        ensureCertificateIssuedForApplication,
                    });
                } catch (certificateError) {
                    logger.error('[provider] certificate issuance failed on APPROVED', {
                        applicationId: application.id,
                        message: certificateError.message,
                    });
                    return res.status(409).json({
                        success: false,
                        error: 'Certificate issuance failed',
                        message: certificateError.message,
                    });
                }
            }

            await sideEffects.sendTransitionNotifications(prisma, logger, {
                application, transition, healthUserId,
                getRevisionDueAt, revisionCategory, revisionMessage, effectiveComment, revisionItems,
            });

            await sideEffects.logTransitionAudit(auditLogger, logger, {
                AuditCategory, AuditSeverity, ResourceType,
                application, transition, reqUser: req.user,
                reasonCode, effectiveComment, force, issuedCertificate,
                getRequestIp, req,
            });

            return res.json({
                success: true,
                data: {
                    application: updated,
                    transition: {
                        fromState: transition.previousState,
                        toState: transition.nextState,
                        fromStatus: application.status,
                        toStatus: transition.nextLegacyStatus,
                    },
                    certificate: issuedCertificate ? {
                        id: issuedCertificate.id,
                        number: issuedCertificate.certificateNumber,
                    } : null,
                },
            });
        } catch (error) {
            // Separation of duties raised by the status writer (reviewer == inspector, no force bypass).
            if (answerSeparation(res, error)) { return undefined; }
            // Workflow transition-guard errors (buildTransitionUpdate throws plain
            // Errors with these messages, no .status/.code) → 422 INVALID_TRANSITION,
            // matching the cert-workflow contract + the sibling auditor.js handler.
            // A genuine server fault (unmatched message) stays 500.
            const evidenceRefusal = onsiteEvidenceRefusal(error);
            if (evidenceRefusal) {
                logger.warn('[provider] workflow transition refused on onsite evidence', { code: error.code });
                return res.status(evidenceRefusal.status).json({
                    ...evidenceRefusal.body,
                    message: evidenceRefusal.body.messageTh,
                });
            }
            const msg = String(error.message || '');
            const isTransitionGuard = /cannot transition|Invalid transition|already in workflow state|Only admin can force|Unknown actor role|Invalid workflow state|requires a mandatory comment/i.test(msg);
            const statusCode = error.status || (isTransitionGuard ? 422 : 500);
            logger.error('[provider] workflow transition failed', { message: error.message });
            // Surface the transition-guard reason (422 INVALID_TRANSITION) — the FE
            // error-translator keys off this string. On a genuine 500, return a
            // generic message so an internal/Prisma error never leaks to the client
            // (the real cause is logged above).
            return res.status(statusCode).json({
                success: false,
                error: 'Workflow transition failed',
                code: error.code || (isTransitionGuard ? 'INVALID_TRANSITION' : undefined),
                message: statusCode >= 500 ? 'Workflow transition failed' : error.message,
            });
        }
    },
];

module.exports = {
    applicationsWorkflowTransitions,
};
