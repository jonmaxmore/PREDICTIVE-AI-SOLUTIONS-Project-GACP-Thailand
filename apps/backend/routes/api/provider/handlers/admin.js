const {
    prisma,
    authenticateProvider,
    requireRole,
    logger,
    adminRoles,
    resolveUserIdFromHealthId,
    obj,
    arr,
} = require('./shared');
const { writeApplicationStatus } = require('../../../../services/application-status-writer');
// FU-1 (full-system audit H-class follow-up, 2026-07-07): the status-override
// escape hatch must land in the immutable AuditLog hash chain, atomic with the
// status flip — same treatment as the auditor path (Blocker H) and the
// force-status sibling in routes/api/admin/applications.js.
const { statusTransitionAuditHook, auditLogger, AuditCategory, AuditSeverity } = require('../../../../middleware/audit-logger');
const { getRequestIp } = require('../../../../utils/client-ip');
const { WORKFLOW_STATES, normalizeWorkflowStateInput } = require('../../../../services/workflow-transition-service');
const { createNotification } = require('../../../../services/notification-service');
// Batch 10 — Prisma bypass cleanup. Direct prisma.revisionDeadline /
// prisma.application reads + the workflow-history append now go through
// admin-application-service. `prisma` is kept ONLY as the transaction handle
// passed to writeApplicationStatus (canonical writer convention).
const adminApplicationService = require('../../../../services/admin-application-service');
const { recordAssignment } = require('../../../../services/assignment-ledger-service');
const providerUserService = require('../../../../services/provider-user-service');
const { normalizeRole, CANONICAL_ROLES } = require('../../../../shared/canonical-rbac');
const { getZonedParts } = require('../../../../utils/working-days');
const { assertReviewerIsNotInspector, answerSeparation } = require('../../../../shared/reviewer-inspector-separation');

// Roles a target user must hold to receive a document-review assignment
// (mirrors scheduler-assign-reviewer-handler / scheduler-reviewer-reassign-handler).
const BATCH_ASSIGN_ELIGIBLE_ROLES = [
    CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
];

const adminRevisionReminderRuns = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const now = new Date();
            // adminApplicationService.listPendingRevisionDeadlines — replaces
            // prisma.revisionDeadline.findMany({ status: 'PENDING' ... }).
            const pendingDeadlines = await adminApplicationService.listPendingRevisionDeadlines(now);

            let sentD2 = 0;
            let sentD1 = 0;

            for (const deadline of pendingDeadlines) {
                const application = deadline.application;
                const healthUserId = await resolveUserIdFromHealthId(application?.healthId);
                if (!healthUserId) {
                    continue;
                }

                const diffMs = new Date(deadline.revisionDue).getTime() - now.getTime();
                const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                if (![1, 2].includes(daysRemaining)) {
                    continue;
                }

                await createNotification({
                    userId: healthUserId,
                    type: daysRemaining === 1 ? 'WARNING' : 'INFO',
                    title: daysRemaining === 1 ? 'Revision deadline tomorrow' : 'Revision deadline in 2 days',
                    message: `Application ${application.applicationNumber} revision is due in ${daysRemaining} day(s).`,
                    data: {
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        action: daysRemaining === 1 ? 'REVISION_REMINDER_D1' : 'REVISION_REMINDER_D2',
                        revisionDueAt: new Date(deadline.revisionDue).toISOString(),
                    },
                });

                if (daysRemaining === 1) {
                    sentD1 += 1;
                } else {
                    sentD2 += 1;
                }
            }

            return res.json({
                success: true,
                data: {
                    checked: pendingDeadlines.length,
                    sentD2,
                    sentD1,
                },
                message: 'Revision reminder sweep completed',
            });
        } catch (error) {
            logger.error('[provider] revision reminder run failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to run revision reminders',
            });
        }
    },
];

const adminBatchActions = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const ids = Array.isArray(req.body?.applicationIds) ? [...new Set(req.body.applicationIds)] : [];
            const action = String(req.body?.action || '').toUpperCase();
            const assignTo = req.body?.assignTo || req.body?.providerId || null;
            const reason = req.body?.reason || null;
            if (ids.length === 0) {
                return res.status(400).json({ success: false, error: 'No applications specified' });
            }
            if (!['ASSIGN', 'REQUEST_DOCUMENTS'].includes(action)) {
                return res.status(400).json({ success: false, error: 'Invalid action' });
            }
            if (action === 'ASSIGN' && !assignTo) {
                return res.status(400).json({ success: false, error: 'assignTo is required for ASSIGN' });
            }

            // M2 fix: validate assignTo resolves to an ACTIVE, eligible reviewer in
            // the caller's tenant BEFORE writing anything. Without this, an admin typo
            // wrote a bogus reviewerId into formData + transitioned the app to
            // ASSIGNED_FOR_REVIEW, while the best-effort ledger FK write silently failed
            // (no row) — leaving a "phantom reviewer" assignment that still reported
            // success. Mirrors the scheduler-reassign handlers' target-user check.
            if (action === 'ASSIGN') {
                const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
                const reviewer = await providerUserService.findReassignmentTargetUser({ id: assignTo, organizationId: orgId });
                if (
                    !reviewer
                    || reviewer.isDeleted
                    || String(reviewer.status).toUpperCase() !== 'ACTIVE'
                    || !reviewer.providerId
                ) {
                    return res.status(400).json({ success: false, error: 'assignTo is not an active provider user' });
                }
                const reviewerRole = normalizeRole(reviewer.role);
                if (!reviewerRole || !BATCH_ASSIGN_ELIGIBLE_ROLES.includes(reviewerRole)) {
                    return res.status(400).json({ success: false, error: 'assignTo is not eligible for reviewer assignment' });
                }
            }

            // adminApplicationService.findApplicationsByIds — replaces
            // prisma.application.findMany({ where: { id: { in: ids }, isDeleted: false } }).
            const apps = await adminApplicationService.findApplicationsByIds(ids);
            const statusMap = {
                ASSIGN: 'ASSIGNED_FOR_REVIEW',
                REQUEST_DOCUMENTS: 'REVISION_REQUESTED',
            };
            // Separation of duties (operator ruling 2026-10-05): this door writes the reviewer into
            // formData only, so the rule is enforced here, for the whole batch, before any write.
            if (action === 'ASSIGN') {
                try {
                    for (const application of apps) {
                        assertReviewerIsNotInspector({ reviewerId: assignTo, auditorId: application.auditorId });
                    }
                } catch (sodError) {
                    if (answerSeparation(res, sodError)) { return undefined; }
                    throw sodError;
                }
            }
            const timestamp = new Date().toISOString();
            // NOTE: each iteration runs in its OWN prisma.$transaction (below) rather
            // than one big tx spanning the whole batch. Per-write isolation keeps the
            // onAudit hook atomic with its own status write (the writer fires the hook
            // inside the write) while allowing partial success — one bad row aborts only
            // its own tx, not the rows already committed. Admin batches are low-volume so
            // the per-iteration tx overhead is immaterial. (See the force-override sibling
            // for the same single-write tx+onAudit shape.)
            const updates = [];
            for (const application of apps) {
                const formData = obj(application.formData);
                const workflowHistory = arr(application.workflowHistory);
                const formDataPatch = action === 'ASSIGN'
                    ? {
                        PROVIDERAssignment: {
                            ...obj(formData.PROVIDERAssignment),
                            reviewerId: assignTo,
                            assignedBy: req.user.id,
                            assignedAt: timestamp,
                        },
                    }
                    : {};
                // provider-UAT-round2 2026-07-09 (MED): the batch write emitted NO
                // immutable AuditLog (attribution lived only in the mutable
                // workflowHistory). Wrap each write in a tx and pass the canonical
                // onAudit hook so the transition lands in the hash-chained audit log,
                // atomic with the status write — mirroring the force-override sibling.
                await prisma.$transaction(async (tx) => {
                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: application.id,
                        fromStatus: application.status,
                        toStatus: statusMap[action],
                        actorId: req.user.id,
                        actorRole: req.user.canonicalRole || req.user.role || 'ADMIN',
                        reason: `BATCH_${action}`,
                        onAudit: statusTransitionAuditHook({
                            tx,
                            metadata: { batchAction: `BATCH_${action}`, reason, decidedBy: req.user.id, reviewerId: assignTo || undefined },
                        }),
                        additionalData: {
                            updatedBy: req.user.id,
                            formData: { ...formData, ...formDataPatch },
                            workflowHistory: [
                                ...workflowHistory,
                                {
                                    timestamp,
                                    action: `BATCH_${action}`,
                                    reason,
                                    reviewerId: assignTo,
                                    actorId: req.user.id,
                                },
                            ],
                        },
                    });
                });

                // Work-distribution ledger (best-effort; never throws → never
                // breaks the batch). Only ASSIGN is an assignment event; the
                // admin bulk-actions endpoint is the canonical ADMIN_BATCH
                // channel. `apps` are full rows so organizationId is present.
                // NOTE (pre-existing, out of scope here): this batch path writes
                // the reviewer to formData.PROVIDERAssignment only — not the
                // reviewerId column — and does not validate `assignTo` is an
                // active reviewer. If assignTo is not a real User id the ledger
                // FK write fails and is swallowed (row skipped, batch unaffected).
                if (action === 'ASSIGN') {
                    await recordAssignment({
                        prisma,
                        entityType: 'APPLICATION',
                        entityId: application.id,
                        action: 'ASSIGN',
                        assigneeUserId: assignTo,
                        assignedByUserId: req.user.id,
                        role: 'document_reviewer',
                        source: 'ADMIN_BATCH',
                        reason: reason || `BATCH_${action}`,
                        organizationId: application.organizationId || req.user.organizationId,
                    });
                }

                updates.push({ id: application.id });
            }

            return res.json({
                success: true,
                message: `${updates.length} applications updated`,
                data: { affected: updates.length },
            });
        } catch (error) {
            logger.error('[provider] admin batch action failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Batch action failed',
            });
        }
    },
];

/**
 * Admin Deadline Extension
 * Extends revision deadline by N business days (default 5) with reason logging.
 */
const adminDeadlineExtension = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const { applicationId, extensionDays, reason } = req.body || {};
            if (!applicationId) {
                return res.status(400).json({ success: false, error: 'applicationId is required' });
            }
            if (!reason || String(reason).trim().length < 5) {
                return res.status(400).json({ success: false, error: 'Reason is required (min 5 chars)' });
            }

            const days = Number(extensionDays) || 5;
            const now = new Date();

            // Find existing deadline
            let deadline = null;
            try {
                // adminApplicationService.findLatestPendingRevisionDeadline —
                // replaces prisma.revisionDeadline.findFirst.
                deadline = await adminApplicationService.findLatestPendingRevisionDeadline(applicationId);
            } catch {
                // Table may not exist
            }

            const currentDue = deadline?.revisionDue || now;
            const newDue = new Date(currentDue);
            // Add business days (simple: skip weekends)
            let added = 0;
            // Weekends are Bangkok weekends, not the process clock's.
            while (added < days) {
                newDue.setTime(newDue.getTime() + 24 * 60 * 60 * 1000);
                const { weekday } = getZonedParts(newDue);
                if (weekday !== 'Sat' && weekday !== 'Sun') { added++; }
            }

            // Update or create deadline
            if (deadline) {
                // adminApplicationService.updateRevisionDeadlineDue — replaces
                // prisma.revisionDeadline.update.
                await adminApplicationService.updateRevisionDeadlineDue(deadline.id, {
                    revisionDue: newDue,
                    updatedAt: now,
                });
            }

            // Log the extension in application workflow history
            // adminApplicationService.findApplicationWorkflowSlice — replaces
            // prisma.application.findUnique with the workflow-history select.
            const application = await adminApplicationService.findApplicationWorkflowSlice(applicationId);

            if (application) {
                const history = Array.isArray(application.workflowHistory)
                    ? application.workflowHistory
                    : [];
                // adminApplicationService.appendWorkflowHistoryOnly — replaces
                // prisma.application.update. The status itself is NOT changing
                // here, so a direct field update (without writeApplicationStatus)
                // is the correct operation; the service confines the write to
                // updatedBy + workflowHistory so no other columns drift.
                await adminApplicationService.appendWorkflowHistoryOnly(applicationId, {
                    updatedBy: req.user.id,
                    workflowHistory: [
                        ...history,
                        {
                            timestamp: now.toISOString(),
                            action: 'ADMIN_DEADLINE_EXTENSION',
                            reason: String(reason).trim(),
                            extensionDays: days,
                            newDeadline: newDue.toISOString(),
                            actorId: req.user.id,
                            actorName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
                        },
                    ],
                });
            }

            // provider-UAT-round2 2026-07-09 (LOW): the extension only landed in the
            // MUTABLE workflowHistory JSON — no immutable AuditLog. An admin moving a
            // regulatory deadline is exactly the kind of privileged mutation that must
            // be forensically attributable, so emit a best-effort audit row. The write
            // above does not change application status (appendWorkflowHistoryOnly), so
            // the non-transactional auditLogger.log is correct here (not the tx hook).
            try {
                await auditLogger.log({
                    category: AuditCategory.APPLICATION,
                    action: 'ADMIN_DEADLINE_EXTENSION',
                    severity: AuditSeverity.WARNING,
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role || 'ADMIN',
                    actorType: 'ADMIN',
                    resourceType: 'APPLICATION',
                    resourceId: applicationId,
                    ipAddress: getRequestIp(req),
                    userAgent: req.get('user-agent'),
                    metadata: {
                        extensionDays: days,
                        previousDue: currentDue.toISOString(),
                        newDue: newDue.toISOString(),
                        reason: String(reason).trim(),
                    },
                });
            } catch (_e) { /* best-effort audit — never block the extension */ }

            logger.info({ applicationId, extensionDays: days, newDue, actorId: req.user.id }, '[admin] deadline extended');

            return res.json({
                success: true,
                message: `Deadline extended by ${days} business days`,
                data: {
                    applicationId,
                    previousDue: currentDue.toISOString(),
                    newDue: newDue.toISOString(),
                    extensionDays: days,
                },
            });
        } catch (error) {
            logger.error('[admin] deadline extension failed:', error);
            return res.status(500).json({ success: false, error: 'Failed to extend deadline' });
        }
    },
];

/**
 * Admin Status Override
 * Force-transition application status (admin-only, with full audit trail).
 */
const adminStatusOverride = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const { applicationId, newStatus, reason } = req.body || {};
            if (!applicationId || !newStatus) {
                return res.status(400).json({ success: false, error: 'applicationId and newStatus are required' });
            }
            if (!reason || String(reason).trim().length < 5) {
                return res.status(400).json({ success: false, error: 'Reason is required (min 5 chars)' });
            }

            // Use the canonical state list from workflow-transition-service
            // instead of a hand-maintained allow-list. The previous hardcoded
            // list (16 entries) was missing 6 real states from the 21-state
            // enum:
            //   - DRAFT (admin needs to revert stuck apps so the user can
            //     re-submit)
            //   - SUBMITTED (initial active state after wizard submit)
            //   - the two slip-review stages that existed then (both retired
            //     2026-09-11 with the slip flow itself)
            //   - REJECTED (terminal — admin emergency rejection)
            //   - EXPIRED (terminal — already auto-set by revision-deadline
            //     cron, but admin couldn't manually flip)
            // The list also included the legacy 'REGISTERED' which isn't in
            // the canonical enum (replaced by DRAFT/SUBMITTED). Fixing both:
            // any state in WORKFLOW_STATES is fair game for an admin
            // override, and ANY value outside it is rejected with the
            // canonical state machine's set as guidance.
            if (!WORKFLOW_STATES.includes(newStatus)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status: ${newStatus}`,
                    validStatuses: [...WORKFLOW_STATES],
                });
            }

            // adminApplicationService.findApplicationStatusOverrideSlice —
            // replaces prisma.application.findUnique for the status-override slice.
            const application = await adminApplicationService.findApplicationStatusOverrideSlice(applicationId);
            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            const previousStatus = application.status;
            const history = Array.isArray(application.workflowHistory) ? application.workflowHistory : [];
            const now = new Date().toISOString();

            // FU-1: run the override in ONE transaction with an immutable
            // AuditLog row (previously: root prisma, ZERO AuditLog emission —
            // attribution lived only in logger.warn + mutable workflowHistory).
            await prisma.$transaction(async (tx) => {
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId,
                    fromStatus: previousStatus,
                    toStatus: newStatus,
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role || 'ADMIN',
                    reason: 'ADMIN_STATUS_OVERRIDE',
                    // Force-transition: admin-only override path bypasses normal SLA guard.
                    assertTransition: false,
                    // Do NOT auto-issue a cert when an admin force-sets AUDIT_PASSED here —
                    // cert issuance is the single-auditor's act (SoD); a back-door mint via this
                    // legacy override contradicts AUDIT-001. Matches the force-status + PATCH
                    // /admin/applications/:id/status siblings. (multi-role system test 2026-06-24)
                    autoIssueCertificate: false,
                    // Immutable hash-chain record, atomic with the status write.
                    onAudit: statusTransitionAuditHook({
                        tx,
                        metadata: {
                            override: 'ADMIN_STATUS_OVERRIDE',
                            reason: String(reason).trim(),
                            decidedBy: req.user.id,
                        },
                    }),
                    additionalData: {
                        updatedBy: req.user.id,
                        workflowHistory: [
                            ...history,
                            {
                                timestamp: now,
                                action: 'ADMIN_STATUS_OVERRIDE',
                                previousStatus,
                                newStatus,
                                reason: String(reason).trim(),
                                actorId: req.user.id,
                                actorName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
                            },
                        ],
                    },
                });

                // R2 M3b (evidence/R2-special-reopen/decisions-final.md,
                // §TERMINAL_DECISION letter): this legacy override is the third path
                // that can write the terminal REJECTED status, and it used to send
                // the applicant NOTHING. A terminal rejection is an administrative
                // order however it is issued, so it mints its letter in THIS
                // transaction — an order that cannot be served is not recorded at
                // all (D-8). `reason` is already mandatory above (min 5 chars) and
                // becomes the letter's เหตุผลประกอบ. The raw status column may still
                // carry a legacy alias, so the decided-in stage is normalised
                // through the canonical vocabulary first.
                if (newStatus === 'REJECTED') {
                    const { mintTerminalDecisionLetter } = require('../../../../services/decision-letter-service');
                    await mintTerminalDecisionLetter({
                        tx,
                        healthId: application.healthId,
                        applicationId,
                        applicationNumber: application.applicationNumber,
                        stage: normalizeWorkflowStateInput(previousStatus) || previousStatus,
                        reason: String(reason).trim(),
                    });
                }
            });

            logger.warn({ applicationId, previousStatus, newStatus, actorId: req.user.id, reason }, '[admin] status override');

            return res.json({
                success: true,
                message: `Status changed from ${previousStatus} to ${newStatus}`,
                data: { applicationId, previousStatus, newStatus },
            });
        } catch (error) {
            logger.error('[admin] status override failed:', error);
            return res.status(500).json({ success: false, error: 'Failed to override status' });
        }
    },
];

module.exports = {
    adminRevisionReminderRuns,
    adminBatchActions,
    adminDeadlineExtension,
    adminStatusOverride,
};
