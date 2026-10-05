const {
    authenticateProvider,
    requireRole,
    logger,
    toInt,
    dt,
    PROVIDERRoles,
    buildSchedulerQueueItem,
} = require('./scheduler-handler-deps');
const { ROLE_GROUPS } = require('../../../../shared/canonical-rbac');
const applicationService = require('../../../../services/application-service');
const providerUserService = require('../../../../services/provider-user-service');
const { getZonedParts } = require('../../../../utils/working-days');

const schedulerAuditSchedulesGet = [
    authenticateProvider,
    // 2026-09-07 — was `requireRole(PROVIDERRoles)`, and PROVIDERRoles is
    // ROLE_GROUPS.FULL_STAFF (handlers/shared.js:13), which includes both finance
    // roles by definition. So this read said "any staff at all" while its name said
    // "provider". Measured on staging: account_dtam got 200 and two live rows naming
    // applications and their audit state — which auditor visits which farm and when.
    // The operator's F-SCOPE-01 ruling puts finance on billing/transaction/accounting
    // data only, and already removed them from /provider/planting-cycles for exactly
    // this reason. AUDIT_STAFF is the circle that does this work: scheduler, auditor,
    // document reviewer, admin — and no finance.
    requireRole(ROLE_GROUPS.AUDIT_STAFF),
    async (req, res) => {
        try {
            const page = toInt(req.query.page, 1, 1, 100000);
            const limit = toInt(req.query.limit, 20);
            const status = String(req.query.status || 'all');
            const queue = String(req.query.queue || 'scheduled_upcoming').toLowerCase();
            const where = {
                isDeleted: false,
                OR: [
                    { scheduledDate: { not: null } },
                    {
                        status: {
                            in: [
                                'DOC_APPROVED',
                                'AUDIT_FEE_PAID',
                                'AUDIT_CONFIRMED',
                                'AUDIT_PASSED',
                            ],
                        },
                    },
                ],
            };

            if (status !== 'all') { where.status = status; }
            if (req.query.auditorId) { where.auditorId = String(req.query.auditorId); }

            const start = req.query.startDate ? dt(req.query.startDate) : null;
            const end = req.query.endDate ? dt(req.query.endDate) : null;
            const apps = await applicationService.listSchedulerScheduleApplications({ where, take: 1000 });

            const auditorIds = [...new Set(apps.map((application) => application.auditorId).filter(Boolean))];
            const auditors = await providerUserService.listAuditorsByIdsForScheduler(auditorIds);
            const auditorMap = new Map(auditors.map((auditor) => [auditor.id, auditor]));
            const province = req.query.province ? String(req.query.province) : '';
            const paymentMap = new Map();

            const audits = apps
                .map((app) => {
                    const queueItem = buildSchedulerQueueItem(app, auditorMap, paymentMap);
                    const farm = app.applicant?.farms?.[0] || null;
                    return {
                        ...queueItem,
                        farm,
                    };
                })
                .filter((item) => !province || item.farm?.province === province)
                .filter((item) => {
                    const when = dt(item.scheduledDate);
                    if (start && (!when || when < start)) { return false; }
                    if (end && (!when || when > end)) { return false; }
                    if (queue === 'ready_to_schedule') {
                        return item.phase2Paid
                            && item.workflowState === 'AUDIT_FEE_PAID'
                            && !item.isRescheduleRequired;
                    }
                    if (queue === 'reschedule_required') {
                        return item.isRescheduleRequired;
                    }
                    return !!when;
                });

            const total = audits.length;
            const data = audits.slice((page - 1) * limit, (page - 1) * limit + limit);
            const now = new Date();
            const week = new Date(now);
            week.setTime(week.getTime() + 7 * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read

            return res.json({
                success: true,
                data,
                pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
                summary: {
                    today: audits.filter((item) => {
                        const when = dt(item.scheduledDate);
                        return when ? getZonedParts(when).isoDate === getZonedParts(now).isoDate : false; // same Bangkok day
                    }).length,
                    thisWeek: audits.filter((item) => {
                        const when = dt(item.scheduledDate);
                        return when ? when <= week : false;
                    }).length,
                    unassigned: audits.filter((item) => !item.auditorId).length,
                    withGPS: audits.filter((item) => item.farm?.latitude && item.farm?.longitude).length,
                },
            });
        } catch (error) {
            logger.error('[provider] scheduler/audits/schedules failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch audit schedule',
            });
        }
    },
];

module.exports = {
    schedulerAuditSchedulesGet,
};
