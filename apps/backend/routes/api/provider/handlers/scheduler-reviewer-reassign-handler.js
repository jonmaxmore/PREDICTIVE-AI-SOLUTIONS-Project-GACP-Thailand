/**
 * Scheduler/Admin: Reassign Document Reviewer
 *
 * The reviewer-side mirror of routes/api/audit/audits-reassign.js. Moves the
 * assigned document reviewer (Application.reviewerId) on an application whose
 * document review is in flight (ASSIGNED_FOR_REVIEW) to a different reviewer —
 * WITHOUT changing the workflow state (a columns + formData metadata update
 * only, exactly like the auditor reassign). SCHEDULER + ADMIN only.
 *
 * Why this exists: prior to this, only the AUDITOR could be reassigned. If the
 * assigned document reviewer was unavailable, a scheduler had no first-class
 * way to hand the work to someone else — closing that accountability gap is
 * Phase 1B-part-3 of the work-distribution ledger.
 */

const { assignedOfficerName } = require('../../../../shared/assigned-officer-name');
const {
    authenticateProvider,
    requireRole,
    prisma,
    logger,
    normalizeRole,
    CANONICAL_ROLES,
    getRequestIp,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    applicationService,
} = require('./scheduler-handler-deps');
const providerUserService = require('../../../../services/provider-user-service');
const { trackedUpdate } = require('../../../../services/tracked-writer');
const { createNotification } = require('../../../../services/notification-service');
const { recordAssignment } = require('../../../../services/assignment-ledger-service');
// A reviewer may not also inspect the same application (operator ruling 2026-10-05).
const { assertReviewerIsNotInspector, answerSeparation } = require('../../../../shared/reviewer-inspector-separation');

// Only scheduler and admin roles may reassign reviewers (mirror audits-reassign.js).
// NOTE: the unit test scheduler-reviewer-reassign-auth.test.js re-declares this
// same list — keep them in sync.
const REASSIGN_ROLES = [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.DISPATCHER];

// Reviewer reassignment is valid while the document review is in flight — i.e.
// the reviewerId is still the active binding. That covers BOTH ASSIGNED_FOR_REVIEW
// AND REVISION_REQUESTED: when a review goes to REVISION_REQUESTED the same
// reviewerId stays bound (the resubmit transition REVISION_REQUESTED→
// ASSIGNED_FOR_REVIEW does not re-assign), so if that reviewer becomes
// unavailable during the 5-working-day revision window the scheduler must be
// able to swap them (else the app can only expire → re-apply → re-pay Phase 1).
// Waiver-reopen (2026-07-08): EXPIRED included so a departed reviewer's
// expired application can be handed to a new inspector who can then open
// the reopen request (initiator dead-spot, decision-doc risk #8).
const REASSIGNABLE_STATES = new Set(['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED', 'EXPIRED']);

// Roles a target user must hold to receive a document-review assignment
// (mirror scheduler-assign-reviewer-handler eligibility).
const ELIGIBLE_REVIEWER_ROLES = [
    CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
];

/**
 * GET /api/provider/scheduler/reviewer-assignments/reassignable
 * Applications currently in ASSIGNED_FOR_REVIEW whose reviewer can be swapped.
 */
const schedulerReassignableReviewers = [
    authenticateProvider,
    // 2026-09-07 — this read had NO role guard, only authentication, while the POST
    // that acts on its output is limited to scheduler/admin (REASSIGN_ROLES, checked
    // inline below). So the list of applications whose reviewer can be swapped was
    // readable by every staff account, finance included. A listing and the action it
    // feeds have to be guarded by the same names, or the guard on the action is a
    // formality — the list IS the sensitive part.
    requireRole(REASSIGN_ROLES),
    async (req, res) => {
        try {
            const applications = await applicationService.listReassignableReviewers();

            const formatted = applications.map((app) => {
                const formData = typeof app.formData === 'object' && app.formData ? app.formData : {};
                return {
                    id: app.id,
                    applicationNumber: app.applicationNumber,
                    applicantName: app.applicant
                        ? `${app.applicant.firstName} ${app.applicant.lastName}`
                        : 'ไม่ระบุ',
                    plantType: formData.plantName || 'ไม่ระบุ',
                    status: app.status,
                    currentReviewerId: app.reviewerId,
                    currentReviewer: assignedOfficerName({
                        officerId: app.reviewerId,
                        officer: app.reviewer,
                        storedName: formData.reviewerName,
                    }),
                    updatedAt: app.updatedAt,
                };
            });

            return res.json({ success: true, data: { applications: formatted } });
        } catch (error) {
            logger.error('[ReassignableReviewers] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch applications' });
        }
    },
];

/**
 * POST /api/provider/scheduler/reviewer-assignments/:id/reassign
 * Body: { newReviewerId, reason }
 */
const schedulerReviewerReassign = [
    authenticateProvider,
    async (req, res) => {
        // Only scheduler/admin can reassign (mirror audits-reassign.js:69-76).
        const callerRole = normalizeRole(req.user?.role);
        if (!callerRole || !REASSIGN_ROLES.includes(callerRole)) {
            return res.status(403).json({
                success: false,
                error: 'Only schedulers and admins can reassign reviewers',
            });
        }
        try {
            const { id } = req.params;
            const { newReviewerId, reason } = req.body;

            if (!newReviewerId || !reason) {
                return res.status(400).json({
                    success: false,
                    error: 'newReviewerId and reason are required',
                });
            }

            // Tenant-scope BOTH lookups (IDOR gate — mirror audits-reassign.js:88-114).
            // Without the org filter a scheduler in tenant A could reassign a
            // reviewer onto tenant B's application, or assign tenant B's user.
            const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;
            const application = await applicationService.findAuditApplication({
                where: orgId ? { id, organizationId: orgId } : { id },
                include: {
                    applicant: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // State gate (non-negotiable): a reviewer can only be swapped while
            // the document review is in flight (reviewerId is the active binding) —
            // ASSIGNED_FOR_REVIEW or REVISION_REQUESTED. Outside these the reviewerId
            // is no longer the active assignment.
            if (!REASSIGNABLE_STATES.has(application.status)) {
                return res.status(409).json({
                    success: false,
                    error: `Application is in ${application.status}, expected one of: ${[...REASSIGNABLE_STATES].join(', ')}`,
                });
            }

            const newReviewer = await providerUserService.findReassignmentTargetUser({
                id: newReviewerId,
                organizationId: orgId,
            });

            if (
                !newReviewer
                || newReviewer.isDeleted
                || String(newReviewer.status).toUpperCase() !== 'ACTIVE'
                || !newReviewer.providerId
            ) {
                return res.status(404).json({ success: false, error: 'Reviewer not found' });
            }

            const reviewerCanonicalRole = normalizeRole(newReviewer.role);
            if (!reviewerCanonicalRole || !ELIGIBLE_REVIEWER_ROLES.includes(reviewerCanonicalRole)) {
                return res.status(400).json({
                    success: false,
                    error: 'Selected provider is not eligible for reviewer assignment',
                });
            }

            try {
                assertReviewerIsNotInspector({ reviewerId: newReviewerId, auditorId: application.auditorId });
            } catch (sodError) {
                if (answerSeparation(res, sodError)) { return undefined; }
                throw sodError;
            }

            const oldReviewerId = application.reviewerId;
            const currentFormData = typeof application.formData === 'object' && application.formData
                ? application.formData
                : {};

            // Route the reviewerId change through trackedUpdate so the field
            // change is recorded in the AuditLog via the canonical writer
            // (mirror audits-reassign.js:135-180). The formData metadata patch
            // piggybacks in the same atomic update without change tracking.
            await trackedUpdate({
                prisma,
                model: 'application',
                where: { id },
                data: {
                    reviewerId: newReviewerId,
                    formData: {
                        ...currentFormData,
                        reviewerName: `${newReviewer.firstName} ${newReviewer.lastName}`,
                        _reviewerReassignmentHistory: [
                            ...(Array.isArray(currentFormData._reviewerReassignmentHistory)
                                ? currentFormData._reviewerReassignmentHistory
                                : []),
                            {
                                from: oldReviewerId,
                                to: newReviewerId,
                                reason,
                                reassignedBy: req.user?.id,
                                reassignedAt: new Date().toISOString(),
                            },
                        ],
                    },
                },
                trackedFields: ['reviewerId'],
                beforeState: { reviewerId: oldReviewerId },
                actorId: req.user?.id || null,
                actorRole: req.user?.canonicalRole || req.user?.role || null,
                reason: `REVIEWER_REASSIGNED: ${reason || ''}`.trim(),
                onAudit: async ({ recordId, changes, actorId, actorRole, reason: auditReason }) => {
                    for (const c of changes) {
                        await auditLogger.log({
                            category: AuditCategory.APPLICATION,
                            severity: AuditSeverity.HIGH,
                            action: `application.${c.field}.changed`,
                            resourceType: ResourceType.APPLICATION,
                            resourceId: recordId,
                            actorId,
                            actorRole,
                            metadata: {
                                field: c.field,
                                before: c.before,
                                after: c.after,
                                reason: auditReason,
                            },
                        });
                    }
                },
            });

            // Notifications (best-effort). No REVIEWER_* NotifyType exists, so —
            // like scheduler-assign-reviewer-handler — emit generic 'INFO'
            // notifications with Thai copy to the new reviewer, the old reviewer
            // (if any), and the applicant.
            await Promise.all([
                createNotification({
                    userId: newReviewerId,
                    type: 'INFO',
                    title: 'ได้รับมอบหมายตรวจเอกสาร (มอบหมายใหม่)',
                    message: `คำขอ ${application.applicationNumber}: คุณได้รับมอบหมายให้ตรวจเอกสาร (มอบหมายใหม่)`,
                    priority: 2,
                    data: {
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        action: 'REVIEWER_REASSIGNED',
                    },
                }).catch((e) => logger.warn('[reviewer-reassign] new-reviewer notify failed:', e.message)),
                oldReviewerId
                    ? createNotification({
                        userId: oldReviewerId,
                        type: 'INFO',
                        title: 'การมอบหมายตรวจเอกสารถูกเปลี่ยน',
                        message: `คำขอ ${application.applicationNumber}: งานตรวจเอกสารถูกมอบหมายให้ผู้ตรวจท่านอื่น`,
                        data: {
                            applicationId: application.id,
                            applicationNumber: application.applicationNumber,
                            action: 'REVIEWER_REASSIGNED_AWAY',
                        },
                    }).catch((e) => logger.warn('[reviewer-reassign] old-reviewer notify failed:', e.message))
                    : Promise.resolve(),
                application.applicant?.id
                    ? createNotification({
                        userId: application.applicant.id,
                        type: 'INFO',
                        title: 'ผู้ตรวจเอกสารของคำขอถูกเปลี่ยน',
                        message: `คำขอ ${application.applicationNumber}: เปลี่ยนผู้ตรวจเอกสารแล้ว รอผลการพิจารณา`,
                        data: {
                            applicationId: application.id,
                            applicationNumber: application.applicationNumber,
                            action: 'REVIEWER_CHANGED',
                        },
                    }).catch((e) => logger.warn('[reviewer-reassign] applicant notify failed:', e.message))
                    : Promise.resolve(),
            ]);

            // Resource-level audit row (mirror scheduler-assign-reviewer-handler).
            try {
                auditLogger.log({
                    action: 'REVIEWER_REASSIGNED',
                    category: AuditCategory.APPLICATION,
                    severity: AuditSeverity.MEDIUM,
                    resourceType: ResourceType.APPLICATION,
                    resourceId: application.id,
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role,
                    ip: getRequestIp(req),
                    metadata: {
                        applicationNumber: application.applicationNumber,
                        fromReviewerId: oldReviewerId,
                        toReviewerId: newReviewerId,
                        reason,
                    },
                });
            } catch (_auditErr) {
                // non-fatal
            }

            // Work-distribution ledger (best-effort; never blocks the reassignment).
            // source = the channel (SCHEDULER reassign route); the actor (scheduler
            // vs admin) is captured in assignedByUserId, not in source.
            await recordAssignment({
                prisma,
                entityType: 'APPLICATION',
                entityId: application.id,
                action: 'REASSIGN',
                assigneeUserId: newReviewerId,
                assignedByUserId: req.user.id,
                role: 'document_reviewer',
                previousAssigneeUserId: oldReviewerId || null,
                source: 'SCHEDULER',
                reason,
                organizationId: application.organizationId || orgId,
            });

            logger.info(
                `[reviewer-reassign] ${application.applicationNumber} reviewer ${oldReviewerId || '∅'} → ${newReviewerId} by ${req.user.id}`,
            );

            return res.json({
                success: true,
                message: 'Reviewer reassigned successfully',
                data: {
                    applicationId: application.id,
                    newReviewer: {
                        id: newReviewer.id,
                        name: `${newReviewer.firstName} ${newReviewer.lastName}`,
                    },
                },
            });
        } catch (error) {
            logger.error('[reviewer-reassign] error:', error);
            return res.status(error.status || 500).json({
                success: false,
                error: 'Failed to reassign reviewer',
            });
        }
    },
];

module.exports = { schedulerReviewerReassign, schedulerReassignableReviewers };
