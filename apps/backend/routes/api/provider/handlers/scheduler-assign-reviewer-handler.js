/**
 * Scheduler: Assign Document Reviewer
 *
 * Transitions an application from DOC_FEE_PAID → ASSIGNED_FOR_REVIEW
 * by assigning a document reviewer.
 */

const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    prisma: _prisma,
    workflowTransitionService,
    getApplicantName,
    getRequestIp,
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
    normalizeRole,
} = require('./scheduler-handler-deps');
const { buildWorkflowEvent: _buildWorkflowEvent } = require('../../../../shared/workflow-event-builder');
const { safeObject, safeArray: _safeArray } = require('../../../../shared/safe-coerce');
const { createNotification } = require('../../../../services/notification-service');
// Batch 10 — Prisma bypass cleanup. The application + reviewer lookups and
// the final assignment write all go through service modules now. `prisma` is
// no longer used directly; the buildTransitionUpdate output is applied to the
// row via application-service.writeAssignmentColumns.
const applicationService = require('../../../../services/application-service');
const providerUserService = require('../../../../services/provider-user-service');
const { recordAssignment } = require('../../../../services/assignment-ledger-service');
const { CANONICAL_ROLES } = require('../../../../shared/canonical-rbac');
// A reviewer may not also inspect the same application (operator ruling 2026-10-05).
const { assertReviewerIsNotInspector, answerSeparation } = require('../../../../shared/reviewer-inspector-separation');

// บทบาทที่รับงานตรวจเอกสารได้ — ผู้ตรวจแปลงอยู่ในรายชื่อโดยตั้งใจ (คนคนเดียวกัน
// อาจอ่านเอกสารรอบแรกแล้วลงพื้นที่รอบสอง) · เขียนผ่านค่าคงที่ ไม่ใช่คำเป็นตัวอักษร
// เพราะการรีเนม 2026-09-10 เปลี่ยน "ค่า" ไม่ใช่แค่ชื่อคีย์ — คำที่ค้างจะเงียบ ไม่ error
// ผู้อนุมัติใบรับรองไม่อยู่ในรายชื่อ: เขาไม่รับงานประเมิน มีแต่หน้าที่ตัดสิน
const ELIGIBLE_REVIEWER_ROLES = [
    CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
];

/** ตัวเลือกในดรอปดาวน์ผู้ตรวจเอกสาร — ไม่รวม admin ซึ่งรับงานได้แต่ไม่ใช่ตัวเลือกปกติ */
const REVIEWER_PICKLIST_ROLES = [CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR];

const schedulerAssignReviewer = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_SCHEDULE),
    async (req, res) => {
        try {
            const { applicationId, reviewerId } = req.body;

            if (!applicationId || !reviewerId) {
                return res.status(400).json({
                    success: false,
                    error: 'applicationId and reviewerId are required',
                });
            }

            // 1. Find the application
            // applicationService.findFirstWithWhere — replaces
            // prisma.application.findFirst with the OR(id, applicationNumber)
            // predicate.
            const application = await applicationService.findFirstWithWhere({
                where: {
                    OR: [{ id: applicationId }, { applicationNumber: applicationId }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    healthId: true,
                    formData: true,
                    workflowHistory: true,
                    organizationId: true,
                    auditorId: true,
                    applicant: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // 1b. Tenant guard (audit 2.5): findFirstWithWhere(OR id/number) is NOT
            // org-scoped, so a scheduler in tenant A could assign a reviewer to
            // tenant B's application by id. Reject a cross-tenant row as not-found
            // (anti-enumeration). PLATFORM_ADMIN (the only cross-tenant role) is
            // exempt; fail-open when the actor carries no org (legacy/system).
            const actorOrgId = normalizeRole(req.user.canonicalRole || req.user.role) === CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM
                ? null
                : (req.user.organizationId || null);
            if (actorOrgId && application.organizationId && application.organizationId !== actorOrgId) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // 2. Verify application is in DOC_FEE_PAID state
            const currentState = workflowTransitionService.resolveStateFromApplication(application);
            if (currentState !== 'DOC_FEE_PAID') {
                return res.status(409).json({
                    success: false,
                    error: `Application is in ${currentState}, expected DOC_FEE_PAID`,
                });
            }

            // 3. Verify reviewer exists and has document_reviewer or auditor role
            // providerUserService.findActiveProviderReviewerById — replaces
            // prisma.user.findFirst with the ACTIVE+PROVIDER+id filter.
            const reviewer = await providerUserService.findActiveProviderReviewerById(reviewerId);

            if (!reviewer) {
                return res.status(400).json({ success: false, error: 'Reviewer not found or inactive' });
            }

            const reviewerCanonicalRole = normalizeRole(reviewer.role);
            if (!reviewerCanonicalRole || !ELIGIBLE_REVIEWER_ROLES.includes(reviewerCanonicalRole)) {
                return res.status(400).json({
                    success: false,
                    error: `User ${reviewer.id} has role ${reviewer.role} — not a valid document reviewer`,
                });
            }

            // 3b. Separation of duties: whoever is already this application's field inspector
            //     cannot also read its papers. (The inspector side is refused at inspector
            //     assignment when the reviewer comes first — whichever is second is refused.)
            try {
                assertReviewerIsNotInspector({ reviewerId: reviewer.id, auditorId: application.auditorId });
            } catch (sodError) {
                if (answerSeparation(res, sodError)) { return undefined; }
                throw sodError;
            }

            // 4. Build transition via canonical service
            const transition = workflowTransitionService.buildTransitionUpdate({
                application,
                toState: 'ASSIGNED_FOR_REVIEW',
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role,
                metadata: { reviewerId: reviewer.id, reviewerName: getApplicantName(reviewer) },
            });

            // 5. Add reviewer assignment to formData (legacy JSON path)
            //    AND to the canonical Application.reviewerId column (Wave A
            //    Phase 44 / drift unwind Phase C — populates the column the
            //    visibility filter checks; the JSON entry stays for the
            //    REV-11 ownership check in workflow-transitions-handler
            //    until that handler also migrates to the column).
            const formData = safeObject(application.formData);
            transition.updateData.formData = {
                ...transition.updateData.formData,
                PROVIDERAssignment: {
                    ...safeObject(formData.PROVIDERAssignment),
                    reviewerId: reviewer.id,
                    reviewerProviderId: reviewer.providerId,
                    reviewerName: getApplicantName(reviewer),
                    assignedAt: new Date().toISOString(),
                    assignedBy: req.user.id,
                },
            };
            transition.updateData.reviewerId = reviewer.id;

            // 6. Execute update
            // applicationService.writeAssignmentColumns — replaces
            // prisma.application.update with the buildTransitionUpdate payload.
            // The service is a thin wrapper that keeps the Prisma client out of
            // the route and preserves the existing { select } projection.
            const updated = await applicationService.writeAssignmentColumns(application.id, {
                data: transition.updateData,
                select: { id: true, applicationNumber: true, status: true },
            });

            // 7. Notify reviewer + applicant (parallel; both non-fatal).
            //    Applicant signal is small but matters for trust — they paid
            //    Phase 1 and the next thing they hear is silence until the
            //    reviewer either approves or asks for revisions. This row
            //    closes that gap.
            const applicantUserId = application.applicant?.id || null;
            await Promise.all([
                createNotification({
                    userId: reviewer.id,
                    type: 'INFO',
                    title: 'ได้รับมอบหมายตรวจเอกสาร',
                    message: `คำขอ ${application.applicationNumber}: ได้รับมอบหมายให้ตรวจเอกสาร (${getApplicantName(application.applicant)})`,
                    priority: 2,
                    data: {
                        applicationId: application.id,
                        applicationNumber: application.applicationNumber,
                        action: 'REVIEWER_ASSIGNED',
                    },
                }).catch((notifyErr) => {
                    logger.warn('[scheduler] assign-reviewer reviewer notification failed:', notifyErr.message);
                }),
                applicantUserId
                    ? createNotification({
                        userId: applicantUserId,
                        type: 'INFO',
                        title: 'คำขอของคุณเข้าสู่ขั้นตอนตรวจเอกสาร',
                        message: `คำขอเลขที่ ${application.applicationNumber} ได้รับมอบหมายผู้ตรวจเอกสารแล้ว รอผลการพิจารณา`,
                        data: {
                            applicationId: application.id,
                            applicationNumber: application.applicationNumber,
                            action: 'ASSIGNED_FOR_REVIEW',
                        },
                    }).catch((notifyErr) => {
                        logger.warn('[scheduler] assign-reviewer applicant notification failed:', notifyErr.message);
                    })
                    : Promise.resolve(),
            ]);

            // 8. Audit log
            try {
                auditLogger.log({
                    action: 'REVIEWER_ASSIGNED',
                    category: AuditCategory.APPLICATION,
                    severity: AuditSeverity.MEDIUM,
                    resourceType: ResourceType.APPLICATION,
                    resourceId: application.id,
                    actorId: req.user.id,
                    actorRole: req.user.canonicalRole || req.user.role,
                    ip: getRequestIp(req),
                    metadata: {
                        applicationNumber: application.applicationNumber,
                        reviewerId: reviewer.id,
                        reviewerName: getApplicantName(reviewer),
                        fromState: currentState,
                        toState: 'ASSIGNED_FOR_REVIEW',
                    },
                });
            } catch (_auditErr) {
                // non-fatal
            }

            // 9. Work-distribution ledger (best-effort; never blocks the assignment):
            //    scheduler pushed this document reviewer onto the application.
            await recordAssignment({
                prisma: _prisma,
                entityType: 'APPLICATION',
                entityId: application.id,
                action: 'ASSIGN',
                assigneeUserId: reviewer.id,
                assignedByUserId: req.user.id,
                role: 'document_reviewer',
                source: 'SCHEDULER',
                reason: `Reviewer assigned (${currentState} → ASSIGNED_FOR_REVIEW)`,
                organizationId: application.organizationId || req.user.organizationId,
            });

            logger.info(`[scheduler] Reviewer ${reviewer.id} assigned to ${application.applicationNumber} by ${req.user.id}`);

            return res.json({
                success: true,
                data: {
                    applicationId: updated.id,
                    applicationNumber: updated.applicationNumber,
                    status: updated.status,
                    reviewerId: reviewer.id,
                    reviewerName: getApplicantName(reviewer),
                },
            });
        } catch (error) {
            // C2-04 (audit 2026-06-10): buildTransitionUpdate guard rejections are
            // client/state conditions → 422 INVALID_TRANSITION, not 500. Also stop
            // leaking the raw error.message (`details`) to the client on genuine faults.
            const msg = error?.message || '';
            const isTransitionGuard = /cannot transition|Invalid transition|already in workflow state|Only admin can force|Unknown actor role|Invalid workflow state|requires a comment|REQUIRES_COMMENT/i.test(msg);
            logger.error('[scheduler] assign-reviewer error:', error);
            return res.status(error.status || (isTransitionGuard ? 422 : 500)).json({
                success: false,
                error: isTransitionGuard ? msg : 'Failed to assign reviewer',
                code: error.code || (isTransitionGuard ? 'INVALID_TRANSITION' : undefined),
            });
        }
    },
];

/**
 * GET /api/provider/scheduler/reviewers
 * Returns active document reviewers for assignment
 */
const schedulerReviewers = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_SCHEDULE),
    async (req, res) => {
        try {
            // F-REVIEWER-DROPDOWN-EMPTY (2026-08-18): a real-DB walk found live
            // rows still holding legacy role spellings (e.g. REVIEWER_AUDITOR) —
            // migration 20260801000000 did NOT collapse every row as this
            // comment used to claim. `reviewerRoles` stays canonical-only (the
            // role-filters-canonical-only.test.js contract pins that); the
            // legacy-casing defense now lives inside
            // listReviewerCandidates(), which reads the whole roster and
            // matches via normalizeRole() instead of an SQL `in` filter.
            const reviewerRoles = REVIEWER_PICKLIST_ROLES;
            // providerUserService.listReviewerCandidates — replaces
            // prisma.user.findMany for the dropdown.
            const reviewers = await providerUserService.listReviewerCandidates(reviewerRoles);

            return res.json({
                success: true,
                data: reviewers.map((r) => ({
                    id: r.id,
                    providerId: r.providerId,
                    role: r.role,
                    canonicalRole: normalizeRole(r.role),
                    fullName: getApplicantName(r),
                })),
            });
        } catch (error) {
            logger.error('[scheduler] reviewers list error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch reviewers' });
        }
    },
];

module.exports = { schedulerAssignReviewer, schedulerReviewers };
