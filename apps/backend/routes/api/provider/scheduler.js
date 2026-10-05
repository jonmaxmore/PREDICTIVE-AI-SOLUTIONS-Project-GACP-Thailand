const express = require('express');
const { providerRouteHandlers } = require('./route-registry');
const { authenticateProvider } = require('./handlers/shared');
const { addWorkingDays } = require('../../../utils/working-days');
const { PERMISSIONS, hasPermission, normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const logger = require('../../../shared/logger');
const { createNotification } = require('../../../services/notification-service');
// Batch 14 (2026-05-16): scheduler reads now go through the service layer.
// applicationService owns the application/workActivity queries; the deadline
// approaching lookup lives on adminApplicationService alongside the other
// revisionDeadline accessors from batch 10. providerUserService owns the
// auditor-workload roster lookup.
const applicationService = require('../../../services/application-service');
const adminApplicationService = require('../../../services/admin-application-service');
const providerUserService = require('../../../services/provider-user-service');

/** Middleware: require APPLICATION_SCHEDULE permission */
const requireSchedulePermission = (req, res, next) => {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!canonicalRole || !hasPermission(canonicalRole, PERMISSIONS.APPLICATION_SCHEDULE)) {
        return res.status(403).json({ success: false, error: 'Forbidden — requires scheduling permission' });
    }
    next();
};

const router = express.Router();

router.get('/auditors', ...providerRouteHandlers.schedulerAuditors);
router.get('/reviewers', ...providerRouteHandlers.schedulerReviewers);
router.post('/reviewer-assignments', ...providerRouteHandlers.schedulerAssignReviewer);
// Legacy alias kept to avoid breaking older clients while frontend moves to the canonical path.
router.post('/assign-reviewer', ...providerRouteHandlers.schedulerAssignReviewer);
// Reviewer reassignment — the reviewer mirror of /api/audits/reassign. GET lists
// ASSIGNED_FOR_REVIEW apps; POST swaps the reviewer on one (scheduler/admin only,
// state-gated + tenant-scoped inside the handler). Specific path is declared
// before any '/reviewer-assignments/:param' could shadow it.
router.get('/reviewer-assignments/reassignable', ...providerRouteHandlers.schedulerReassignableReviewers);
router.post('/reviewer-assignments/:id/reassign', ...providerRouteHandlers.schedulerReviewerReassign);
router.get('/dashboard', ...providerRouteHandlers.schedulerDashboard);
router.get('/audits/schedules', ...providerRouteHandlers.schedulerAuditSchedulesGet);
router.post('/audits/schedules', ...providerRouteHandlers.schedulerAuditSchedulesPost);

/**
 * GET /api/provider/scheduler/urgent-monitor
 * Returns applications stuck in key statuses for > thresholdHours (default 48)
 * plus revision deadlines approaching expiry
 */
router.get('/urgent-monitor', authenticateProvider, requireSchedulePermission, async (req, res) => {
    try {
        const thresholdHours = parseInt(req.query.hours || '48', 10);
        const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

        // 1. Applications stuck in waiting statuses for > threshold
        const stuckStatuses = [
            'DOC_FEE_PAID',
            'AUDIT_FEE_PAID',
            'SUBMITTED',
            'ASSIGNED_FOR_REVIEW',
            'REVISION_REQUESTED',
            'AUDIT_CONFIRMED',
            'AUDIT_PASSED',
        ];

        const stuckApplications = await applicationService.listStuckApplications({
            stuckStatuses,
            cutoff,
            take: 50,
        });

        const urgentItems = stuckApplications.map((app) => {
            const hoursStuck = Math.floor((Date.now() - new Date(app.updatedAt).getTime()) / (1000 * 60 * 60));
            return {
                id: app.id,
                applicationNumber: app.applicationNumber,
                applicantName: `${app.applicant?.firstName || ''} ${app.applicant?.lastName || ''}`.trim() || '-',
                status: app.status,
                updatedAt: app.updatedAt,
                hoursStuck,
                severity: hoursStuck > 96 ? 'CRITICAL' : hoursStuck > 48 ? 'WARNING' : 'INFO',
            };
        });

        // 2. Revision deadlines approaching expiry (within 2 working days)
        let approachingDeadlines = [];
        try {
            const nowDate = new Date();
            approachingDeadlines = await adminApplicationService.listApproachingRevisionDeadlines({
                now: nowDate,
                upperBound: addWorkingDays(nowDate, 3), // within 3 business days
                take: 20,
            });
        } catch {
            // RevisionDeadline table may not exist — non-fatal
        }

        const deadlineItems = approachingDeadlines.map((dl) => {
            const hoursLeft = Math.max(0, Math.floor((new Date(dl.revisionDue).getTime() - Date.now()) / (1000 * 60 * 60)));
            return {
                id: dl.application?.id || dl.id,
                applicationNumber: dl.application?.applicationNumber || '-',
                applicantName: `${dl.application?.applicant?.firstName || ''} ${dl.application?.applicant?.lastName || ''}`.trim() || '-',
                deadlineDue: dl.revisionDue,
                hoursLeft,
                severity: hoursLeft < 24 ? 'CRITICAL' : 'WARNING',
                type: 'REVISION_DEADLINE',
            };
        });

        return res.json({
            success: true,
            data: {
                stuckItems: urgentItems,
                deadlineItems,
                summary: {
                    totalStuck: urgentItems.length,
                    critical: urgentItems.filter((i) => i.severity === 'CRITICAL').length,
                    warning: urgentItems.filter((i) => i.severity === 'WARNING').length,
                    approachingDeadlines: deadlineItems.length,
                },
            },
        });
    } catch (error) {
        logger.error('[urgent-monitor] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load urgent monitor data' });
    }
});

/**
 * GET /api/provider/scheduler/auditor-workload
 * Returns workload overview per auditor: active assignments, completed audits, availability
 */
router.get('/auditor-workload', authenticateProvider, requireSchedulePermission, async (req, res) => {
    try {
        // 1. Find all auditor-role users. users.role is canonical (migration
        // 20260801000000): the legacy spellings this list carried
        // (REVIEWER_AUDITOR / AUDITOR) all collapsed into these two values.
        const auditorRoles = [CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR];
        const auditors = await providerUserService.listActiveAuditors(auditorRoles);

        // 2. For each auditor, count active assignments + completed in last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const workload = await Promise.all(
            auditors.map(async (auditor) => {
                const [activeAssignments, completedRecent] = await Promise.all([
                    applicationService.countAuditorActiveAuditAssignments(auditor.id),
                    applicationService.countAuditorCompletedAuditsSince(auditor.id, thirtyDaysAgo),
                ]);

                const capacity = Number(process.env.AUDITOR_MAX_CONCURRENT_AUDITS) || 5;
                const utilizationPct = Math.min(100, Math.round((activeAssignments / capacity) * 100));

                return {
                    id: auditor.id,
                    name: `${auditor.firstName || ''} ${auditor.lastName || ''}`.trim() || '-',
                    role: auditor.role,
                    activeAssignments,
                    completedLast30Days: completedRecent,
                    capacity,
                    utilizationPct,
                    availability: utilizationPct >= 100 ? 'FULL' : utilizationPct >= 60 ? 'BUSY' : 'AVAILABLE',
                };
            }),
        );

        // Sort by active load descending
        workload.sort((a, b) => b.activeAssignments - a.activeAssignments);

        return res.json({
            success: true,
            data: {
                auditors: workload,
                summary: {
                    totalAuditors: workload.length,
                    available: workload.filter((a) => a.availability === 'AVAILABLE').length,
                    busy: workload.filter((a) => a.availability === 'BUSY').length,
                    full: workload.filter((a) => a.availability === 'FULL').length,
                    totalActiveAssignments: workload.reduce((s, a) => s + a.activeAssignments, 0),
                },
            },
        });
    } catch (error) {
        logger.error('[auditor-workload] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load auditor workload' });
    }
});

/**
 * POST /api/provider/scheduler/applications/:id/send-reminder
 * Manually send a revision/deadline reminder to the farmer
 * Used by Coordinator when farmer hasn't responded
 */
router.post('/applications/:id/send-reminder', authenticateProvider, requireSchedulePermission, async (req, res) => {
    try {
        const { id } = req.params;
        const coordinatorId = req.user?.id;

        // 1. Find the application
        const application = await applicationService.findReminderTargetApplication(id);

        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        // 2. Only allow reminders for revision-related statuses
        const reminderStatuses = [
            'REVISION_REQUESTED',
            'CAR_PENDING',
            'CAR_REVIEWING',
            'PENDING_AUDIT_FEE',
            'DOC_FEE_PAID',
        ];
        if (!reminderStatuses.includes(application.status)) {
            return res.status(400).json({
                success: false,
                error: `Cannot send reminder for status: ${application.status}. Allowed: ${reminderStatuses.join(', ')}`,
            });
        }

        // 3. Resolve the farmer's user ID
        const farmerId = application.applicant?.id;
        if (!farmerId) {
            return res.status(400).json({
                success: false,
                error: 'No applicant linked to this application',
            });
        }

        // 4. Create in-app notification for the farmer
        const reminderMessages = {
            REVISION_REQUESTED: 'กรุณาแก้ไขเอกสารตามที่ระบุ ก่อนหมดเขตที่กำหนด',
            CAR_PENDING: 'กรุณาดำเนินการแก้ไขข้อบกพร่อง (CAR) ตามที่ผู้ตรวจระบุ',
            CAR_REVIEWING: 'เอกสารแก้ไขของท่านอยู่ระหว่างการตรวจสอบ กรุณารอผลการพิจารณา',
            PENDING_AUDIT_FEE: 'กรุณาชำระค่าธรรมเนียมการตรวจประเมิน (งวดที่ 2) เพื่อดำเนินการต่อ',
            DOC_FEE_PAID: 'เอกสารของท่านอยู่ระหว่างรอการตรวจสอบ',
        };

        await createNotification({
            userId: farmerId,
            type: 'WARNING',
            title: '📢 แจ้งเตือนจากเจ้าหน้าที่ประสานงาน',
            message: `คำขอ ${application.applicationNumber}: ${reminderMessages[application.status] || 'กรุณาดำเนินการตามขั้นตอนที่ค้างอยู่'}`,
            priority: 3,
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                status: application.status,
                sentBy: coordinatorId,
                reminderType: 'MANUAL_COORDINATOR',
            },
        });

        logger.info(`[scheduler] Manual reminder sent for ${application.applicationNumber} by coordinator ${coordinatorId}`);

        return res.json({
            success: true,
            message: 'Reminder sent successfully',
            data: {
                applicationId: application.id,
                applicationNumber: application.applicationNumber,
                sentTo: `${application.applicant?.firstName || ''} ${application.applicant?.lastName || ''}`.trim(),
                status: application.status,
            },
        });
    } catch (error) {
        logger.error('[scheduler] send-reminder error:', error);
        return res.status(500).json({ success: false, error: 'Failed to send reminder' });
    }
});

module.exports = router;
