const {
    authenticateProvider,
    requireRole,
    logger,
    adminRoles,
    dt,
} = require('./shared');
const { respondError } = require('../../../../shared/api-response');
const applicationService = require('../../../../services/application-service');

const analyticsPerformance = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const start = req.query?.startDate ? dt(req.query.startDate) : new Date(Date.now() - 30 * 86400000);
            const end = req.query?.endDate ? dt(req.query.endDate) : new Date();
            if (!start || !end) {
                return res.status(400).json({ success: false, error: 'Invalid date range' });
            }

            // Server-side aggregation via groupBy. Replaces the previous
            // pattern that loaded every matching application row into the
            // node process and tallied in JS — `groupBy` lets Postgres do
            // the bucketing, so the response payload is bounded by
            // (#actors × #status-buckets) instead of the raw row count.
            const grouped = await applicationService.groupApplicationsByActorAndStatus({ start, end });

            const byActor = new Map();
            for (const row of grouped) {
                const id = row.updatedBy;
                const count = row._count._all;
                const metric = byActor.get(id) || {
                    id,
                    applicationsReviewed: 0,
                    approved: 0,
                    rejected: 0,
                    auditsScheduled: 0,
                };
                metric.applicationsReviewed += count;
                if (row.status === 'APPROVED') {
                    metric.approved += count;
                }
                if (row.status === 'REJECTED') {
                    metric.rejected += count;
                }
                if (row.status === 'AUDIT_CONFIRMED') {
                    metric.auditsScheduled += count;
                }
                byActor.set(id, metric);
            }

            return res.json({
                success: true,
                data: {
                    period: { start, end },
                    PROVIDERPerformance: [...byActor.values()]
                        .sort((a, b) => b.applicationsReviewed - a.applicationsReviewed),
                },
            });
        } catch (error) {
            logger.error('[provider] analytics/performance failed:', error);
            return respondError(res, req, error, { message: 'Failed to fetch analytics' });
        }
    },
];

module.exports = {
    analyticsPerformance,
};
