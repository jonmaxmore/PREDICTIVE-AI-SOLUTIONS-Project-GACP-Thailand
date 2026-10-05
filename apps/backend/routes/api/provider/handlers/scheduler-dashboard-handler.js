const { CANONICAL_ROLES } = require('../../../../shared/canonical-rbac');
const { getZonedParts } = require('../../../../utils/working-days');

const {
    prisma,
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    toInt,
    dt,
    buildSchedulerQueueItem,
    computePhaseSettlement,
    applicationService,
    invoiceService,
    workActivityService,
} = require('./scheduler-handler-deps');

const schedulerDashboard = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_SCHEDULE),
    async (req, res) => {
        try {
            const page = toInt(req.query.page, 1, 1, 100000);
            const limit = toInt(req.query.limit, 20, 1, 200);
            const startDate = dt(req.query.startDate);
            const endDate = dt(req.query.endDate);
            const now = new Date();

            const applications = await applicationService.listSchedulerDashboardApplications({
                where: {
                    isDeleted: false,
                    status: {
                        in: [
                            'SUBMITTED',
                            'PENDING_DOC_FEE',
                            'DOC_FEE_PAID',
                            'ASSIGNED_FOR_REVIEW',
                            'DOC_APPROVED',
                            'PENDING_AUDIT_FEE',
                            'AUDIT_FEE_PAID',
                            'AUDIT_CONFIRMED',
                            'AUDIT_PASSED',
                            'CAR_PENDING',
                            'CAR_REVIEWING',
                        ],
                    },
                },
                take: 1000,
            });

            const appIds = applications.map((application) => application.id);
            const auditorIds = [...new Set(applications.map((application) => application.auditorId).filter(Boolean))];
            const [auditors, invoices] = await Promise.all([
                applicationService.listAuditorsByIds(auditorIds),
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

            const queueItems = applications.map((application) => buildSchedulerQueueItem(application, auditorMap, paymentMap));

            // Queue 0: DOC_FEE_PAID — ready for reviewer assignment
            const readyForReview = queueItems
                .filter((item) => item.workflowState === 'DOC_FEE_PAID')
                .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

            // Queue 1: AUDIT_FEE_PAID + paid — ready for audit scheduling
            const readyToSchedule = queueItems
                .filter((item) =>
                    item.phase2Paid
                    && item.workflowState === 'AUDIT_FEE_PAID'
                    && !item.isRescheduleRequired)
                .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

            // Queue 2: AUDIT_CONFIRMED — scheduled upcoming
            const scheduledUpcoming = queueItems
                .filter((item) =>
                    !!item.scheduledDate
                    && item.workflowState === 'AUDIT_CONFIRMED')
                .sort((left, right) => new Date(left.scheduledDate).getTime() - new Date(right.scheduledDate).getTime());

            // Queue 3: reschedule required
            const rescheduleRequired = queueItems
                .filter((item) => item.isRescheduleRequired)
                .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

            // Pipeline overview — counts by stage for visibility
            const pipeline = {
                submitted: queueItems.filter((i) => i.workflowState === 'SUBMITTED').length,
                pendingDocFee: queueItems.filter((i) => i.workflowState === 'PENDING_DOC_FEE').length,
                docFeePaid: readyForReview.length,
                assignedForReview: queueItems.filter((i) => i.workflowState === 'ASSIGNED_FOR_REVIEW').length,
                docApproved: queueItems.filter((i) => i.workflowState === 'DOC_APPROVED').length,
                pendingAuditFee: queueItems.filter((i) => i.workflowState === 'PENDING_AUDIT_FEE').length,
                auditFeePaid: readyToSchedule.length,
                auditConfirmed: scheduledUpcoming.length,
            };

            const calendarEvents = scheduledUpcoming
                .filter((item) => {
                    const when = dt(item.scheduledDate);
                    if (!when) { return false; }
                    if (startDate && when < startDate) { return false; }
                    if (endDate && when > endDate) { return false; }
                    return true;
                })
                .map((item) => ({
                    applicationId: item.applicationId,
                    applicationNumber: item.applicationNumber,
                    applicantName: item.applicantName,
                    scheduledDate: item.scheduledDate,
                    inspectionMode: item.inspectionMode,
                    auditorId: item.auditorId,
                    auditorName: item.auditorName,
                    meetingLink: item.meetingLink,
                    mapLink: item.mapLink,
                    location: item.location,
                    status: item.status,
                    workflowState: item.workflowState,
                }));

            const weekEdge = new Date(now);
            weekEdge.setTime(weekEdge.getTime() + 7 * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read
            const scheduledToday = scheduledUpcoming.filter((item) => {
                const when = dt(item.scheduledDate);
                return when ? getZonedParts(when).isoDate === getZonedParts(now).isoDate : false; // same Bangkok day
            }).length;
            const scheduledThisWeek = scheduledUpcoming.filter((item) => {
                const when = dt(item.scheduledDate);
                return when ? when >= now && when <= weekEdge : false;
            }).length;
            const onlineCount = scheduledUpcoming.filter((item) => item.inspectionMode === 'ONLINE_MEET').length;
            const onsiteCount = scheduledUpcoming.filter((item) => item.inspectionMode === 'ONSITE').length;

            // P1-H (Wave-3): overdue/breached count for the SCHEDULER's own work-activity
            // queue (SLA visibility beyond the reviewer). READ-only + additive + fail-closed:
            // a read failure defaults to 0 so the dashboard never breaks. Org-scoped to the
            // caller's tenant (candidateGroup is a global role code). Does NOT touch the
            // listOverdue cron semantics.
            let overdue = 0;
            try {
                overdue = await workActivityService.countOverdueForGroup({
                    prisma,
                    role: CANONICAL_ROLES.DISPATCHER,
                    asOf: now,
                    organizationId: req.user?.organizationId || undefined,
                });
            } catch (slaError) {
                logger.error('[provider] scheduler/dashboard overdue count failed:', slaError);
                overdue = 0;
            }

            const paginate = (items) => ({
                total: items.length,
                items: items.slice((page - 1) * limit, (page - 1) * limit + limit),
            });

            return res.json({
                success: true,
                data: {
                    queues: {
                        readyForReview: paginate(readyForReview),
                        readyToSchedule: paginate(readyToSchedule),
                        scheduledUpcoming: paginate(scheduledUpcoming),
                        rescheduleRequired: paginate(rescheduleRequired),
                    },
                    pipeline,
                    calendar: { events: calendarEvents },
                    kpi: {
                        scheduledToday,
                        scheduledThisWeek,
                        pendingScheduling: readyToSchedule.length,
                        rescheduleBacklog: rescheduleRequired.length,
                        // P1-H: scheduler-group work activities that are overdue/breached.
                        overdue,
                        onlineVsOnsite: {
                            online: onlineCount,
                            onsite: onsiteCount,
                            ratio: onsiteCount === 0 ? (onlineCount > 0 ? 100 : 0) : Math.round((onlineCount / onsiteCount) * 100),
                        },
                    },
                    pagination: { page, limit },
                },
            });
        } catch (error) {
            logger.error('[provider] scheduler/dashboard failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch scheduler dashboard',
            });
        }
    },
];

module.exports = {
    schedulerDashboard,
};
