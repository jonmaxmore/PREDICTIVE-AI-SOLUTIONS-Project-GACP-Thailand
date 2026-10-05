const {
    authenticateProvider,
    requireRole,
    logger,
    dt,
    PROVIDERRoles,
} = require('./scheduler-handler-deps');
const applicationService = require('../../../../services/application-service');
const { startOfLocalDay, endOfLocalDay } = require('../../../../utils/working-days');

const auditsRouteOptimization = [
    authenticateProvider,
    requireRole(PROVIDERRoles),
    async (req, res) => {
        try {
            const auditorId = req.query?.auditorId || req.user.id;
            const base = req.query?.date ? dt(req.query.date) : new Date();
            if (!base) {
                return res.status(400).json({ success: false, error: 'Invalid date' });
            }

            // The Bangkok day of `base`, 00:00 to 23:59:59.999 in Bangkok.
            const start = startOfLocalDay(base);
            const end = endOfLocalDay(base);

            const apps = await applicationService.listAuditorRouteApplications({ auditorId, start, end });

            const points = apps.map((app) => ({
                id: app.id,
                applicationId: app.id,
                applicationNumber: app.applicationNumber,
                scheduledDate: app.scheduledDate,
                farm: app.applicant?.farms?.find((farm) => farm.latitude && farm.longitude) || null,
            })).filter((point) => point.farm);

            return res.json({
                success: true,
                data: {
                    originalOrder: points,
                    optimizedRoute: points,
                    statistics: { totalAudits: apps.length, withGPS: points.length },
                },
            });
        } catch (error) {
            logger.error('[provider] audits/route-optimization failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Route optimization failed',
            });
        }
    },
];

module.exports = {
    auditsRouteOptimization,
};
