const {
    authenticateProvider,
    requireRole,
    logger,
    adminRoles,
    getApplicantName,
} = require('./shared');
// Batch 10 — Prisma bypass cleanup. The admin dashboard previously issued
// 8 direct prisma calls inline; they all now go through admin-dashboard-service
// which keeps the tenant filter (`organizationId`) at the service boundary.
const adminDashboardService = require('../../../../services/admin-dashboard-service');
const { buildAuditorWorkload } = require('../../../../services/admin/auditor-workload');
const { startOfLocalDay } = require('../../../../utils/working-days');

/**
 * Admin Master Dashboard
 * Aggregate endpoint returning KPIs, queue counts, auditor workload, and recent activity.
 */
const adminMasterDashboard = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const now = new Date();
            const todayStart = startOfLocalDay(now); // 00:00 today in Bangkok

            // PR-1.2: scope every count by req.user.organizationId. Before
            // this commit, an admin in tenant A saw KPIs aggregated across
            // every tenant — once tenant #2 onboards, that's a cross-org
            // leak. Reuse the same legacy-fallback behavior as the health
            // dashboard: if the JWT has no orgId claim (pre-commit-e045959
            // session), the queries degrade to the previous unscoped form.
            const orgId = req.user?.organizationId
                || req.tenantContext?.organizationId
                || null;

            // ── 1. Application Status Counts ──
            // adminDashboardService.getApplicationStatusCounts — replaces
            // prisma.application.groupBy({ by: ['status'], ... }).
            const statusCounts = await adminDashboardService.getApplicationStatusCounts(orgId);
            const statusMap = {};
            for (const row of statusCounts) {
                statusMap[row.status] = row._count.id;
            }

            const total = Object.values(statusMap).reduce((acc, n) => acc + n, 0);
            const certified = statusMap.CERTIFIED || 0;
            const inReview = (statusMap.ASSIGNED_FOR_REVIEW || 0) + (statusMap.REVISION_REQUESTED || 0);
            const auditPhase = (statusMap.AUDIT_FEE_PAID || 0) + (statusMap.AUDIT_CONFIRMED || 0) +
                (statusMap.CAR_PENDING || 0) + (statusMap.CAR_REVIEWING || 0) + (statusMap.AUDIT_PASSED || 0);
            const unassigned = (statusMap.DOC_FEE_PAID || 0) + (statusMap.SUBMITTED || 0);
            const pendingPayment =
                (statusMap.PENDING_DOC_FEE || 0) + (statusMap.PENDING_AUDIT_FEE || 0);

            // ── 2. Today's Activity ──
            // adminDashboardService.countApplicationsCreatedSince — replaces
            // prisma.application.count({ where: { createdAt: { gte: todayStart } } }).
            const newToday = await adminDashboardService.countApplicationsCreatedSince(orgId, todayStart);

            // ── 3. SLA Breach Count ──
            let slaBreach = 0;
            try {
                // adminDashboardService.countPendingRevisionDeadlinesPastDue —
                // replaces prisma.revisionDeadline.count.
                slaBreach = await adminDashboardService.countPendingRevisionDeadlinesPastDue(orgId, now);
            } catch {
                // Table may not exist yet — non-fatal
            }

            // ── 4. Revenue Summary (last 30 days) ──
            let revenueTotal = 0;
            let revenueTodayTotal = 0;
            try {
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                // adminDashboardService.sumCompletedPaymentsSince — replaces
                // prisma.payment.aggregate (x2).
                const revenueAgg = await adminDashboardService.sumCompletedPaymentsSince(orgId, thirtyDaysAgo);
                revenueTotal = revenueAgg._sum.amount || 0;

                const revenueTodayAgg = await adminDashboardService.sumCompletedPaymentsSince(orgId, todayStart);
                revenueTodayTotal = revenueTodayAgg._sum.amount || 0;
            } catch {
                // Payment table may differ — non-fatal
            }

            // ── 5. Auditor Workload ──
            // One query for all auditors. This loop used to await
            // countAuditorActiveAssignments per user — N round trips, each a
            // count over a JSON-path predicate no index can serve — while
            // countAuditorActiveAssignmentsBulk sat exported in the same
            // service, written for this exact call site ("N+1 -> 1 query for N
            // auditors") with nothing calling it.
            let auditors = [];
            try {
                const providerUsers = await adminDashboardService.listAuditorUsers();
                const counts = await adminDashboardService.countAuditorActiveAssignmentsBulk(
                    orgId,
                    providerUsers.map((user) => user.id),
                );
                auditors = buildAuditorWorkload(providerUsers, counts);
            } catch {
                // Non-fatal
            }

            // ── 6. Recent Activity Timeline ──
            // adminDashboardService.listRecentApplications — replaces
            // prisma.application.findMany({ orderBy: { updatedAt: 'desc' } }).
            const recentApps = await adminDashboardService.listRecentApplications(orgId, 12);
            const timeline = recentApps.map((app) => ({
                id: app.id,
                applicationNumber: app.applicationNumber || `APP-${(app.id || '').slice(-6).toUpperCase()}`,
                status: app.status,
                applicantName: getApplicantName(app.applicant),
                updatedAt: app.updatedAt?.toISOString() || null,
            }));

            return res.json({
                success: true,
                data: {
                    kpi: {
                        total,
                        certified,
                        inReview,
                        auditPhase,
                        unassigned,
                        pendingPayment,
                        newToday,
                        slaBreach,
                    },
                    revenue: {
                        last30Days: revenueTotal,
                        today: revenueTodayTotal,
                    },
                    auditors,
                    timeline,
                    statusBreakdown: statusMap,
                },
            });
        } catch (error) {
            logger.error('[admin] master dashboard error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to load admin dashboard',
            });
        }
    },
];

module.exports = { adminMasterDashboard };
