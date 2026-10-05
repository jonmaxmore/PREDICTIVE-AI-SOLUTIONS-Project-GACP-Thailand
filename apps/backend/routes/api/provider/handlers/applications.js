const {
    prisma,
    authenticateProvider,
    requireRole,
    logger,
    PERMISSIONS,
    PROVIDERRoles,
    requireCanonicalPermission,
    toInt,
    obj,
    arr,
} = require('./shared');
const { writeApplicationStatus } = require('../../../../services/application-status-writer');
const { withVisibility } = require('../../../../shared/application-visibility');
// Batch 10 — Prisma bypass cleanup. Provider queue listing and the assign
// action route through application-service so the projection + visibility
// predicate are applied at the service boundary. `prisma` is still imported
// here as the canonical-writer transaction handle (writeApplicationStatus).
const applicationService = require('../../../../services/application-service');

const applicationsQueue = [
    authenticateProvider,
    requireRole(PROVIDERRoles),
    async (req, res) => {
        try {
            const status = String(req.query.status || 'all');
            const priority = String(req.query.priority || 'all').toUpperCase();
            const assignee = String(req.query.assignee || 'all');
            const page = toInt(req.query.page, 1, 1, 100000);
            const limit = toInt(req.query.limit, 20);

            const baseWhere = {
                isDeleted: false,
                status: status !== 'all'
                    ? status
                    : {
                        in: [
                            'DOC_FEE_PAID',
                            'ASSIGNED_FOR_REVIEW',
                            'REVISION_REQUESTED',
                            'DOC_APPROVED',
                            'AUDIT_FEE_PAID',
                            'AUDIT_CONFIRMED',
                            'CAR_PENDING',
                            'CAR_REVIEWING',
                            'AUDIT_PASSED',
                        ],
                    },
            };

            // Wave A Phase 30 — narrow auditors to their assigned
            // applications. Other roles fall through (helper returns null).
            const where = withVisibility(baseWhere, req.user);

            // applicationService.listProviderQueue — replaces
            // prisma.application.findMany for the queue.
            const apps = await applicationService.listProviderQueue({
                where,
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    healthId: true,
                    auditorId: true,
                    createdAt: true,
                    updatedAt: true,
                    formData: true,
                    applicant: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
                orderBy: { createdAt: 'asc' },
                take: 1000,
            });

            const now = Date.now();
            const mapped = apps.map((app) => {
                const daysWaiting = Math.max(0, Math.floor((now - new Date(app.createdAt).getTime()) / 86400000));
                const priorityLevel = daysWaiting > 14
                    ? 'CRITICAL'
                    : daysWaiting > 7
                        ? 'HIGH'
                        : daysWaiting > 3
                            ? 'MEDIUM'
                            : 'NORMAL';
                const reviewerId = obj(obj(app.formData).PROVIDERAssignment).reviewerId || null;
                return { ...app, reviewerId, daysWaiting, priorityLevel };
            }).filter((app) => {
                if (assignee === 'all') {
                    return true;
                }
                if (assignee === 'unassigned') {
                    return !app.reviewerId;
                }
                return app.reviewerId === assignee || app.auditorId === assignee;
            }).filter((app) => priority === 'ALL' || app.priorityLevel === priority);

            const total = mapped.length;
            const data = mapped.slice((page - 1) * limit, (page - 1) * limit + limit);
            // Wave A Phase 30 — scope dashboard counts to what the caller
            // can actually see, so an auditor's badge ("Pending: N") matches
            // the queue list. Admin / scheduler get tenant-wide counts as before.
            // applicationService.countProviderQueue — replaces the 3
            // prisma.application.count calls for the summary cards.
            const [pending, inReview, awaitingDocs] = await Promise.all([
                applicationService.countProviderQueue(
                    withVisibility(
                        { isDeleted: false, status: { in: ['DOC_FEE_PAID', 'AUDIT_FEE_PAID'] } },
                        req.user,
                    ),
                ),
                applicationService.countProviderQueue(
                    withVisibility(
                        { isDeleted: false, status: { in: ['ASSIGNED_FOR_REVIEW', 'DOC_APPROVED', 'AUDIT_CONFIRMED', 'CAR_REVIEWING'] } },
                        req.user,
                    ),
                ),
                applicationService.countProviderQueue(
                    withVisibility(
                        { isDeleted: false, status: { in: ['REVISION_REQUESTED', 'CAR_PENDING'] } },
                        req.user,
                    ),
                ),
            ]);

            return res.json({
                success: true,
                data,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
                summary: {
                    totalPending: pending,
                    totalInReview: inReview,
                    totalAwaitingDocs: awaitingDocs,
                    unassigned: mapped.filter((a) => !a.reviewerId).length,
                    criticalPriority: mapped.filter((a) => a.priorityLevel === 'CRITICAL').length,
                },
            });
        } catch (error) {
            logger.error('[provider] applications queue failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch application queue',
            });
        }
    },
];

const applicationsAssign = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_SCHEDULE),
    async (req, res) => {
        try {
            const reviewerId = req.body?.reviewerId || req.body?.providerId;
            if (!reviewerId) {
                return res.status(400).json({ success: false, error: 'reviewerId is required' });
            }

            // applicationService.findByIdOrApplicationNumber — replaces
            // prisma.application.findFirst with the OR(id, applicationNumber)
            // predicate.
            const app = await applicationService.findByIdOrApplicationNumber(req.params.id);
            if (!app) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            const timestamp = new Date().toISOString();
            const formData = obj(app.formData);
            const workflowHistory = arr(app.workflowHistory);
            if (app.status !== 'DOC_FEE_PAID') {
                return res.status(400).json({
                    success: false,
                    error: `Application must be in DOC_FEE_PAID before assignment (current: ${app.status})`,
                });
            }
            await writeApplicationStatus({
                prisma,
                applicationId: app.id,
                fromStatus: app.status,
                toStatus: 'ASSIGNED_FOR_REVIEW',
                actorId: req.user.id,
                actorRole: req.user.canonicalRole || req.user.role || null,
                reason: 'APPLICATION_ASSIGNED',
                additionalData: {
                    updatedBy: req.user.id,
                    // คอลัมน์ canonical — ประตูของคนจัดคิวเขียนไว้ที่
                    // scheduler-assign-reviewer-handler.js · ประตูนี้เคยเขียนผู้ตรวจลงใน
                    // formData อย่างเดียว แถวจึงเหลือ reviewerId = null และด่านแยกหน้าที่
                    // ของ PATCH /api/applications/:id/reject
                    // (application-workflow-handlers.js:99) ซึ่งอ่านคอลัมน์นี้ตัวเดียว
                    // ก็อ่านว่า "ยังไม่มอบหมาย = ใครก็ได้"
                    //
                    // วัดจริงบนระบบที่รันอยู่ 2026-09-09 (บน GACP Lite ซึ่งใช้โค้ดชุดเดียวกัน):
                    // มอบหมายผ่านประตูนี้ให้ผู้ตรวจ A แล้วผู้ตรวจ B ยิง reject ได้ HTTP 200
                    // ดันใบไป REVISION_REQUESTED พร้อมกำหนดส่งแก้ 5 วันทำการ บนคำขอที่เขา
                    // ไม่ได้รับมอบหมาย
                    reviewerId,
                    formData: {
                        ...formData,
                        // H1 fix: because additionalData carries a formData key, the
                        // status-writer's auto-sync of formData.workflowState is bypassed.
                        // Set it explicitly (mirrors audit-scheduling-service.assignAuditor)
                        // — else resolveStateFromApplication() reads the stale DOC_FEE_PAID
                        // and the reviewer's valid ASSIGNED_FOR_REVIEW→DOC_APPROVED 422s,
                        // dead-ending the workflow.
                        workflowState: 'ASSIGNED_FOR_REVIEW',
                        workflowStateUpdatedAt: timestamp,
                        PROVIDERAssignment: {
                            ...obj(formData.PROVIDERAssignment),
                            reviewerId,
                            assignedBy: req.user.id,
                            assignedAt: timestamp,
                        },
                    },
                    workflowHistory: [
                        ...workflowHistory,
                        {
                            timestamp,
                            action: 'APPLICATION_ASSIGNED',
                            reviewerId,
                            actorId: req.user.id,
                        },
                    ],
                },
            });
            // applicationService.getById — replaces prisma.application.findUnique
            // re-fetch after the canonical writer runs (writer doesn't expose
            // a select option).
            const updated = await applicationService.getById(app.id);

            return res.json({ success: true, data: updated });
        } catch (error) {
            logger.error('[provider] applications/:id/assign failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to assign application',
            });
        }
    },
];

module.exports = {
    applicationsQueue,
    applicationsAssign,
};
