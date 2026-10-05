const {
    authenticateProvider,
    requireRole,
    logger,
    PROVIDERRoles,
    adminRoles,
    toInt,
} = require('./shared');
const { createNotification } = require('../../../../services/notification-service');
// Batch 10 — Prisma bypass cleanup. Certificate reads on the provider side
// (dashboard aggregates, bulk-notify lookup) now go through certificate-service
// so the isDeleted + active-status filters live in one place.
const certificateService = require('../../../../services/certificate-service');

const certificatesDashboard = [
    authenticateProvider,
    requireRole(PROVIDERRoles),
    async (req, res) => {
        try {
            const now = new Date();
            const d30 = new Date(now);
            d30.setTime(d30.getTime() + 30 * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read
            const d90 = new Date(now);
            d90.setTime(d90.getTime() + 90 * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read

            // certificateService.getProviderDashboardAggregates — replaces
            // 6 separate prisma.certificate.count/groupBy/findMany calls.
            const [totalActive, expiring30Days, expiring90Days, byStandard, byProvince, expiringList] =
                await certificateService.getProviderDashboardAggregates({
                    now,
                    expiring30Cutoff: d30,
                    expiring90Cutoff: d90,
                    listLimit: 50,
                });

            return res.json({
                success: true,
                data: {
                    summary: {
                        totalActive,
                        expiring30Days,
                        expiring90Days,
                        renewalRate: totalActive > 0 ? Math.round(((totalActive - expiring90Days) / totalActive) * 100) : 0,
                    },
                    byStandard: byStandard.map((x) => ({ standardName: x.standardName, count: x._count.id })),
                    byProvince: byProvince
                        .sort((a, b) => b._count.id - a._count.id)
                        .slice(0, 10)
                        .map((x) => ({ province: x.province, count: x._count.id })),
                    expiringList,
                },
            });
        } catch (error) {
            logger.error('[provider] certificates/dashboard failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch certificate dashboard',
            });
        }
    },
];

const certificatesBulkNotify = [
    authenticateProvider,
    requireRole(adminRoles),
    async (req, res) => {
        try {
            const days = toInt(req.body?.daysBeforeExpiry, 30, 1, 180);
            const now = new Date();
            const cutoff = new Date(now);
            cutoff.setTime(cutoff.getTime() + days * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read

            // certificateService.listExpiringActiveCertificates — replaces
            // prisma.certificate.findMany with the active+expiry window filter.
            const certs = await certificateService.listExpiringActiveCertificates({ now, cutoff, take: 500 });

            // Reminders are independent per-cert — no atomicity needed across
            // the loop (the transaction the previous version wrapped this in
            // mostly served readability, not consistency). Routing through
            // createNotification() unlocks per-user channel preferences and
            // tenant-context fallback.
            let created = 0;
            for (const certificate of certs) {
                const result = await createNotification({
                    userId: certificate.userId,
                    type: 'INFO',
                    title: 'Certificate renewal reminder',
                    message: `Certificate ${certificate.certificateNumber} expires soon`,
                    data: {
                        certificateId: certificate.id,
                        certificateNumber: certificate.certificateNumber,
                        expiryDate: certificate.expiryDate,
                        farmName: certificate.farmName,
                    },
                });
                if (result) {created += 1;}
            }

            return res.json({
                success: true,
                message: `${created} notifications queued`,
                data: { count: created },
            });
        } catch (error) {
            logger.error('[provider] certificates/bulk-notify failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Bulk notification failed',
            });
        }
    },
];

module.exports = {
    certificatesDashboard,
    certificatesBulkNotify,
};
