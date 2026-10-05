const { startOfLocalDay } = require('../../../../utils/working-days');
const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    normalizeRole,
    toInt,
    dt,
    CANONICAL_ROLES,
    computePhaseSettlement,
    buildAuditorQueueItem,
    applicationService,
    invoiceService,
} = require('./auditor-handler-deps');

const auditorDashboard = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_AUDIT_RECORD),
    async (req, res) => {
        try {
            const page = toInt(req.query.page, 1, 1, 100000);
            const limit = toInt(req.query.limit, 20, 1, 200);
            const now = new Date();
            const todayStart = startOfLocalDay(now); // 00:00 today in Bangkok

            const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
            const requestedAuditorId = String(req.query.auditorId || '').trim();
            const effectiveAuditorId = (requestedAuditorId && canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)
                ? requestedAuditorId
                : req.user.id;

            const applications = await applicationService.listAuditorDashboardApplications({
                where: {
                    isDeleted: false,
                    auditorId: effectiveAuditorId,
                    status: {
                        in: [
                            'AUDIT_CONFIRMED',
                            'AUDIT_PASSED',
                            'CAR_PENDING',
                            'CAR_REVIEWING',
                            'APPROVED',
                        ],
                    },
                },
                take: 1000,
            });

            const appIds = applications.map((application) => application.id);
            const [auditors, invoices] = await Promise.all([
                applicationService.listAuditorsByIds([effectiveAuditorId]),
                invoiceService.listSettlementsByApplicationIds(appIds),
            ]);

            const auditorMap = new Map(auditors.map((auditor) => [auditor.id, auditor]));
            const paymentMap = new Map();
            for (const appId of appIds) {
                const phaseInvoices = invoices.filter((invoice) => invoice.applicationId === appId);
                const settlement = computePhaseSettlement(phaseInvoices, 'PHASE_2');
                paymentMap.set(appId, {
                    phase2Paid: settlement.phasePaid,
                    receiptIssued: settlement.phaseReceiptIssued,
                });
            }

            const queueItems = applications.map((application) => buildAuditorQueueItem(application, auditorMap, paymentMap));
            const todayUpcoming = queueItems
                .filter((item) => {
                    const when = dt(item.scheduledDate);
                    return when && when >= todayStart;
                })
                .sort((left, right) => new Date(left.scheduledDate).getTime() - new Date(right.scheduledDate).getTime());
            const inProgress = queueItems
                .filter((item) => ['AUDIT_CONFIRMED', 'CAR_REVIEWING'].includes(item.workflowState))
                .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
            const followUps = queueItems
                .filter((item) => item.isMinorFollowup)
                .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

            const calendarEvents = todayUpcoming.map((item) => ({
                applicationId: item.applicationId,
                applicationNumber: item.applicationNumber,
                applicantName: item.applicantName,
                scheduledDate: item.scheduledDate,
                inspectionMode: item.inspectionMode,
                meetingLink: item.meetingLink,
                mapLink: item.mapLink,
                location: item.location,
                workflowState: item.workflowState,
                canStartInspection: item.canStartInspection,
            }));

            const weekEdge = new Date(todayStart);
            weekEdge.setTime(weekEdge.getTime() + 7 * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read
            const auditedToday = queueItems.filter((item) => {
                if (!(['AUDIT_PASSED', 'APPROVED', 'CERTIFIED'].includes(item.workflowState) || item.status === 'AUDIT_PASSED')) {
                    return false;
                }
                const updatedAt = dt(item.updatedAt);
                return !!updatedAt && updatedAt >= todayStart;
            }).length;
            const scheduledThisWeek = todayUpcoming.filter((item) => {
                const when = dt(item.scheduledDate);
                return !!when && when <= weekEdge;
            }).length;

            // P1-H (Wave-3): surface overdue onsite inspections beyond the reviewer
            // dashboard. An onsite is "past due" when it was scheduled before now but
            // the application is still AUDIT_CONFIRMED (confirmed/scheduled, not yet
            // inspected → the auditor hasn't started/recorded a result). READ-only +
            // additive: does not change any existing count's meaning.
            const overdue = queueItems.filter((item) => {
                if (item.workflowState !== 'AUDIT_CONFIRMED') { return false; }
                const when = dt(item.scheduledDate);
                return !!when && when.getTime() < now.getTime();
            }).length;

            const paginate = (items) => ({
                total: items.length,
                items: items.slice((page - 1) * limit, (page - 1) * limit + limit),
            });

            return res.json({
                success: true,
                data: {
                    queues: {
                        todayUpcoming: paginate(todayUpcoming),
                        inProgress: paginate(inProgress),
                        followUps: paginate(followUps),
                    },
                    calendar: { events: calendarEvents },
                    kpi: {
                        auditedToday,
                        scheduledThisWeek,
                        pendingResults: inProgress.length,
                        minorFollowups: followUps.length,
                        majorTriggers: queueItems.filter((item) => item.isMajorRescheduleRequired).length,
                        // P1-H: past-due onsite inspections (scheduled < now, still AUDIT_CONFIRMED).
                        overdue,
                    },
                    pagination: { page, limit },
                },
            });
        } catch (error) {
            logger.error('[provider] auditor/dashboard failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch auditor dashboard',
            });
        }
    },
];

module.exports = {
    auditorDashboard,
};
