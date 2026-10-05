const { prisma } = require('../services/prisma-database');
const logger = require('../shared/logger');
const { notifySlaBreach } = require('../services/notification-service');
const { runWithTenantContext, withoutTenantScope } = require('../services/tenant-context');

/**
 * Check for applications pending for > 5 Days
 */
const checkSlaBreaches = async (_job) => {
    logger.info('[SLA-Monitor] Starting SLA Check Job...');

    try {
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setTime(fiveDaysAgo.getTime() - 5 * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read

        // Cross-tenant scan: cron has no tenant scope. Per-app writes
        // re-enter the application's tenant via runWithTenantContext below.
        // The Application column is `status` (not `state`); legacy code used
        // `state` here and silently 500'd on every Bull queue tick — no SLA
        // breach detection ran. Caught alongside the matching bug in
        // `sla-monitor.js` (PR #197).
        const staleApps = await withoutTenantScope(() => prisma.application.findMany({
            where: {
                status: {
                    // PR 2c: PENDING_AUDIT / DOCUMENT_APPROVED / AWAITING_SCHEDULE
                    // dropped — no writer produces them and no row holds them,
                    // so they were three values this filter could never match.
                    in: ['AUDIT_CONFIRMED', 'DOC_APPROVED', 'SUBMITTED', 'AUDIT_FEE_PAID'],
                },
                updatedAt: {
                    lt: fiveDaysAgo,
                },
                isDeleted: false,
            },
            select: {
                id: true,
                applicationNumber: true,
                status: true,
                updatedAt: true,
                organizationId: true,
                applicant: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        }));

        if (staleApps.length === 0) {
            logger.info('[SLA-Monitor] No SLA breaches found.');
            return { processed: 0, breaches: [] };
        }

        // Log breaches. Notification is in-app only (cleanup T1, 2026-08-19,
        // operator decision shared/notification-view.js:16-19) — no email/SMS.
        logger.warn(`[SLA-Monitor] FOUND ${staleApps.length} SLA BREACHES!`);

        const breaches = [];
        for (const app of staleApps) {
            if (!app.organizationId) {
                logger.error(`[SLA-Monitor] App ${app.id} missing organizationId; skipping per-tenant scope`);
                continue;
            }

            const daysStuck = Math.floor((new Date() - new Date(app.updatedAt)) / (1000 * 60 * 60 * 24));

            logger.warn(`[SLA-Monitor] App ${app.applicationNumber} (${app.status}) stuck for ${daysStuck} days. HEALTH_USER: ${app.applicant?.firstName}`);

            await runWithTenantContext({ organizationId: app.organizationId }, async () => {
                // Notification writes (createBulkNotifications) inherit this scope
                // so notification rows are tagged with the breaching app's tenant.
                await notifySlaBreach(app.id, daysStuck, app.applicationNumber);
            });

            breaches.push({
                appNo: app.applicationNumber,
                days: daysStuck,
            });
        }

        return { processed: staleApps.length, breaches };

    } catch (error) {
        logger.error('[SLA-Monitor] Job Failed:', error);
        throw error;
    }
};

module.exports = checkSlaBreaches;
