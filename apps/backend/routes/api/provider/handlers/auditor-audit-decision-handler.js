const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    obj,
    arr,
    prisma, // retained ONLY as the transaction handle passed into writeApplicationStatus
    workflowTransitionService,
    getRequestIp,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    resolveUserIdFromHealthId,
    applicationService,
} = require('./auditor-handler-deps');
const { writeApplicationStatus } = require('../../../../services/application-status-writer');
const { auditDecisionErrorResponse } = require('../../../../services/audit-decision-error-response');
const { createNotification } = require('../../../../services/notification-service');
// Separation of duties at decision time (operator ruling 2026-10-05).
const { assertDecisionNotByReviewerAndInspector, answerSeparation } = require('../../../../shared/reviewer-inspector-separation');
const { assertOnsiteEvidenceForPass } = require('../../../../services/onsite-evidence-gate');
const { lookup: lookupErrorCode } = require('../../../../shared/error-codes');
// AUDIT-001 / #539 (extended 2026-06-24, multi-role system test): admin is NOT in
// the audit-decision path (SoD — "admin is not in the workflow"). Gate this PRIMARY
// surface to AUDITORS (which excludes ADMIN) like the /audits/:id/result and
// /onsite/:auditId/decision siblings; previously this route gated only on the
// APPLICATION_AUDIT_RECORD permission (which ADMIN holds via the all-perms set) +
// an ADMIN ownership-bypass, so an admin could record PASS and auto-issue a cert.
// Admin recovery is the workflow `force` path, never this route.
const { requireRole } = require('../../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../../shared/canonical-rbac');
// Workflow audit 2026-06-11 (HIGH): a CAR raised here must start the canonical
// 5-working-day SLA clock (carDueAt + RevisionDeadline row) so the crons can
// auto-expire it — previously this path set neither, so CARs never expired.
const { computeCarDueDate, seedCarRevisionDeadline } = require('../../../../services/car-deadline-service');
// Closing-review NEW-2 (2026-05-15): mask the raw 13-digit identifier before
// writing it into the hash-chained audit row. Raw nationals IDs in audit are a
// PDPA Section 27 violation when admins read the audit feed.
const { maskThaiId } = require('../../../../utils/field-encryption');

const auditorAuditDecisions = [
    authenticateProvider,
    requireRole(ROLE_GROUPS.AUDITORS),
    requireCanonicalPermission(PERMISSIONS.APPLICATION_AUDIT_RECORD),
    async (req, res) => {
        try {
            const idOrNumber = String(req.params.id || '').trim();
            const decision = String(req.body?.decision || '').trim().toUpperCase();
            const notes = String(req.body?.notes || '').trim() || null;
            const checklist = arr(req.body?.checklist);
            const evidence = arr(req.body?.evidence);
            const reasonCode = String(req.body?.reasonCode || '').trim().toUpperCase() || null;
            const findings = arr(req.body?.findings).map((f, idx) => ({
                index: idx + 1,
                nonConformity: String(f?.nonConformity || '').trim(),
                correctiveAction: String(f?.correctiveAction || '').trim(),
                category: String(f?.category || '').trim() || null,
            })).filter((f) => f.nonConformity || f.correctiveAction);

            if (!idOrNumber) {
                return res.status(400).json({ success: false, error: 'Application id is required' });
            }
            if (!['PASS', 'MINOR', 'MAJOR', 'REJECT'].includes(decision)) {
                return res.status(400).json({ success: false, error: 'decision must be PASS, MINOR, MAJOR, or REJECT' });
            }

            const application = await applicationService.findAuditDecisionApplication(idOrNumber);
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }
            const healthUserId = await resolveUserIdFromHealthId(application.healthId);

            // Ownership is unconditional now: the AUDITORS gate above already
            // excludes ADMIN, so there is no admin carve-out here — an auditor may
            // only decide on an audit assigned to them.
            if (application.auditorId !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Application is not assigned to this auditor' });
            }

            try {
                assertDecisionNotByReviewerAndInspector({
                    actorId: req.user.id,
                    reviewerId: application.reviewerId,
                    auditorId: application.auditorId,
                });
            } catch (sodError) {
                if (answerSeparation(res, sodError)) { return undefined; }
                throw sodError;
            }

            const currentState = workflowTransitionService.resolveStateFromApplication(application);
            if (!['AUDIT_CONFIRMED', 'CAR_REVIEWING'].includes(currentState)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid state for decision (${currentState}).`,
                });
            }
            // CAR_REVIEWING → AUDIT_PASSED | CAR_PENDING are the two edges the workflow
            // table gives the inspector (ROLE_TRANSITIONS FIELD_INSPECTOR). PASS closes
            // the corrective action; MINOR / MAJOR say it is not yet enough and send it
            // back to the applicant (CAR_PENDING). REJECT is NOT an edge from
            // CAR_REVIEWING — the application is already past the point where it can be
            // refused outright — so the screen no longer offers it and this refuses it.
            if (currentState === 'CAR_REVIEWING' && decision === 'REJECT') {
                return res.status(400).json({
                    success: false,
                    code: 'CAR_REVIEWING_CANNOT_REJECT',
                    error: lookupErrorCode('CAR_REVIEWING_CANNOT_REJECT').messageTh,
                });
            }
            // An outright rejection is terminal (AUDIT_CONFIRMED → REJECTED) — require
            // a justification so the applicant and the audit trail record why. MINOR /
            // MAJOR don't need this here: they enter the correctable CAR loop instead.
            if (decision === 'REJECT' && !notes && !reasonCode) {
                return res.status(400).json({
                    success: false,
                    error: 'REJECT requires a reason — provide notes or reasonCode.',
                });
            }
            // Workflow audit 2026-06-11 (MEDIUM): CAR_PENDING is a mandatory-comment
            // target in the canonical state machine (REQUIRES_COMMENT_TARGETS), but
            // this handler writes via writeApplicationStatus (edge+role only) which
            // bypasses that gate. So enforce it here, mirroring the C2-01 fix on the
            // sibling /audits/:id/result route: a corrective-action request (MINOR/
            // MAJOR → CAR_PENDING) must say WHAT to fix — via notes, reasonCode, or
            // at least one structured finding — so the applicant + the hash-chained
            // audit trail record the reason.
            if ((decision === 'MINOR' || decision === 'MAJOR') && !notes && !reasonCode && findings.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'A corrective-action request requires what to fix — provide notes, reasonCode, or findings.',
                });
            }

            // P0-2 (2026-06-10, owner-directed): the AUD-13 automated GACP-score gate
            // was REMOVED. Canon (F1) is human PASS/FAIL only — no automated machine
            // score may override the on-site auditor's certification decision. (#298
            // removed the fabricated cert score; SCORE-01 / 8-category abandoned.) The
            // auditor's PASS is not scored — but it IS evidence-gated (below). The
            // certificate is issued later, at APPROVED, by the certificate approver.

            const nowIso = new Date().toISOString();
            const currentFormData = obj(application.formData);
            const currentHistory = arr(application.workflowHistory);
            const updateData = {
                status: application.status,
                updatedBy: req.user.id,
                formData: {
                    ...currentFormData,
                    workflowState: currentState,
                    workflowStateUpdatedAt: nowIso,
                },
                workflowHistory: [...currentHistory],
            };

            const decisionRecord = {
                decision,
                notes,
                checklist,
                evidence,
                findings,
                decidedAt: nowIso,
                decidedBy: req.user.providerId || req.user.id,
                decidedByRole: req.user.canonicalRole || req.user.role || null,
                reasonCode,
            };

            const history = arr(updateData.workflowHistory);
            const formData = obj(updateData.formData);
            const auditDecisions = arr(formData.auditDecisions);
            let nextStatus = updateData.status;
            let nextWorkflowState = formData.workflowState;

            if (decision === 'PASS') {
                nextStatus = 'AUDIT_PASSED';
                nextWorkflowState = 'AUDIT_PASSED';
            } else if (decision === 'MINOR' || decision === 'MAJOR') {
                nextStatus = 'CAR_PENDING';
                nextWorkflowState = 'CAR_PENDING';
            } else if (decision === 'REJECT') {
                nextStatus = 'REJECTED';
                nextWorkflowState = 'REJECTED';
            }

            // CAR SLA clock (workflow audit 2026-06-11, HIGH): when entering
            // CAR_PENDING, compute the 5-working-day due date (Thai-holiday-aware)
            // so it can be stamped into formData below and a RevisionDeadline row
            // seeded after the write — without this, neither auto-expiry cron fires.
            const carDueAt = nextStatus === 'CAR_PENDING' ? computeCarDueDate(new Date(nowIso)) : null;

            const finalWorkflowHistory = [
                ...history,
                {
                    timestamp: nowIso,
                    action: 'AUDIT_DECISION_RECORDED',
                    decision,
                    reasonCode,
                    notes,
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role || null,
                },
            ];

            // Use the canonical writer instead of a direct prisma.update so
            // the AUDIT_PASSED / CAR_PENDING transition spawns its work-
            // activity (ADR-016 Phase 1A) and the approvers are told. The writer does
            // NOT issue a certificate at AUDIT_PASSED any more — that is the approver's
            // decision at APPROVED (F-CERT-SOD 2026-09-10). For
            // CAR_PENDING the applicant (CAR_PENDING → CAR_REVIEWING) picks the
            // item up. Audit emission stays via the explicit auditLogger.log()
            // block below.
            const auditStatusWrite = {
                applicationId: application.id,
                // Send the CANONICAL from-state, not the raw column. application.status
                // may carry a legacy alias (e.g. AUDIT_IN_PROGRESS → AUDIT_CONFIRMED);
                // currentState is the normalized value the guard above already
                // validated, and it's what the state machine / strict assertion
                // expects.
                fromStatus: currentState,
                toStatus: nextStatus,
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role || null,
                reason: `AUDIT_DECISION_${decision}`,
                // WF-F4: this handler's transitions (AUDIT_CONFIRMED/CAR_REVIEWING
                // → AUDIT_PASSED|CAR_PENDING|REJECTED) are all table-legal for the
                // auditor role, so opt into strict enforcement — an out-of-band
                // status or a future illegal mapping now fails loudly instead of
                // silently writing a bad transition.
                assertTransition: true,
                additionalData: {
                    formData: {
                        ...formData,
                        workflowState: nextWorkflowState,
                        workflowStateUpdatedAt: nowIso,
                        // Record the audit-PASS proof. The certificate is issued later,
                        // at APPROVED, by the certificate approver; generateCertificate's
                        // audit-pass gate reads formData.auditResult + auditedAt.
                        ...(decision === 'PASS' ? { auditResult: 'PASS', auditedAt: nowIso } : {}),
                        auditDecision: decisionRecord,
                        auditDecisions: [...auditDecisions, decisionRecord],
                        // Stamp the CAR due date so the /auto-cancel cron + the
                        // applicant-facing CAR enforcement (applications-car.js) read it.
                        ...(carDueAt ? { carDueAt: carDueAt.toISOString(), car_due_at: carDueAt.toISOString() } : {}),
                        auditFollowup: decision === 'MINOR'
                            ? { required: true, type: 'MINOR', requestedAt: nowIso, status: 'REQUESTED' }
                            : decision === 'MAJOR'
                                ? { required: true, type: 'MAJOR', requestedAt: nowIso, status: 'REQUESTED' }
                                : null,
                    },
                    workflowHistory: finalWorkflowHistory,
                },
            };
            // BE-T1 (multi-role system test 2026-06-24): run the evidence check and the
            // status flip in ONE transaction so a refusal writes nothing. Mirror of
            // /audits/:id/result.
            //
            // R2 M2 (operator decision D-8, 2026-08-03 — evidence/R2-special-reopen/
            // decisions-final.md): MINOR/MAJOR → CAR_PENDING starts the correction
            // clock, so the official Thai letter (จดหมายราชการในระบบ, M1
            // official-letter kind — ผลไม่ผ่าน + รายการประเด็น + กำหนดส่ง + ช่องทาง)
            // must commit atomically with the decision: a letter that cannot be
            // written rolls the decision back. The English best-effort notice below
            // stays a post-commit side channel. Lazy require so decisions that never
            // mint a letter (PASS) don't load the notification stack.
            //
            // R2 M3b (same evidence file, §TERMINAL_DECISION letter): a REJECT is
            // terminal — the applicant gets an administrative order instead of a
            // correction letter, minted in this SAME transaction (D-8) with the
            // officer's recorded ground as its mandatory เหตุผลประกอบ. No round row:
            // terminal is not a correction round.
            await prisma.$transaction(async (tx) => {
                // The inspector's PASS rests on the same onsite evidence the certificate
                // will — refuse it HERE, with the reason, not after the file has reached
                // the approver's queue. Inside the transaction so it reads the rows the
                // write will sit beside; a refusal writes nothing.
                if (decision === 'PASS') {
                    await assertOnsiteEvidenceForPass({ prisma: tx, application });
                }
                await writeApplicationStatus({ ...auditStatusWrite, prisma: tx });
                if (nextStatus === 'CAR_PENDING') {
                    const { mintCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../../../services/decision-letter-service');
                    await mintCorrectionLetter({
                        tx,
                        healthId: application.healthId,
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        stage: CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR,
                        items: findings
                            .map((f) => [f.nonConformity, f.correctiveAction].filter(Boolean).join(' แนวทางแก้ไข: '))
                            .filter(Boolean),
                        message: notes || reasonCode,
                        dueAt: carDueAt,
                    });
                }
                if (nextStatus === 'REJECTED') {
                    const { mintTerminalDecisionLetter } = require('../../../../services/decision-letter-service');
                    await mintTerminalDecisionLetter({
                        tx,
                        healthId: application.healthId,
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        // The canonical FROM state this handler already validated.
                        stage: currentState,
                        // The REJECT guard above (notes || reasonCode) makes this
                        // non-empty; a blank one would refuse the letter and roll
                        // the whole decision back, which is the intended D-8 shape.
                        reason: notes || reasonCode,
                    });
                }
            });
            // CAR SLA clock (workflow audit 2026-06-11, HIGH): seed the
            // RevisionDeadline row the hourly revision-deadline-checker cron scans,
            // mirroring workflow-side-effects.js. Best-effort — a deadline-seed
            // failure must not undo a recorded auditor decision, but it is logged
            // because it is the SLA clock for the corrective-action window.
            if (carDueAt) {
                try {
                    await seedCarRevisionDeadline({
                        applicationId: application.id,
                        dueAt: carDueAt,
                        actorId: req.user.id,
                    });
                } catch (deadlineErr) {
                    logger.error(`[AuditDecision] CAR deadline seed failed for ${application.id}: ${deadlineErr?.message}`);
                }
            }

            // Re-fetch with the original select shape — writeApplicationStatus
            // doesn't expose select. The downstream code reads applicationNumber
            // and status from this row.
            const updated = await applicationService.findAuditDecisionPostWriteSlice(application.id);

            // PASS: the applicant's notice is the writer's APPLICANT_AUDIT_PASSED fanout (same
            // AUDIT_PASSED write) — a second copy from here told them twice.
            if (healthUserId && decision !== 'PASS') {
                await createNotification({
                    userId: healthUserId,
                    type: decision === 'MINOR' ? 'WARNING' : 'ERROR',
                    // ถึงผู้ยื่น — ภาษาไทย (ผล PASS แจ้งโดย writer ไม่ใช่ที่นี่)
                    title: decision === 'REJECT' ? 'คำขอไม่ผ่านการตรวจประเมิน'
                        : 'ผลการตรวจแปลงต้องแก้ไข',
                    message: decision === 'REJECT'
                            ? `คำขอ ${application.applicationNumber} ไม่ผ่านการตรวจประเมินแปลง`
                            : `คำขอ ${application.applicationNumber} ผลการตรวจแปลงต้องแก้ไข กรุณาดูรายละเอียดและส่งหลักฐานการแก้ไขภายในกำหนด`,
                    data: {
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        decision,
                        reasonCode,
                        notes,
                    },
                }).catch((notificationError) => {
                    logger.warn('[provider] auditor decision notification failed', { message: notificationError.message });
                });
            }

            await auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'AUDIT_DECISION_RECORDED',
                severity: (decision === 'MAJOR' || decision === 'REJECT') ? AuditSeverity.WARNING : AuditSeverity.INFO,
                actorId: req.user.id || 'SYSTEM',
                actorRole: req.user.canonicalRole || req.user.role || 'UNKNOWN',
                actorType: 'PROVIDER',
                resourceType: ResourceType.APPLICATION,
                resourceId: application.id,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    applicationNumber: application.applicationNumber,
                    decision,
                    reasonCode,
                    notes,
                    previousStatus: application.status,
                    nextStatus,
                    previousWorkflowState: currentState,
                    nextWorkflowState,
                    actorIdentity: maskThaiId(req.user.providerId) || maskThaiId(req.user.healthId) || null,
                },
            }).catch((auditError) => logger.warn('[provider] AUDIT_DECISION_RECORDED audit failed', { message: auditError.message }));

            return res.json({
                success: true,
                data: updated,
                message: `Audit decision ${decision} recorded`,
            });
        } catch (error) {
            logger.error('[provider] auditor decision failed:', error);
            // F-WALK-01: a PASS whose cert auto-generation failed for a coded, correctable
            // reason (no onsite audit recorded, short evidence, a plant/location the
            // certificate must name) used to flatten to a blanket 500 — the auditor read a
            // server error where they should have read what to fix. Surface the reason.
            const mapped = auditDecisionErrorResponse(error);
            if (mapped) {
                return res.status(mapped.status).json(mapped.body);
            }
            return res.status(500).json({
                success: false,
                error: 'Failed to record audit decision',
            });
        }
    },
];

module.exports = {
    auditorAuditDecisions,
};
