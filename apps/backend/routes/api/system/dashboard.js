/**
 * Dashboard API Routes
 * GET /api/dashboard/stats - Get health dashboard statistics
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const authModule = require('../../../middleware/auth-middleware');
const applicationService = require('../../../services/application-service');
const { holderScope, r1HolderOrLegacyWhenScoped } = require('../../../services/holder-access');
const { buildHealthProcessCounts } = require('../../../shared/health-dashboard-stage');
const logger = require('../../../shared/logger');

// Use dual-auth so both Health users and Provider staff can access dashboard
const authenticateAny = authModule.authenticateAny || ((req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ success: false, message: 'Auth middleware error' });
});

/**
 * GET /api/dashboard (root — alias for /stats)
 */
router.get('/', authenticateAny, async (req, res, next) => {
    req.url = '/stats';
    router.handle(req, res, next);
});

/**
 * GET /api/dashboard/stats
 */
router.get('/stats', authenticateAny, async (req, res) => {
    try {
        const userId = String(req.user?.id || '').trim();
        const healthIdFromToken = String(req.user?.healthId || '').trim();
        if (!healthIdFromToken) {
            // Provider role — return tenant-scoped stats instead of system-wide.
            //
            // PR-1.2: before this commit, the provider branch returned UNFILTERED
            // counts of every Application / Farm / Certificate in the database.
            // Once a second tenant onboards, that's a cross-org data leak —
            // a scheduler/auditor in tenant A would see tenant B's totals.
            //
            // We now filter every count by req.user.organizationId (set by
            // tenantContextMiddleware on every authenticated request, with the
            // organizationId JWT claim added in commit e045959). Legacy tokens
            // that pre-date the JWT claim fall back to the previous unscoped
            // behavior so existing sessions don't break — once those tokens
            // expire (12h max) the org filter becomes mandatory.
            try {
                const orgId = req.user?.organizationId
                    || req.tenantContext?.organizationId
                    || null;
                const baseWhere = orgId ? { isDeleted: false, organizationId: orgId } : { isDeleted: false };
                const farmWhere = orgId
                    ? { isDeleted: false, organizationId: orgId }
                    : { isDeleted: false };
                const certWhere = orgId
                    ? { isDeleted: false, organizationId: orgId, status: { in: ['active', 'ACTIVE'] } }
                    : { isDeleted: false, status: { in: ['active', 'ACTIVE'] } };
                const [totalApps, totalFarms, totalCerts] = await Promise.all([
                    prisma.application.count({ where: baseWhere }).catch(() => 0),
                    prisma.farm.count({ where: farmWhere }).catch(() => 0),
                    prisma.certificate.count({ where: certWhere }).catch(() => 0),
                ]);
                return res.json({
                    success: true,
                    data: {
                        applications: totalApps,
                        farms: totalFarms,
                        notices: 0,
                        totalApplications: totalApps,
                        certificates: totalCerts,
                        pendingApplications: 0,
                        viewType: 'provider',
                        scope: orgId ? 'organization' : 'global-legacy',
                    },
                });
            } catch (_err) {
                return res.json({ success: true, data: { applications: 0, farms: 0, notices: 0, certificates: 0, viewType: 'provider' } });
            }
        }

        const healthIdentity = await applicationService.resolveHealthIdentity(userId || null, {
            userId: userId || undefined,
            healthId: healthIdFromToken || undefined,
        });
        const actorUserId = healthIdentity.userId;
        const actorHealthId = healthIdentity.healthId;
        // Spec 2026-09-30 §3.1: the filings whose holder is in the caller's scope.
        const scope = await holderScope(req);

        const [applications, farmsCount, noticesCount, certificatesCount] = await Promise.all([
            applicationService.getHealthApplications(actorUserId || null, {
                // R1-legacy-pin: removed in Task 12 — the pre-R1 where options.
                userId: actorUserId,
                healthId: actorHealthId,
                strictHealthId: true,
                holderScope: scope,
            }),
            prisma.farm.count({
                // Scope by Farm.ownerId = User.id (UUID). NOT owner.healthId:
                // actorHealthId is the keyed-HMAC TOKEN but the User.healthId
                // COLUMN is enc:v1: ciphertext at rest (STAGE B), so a relation
                // filter on it never matches → farms:0 for an owner who has
                // farms (reproduced live 2026-07-03). ownerId is never re-keyed.
                where: {
                    isDeleted: false,
                    ownerId: actorUserId,
                    owner: { isDeleted: false },
                    // R1-legacy-pin: removed in Task 12 — the pre-R1 owner where decides.
                    ...r1HolderOrLegacyWhenScoped(scope, 'Farm', { ownerId: actorUserId, owner: { isDeleted: false } }),
                },
            }),
            actorUserId
                ? prisma.notification.count({
                    where: {
                        userId: actorUserId,
                        isRead: false,
                    },
                }).catch(() => 0)
                : Promise.resolve(0),
            prisma.certificate.count({
                // Same token-vs-ciphertext fix as farms: scope by
                // Certificate.userId = User.id (UUID), not user.healthId.
                where: {
                    isDeleted: false,
                    status: { in: ['active', 'ACTIVE'] },
                    userId: actorUserId,
                    user: { isDeleted: false },
                    // R1-legacy-pin: removed in Task 12 — the pre-R1 filer where decides.
                    ...r1HolderOrLegacyWhenScoped(scope, 'Certificate', { userId: actorUserId, user: { isDeleted: false } }),
                },
            }),
        ]);

        const processCounts = buildHealthProcessCounts((applications || []).map((app) => ({
            ...app,
            hasCertificate: Array.isArray(app.certificates) && app.certificates.length > 0,
            certificateCount: Array.isArray(app.certificates) ? app.certificates.length : 0,
        })));

        const pendingApplications = processCounts.waitingDocumentReview
            + processCounts.waitingPayment
            + processCounts.waitingAudit;

        res.json({
            success: true,
            data: {
                // Backward-compatible fields
                applications: applications.length,
                farms: farmsCount,
                notices: noticesCount,

                // New/explicit fields
                totalApplications: applications.length,
                certificates: certificatesCount,
                pendingApplications,
                process: processCounts,
            },
        });
    } catch (error) {
        logger.error('Error fetching dashboard stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard statistics',
            error: safeErrorMessage(error),
        });
    }
});

/**
 * GET /api/dashboard/summary (alias for /stats)
 */
router.get('/summary', authenticateAny, (req, res, next) => {
    req.url = '/stats';
    router.handle(req, res, next);
});

module.exports = router;
