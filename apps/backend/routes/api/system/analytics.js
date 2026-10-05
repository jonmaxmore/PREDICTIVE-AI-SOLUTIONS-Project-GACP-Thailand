/**
 * Analytics API Routes
 * 
 * Features:
 * - Geographic heat maps
 * - Trend analysis
 * - Predictive analytics
 * - Performance metrics
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const { authenticateAny: authenticate, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
const cacheService = require('../../../services/cache-service');
const { registerPredictivePerformanceRoutes } = require('./analytics-predictive-performance-routes');
const logger = require('../../../shared/logger');


// GEOGRAPHIC HEAT MAPS

/**
 * GET /api/analytics
 * Analytics overview / summary
 *
 * Auth-gated like every sibling route in this router (SEC-SYS-003): the root
 * route previously had NO guard, so it returned platform-wide aggregate counts
 * to anonymous callers. With ENT-01 org read-scope on, an unauth caller also
 * bypasses the tenant boundary. No frontend consumes this anonymously.
 */
router.get('/', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    try {
        const [totalFarms, totalApps, totalCerts] = await Promise.all([
            prisma.farm.count({ where: { isDeleted: false } }),
            prisma.application.count({ where: { isDeleted: false } }),
            prisma.certificate.count().catch(() => 0),
        ]);
        return res.json({
            success: true,
            data: {
                summary: { totalFarms, totalApplications: totalApps, totalCertificates: totalCerts },
                availableEndpoints: [
                    '/analytics/geography/farms',
                    '/analytics/geography/certification-rate',
                    '/analytics/trends/applications',
                    '/analytics/trends/plant-types',
                    '/analytics/dashboard',
                ],
            },
        });
    } catch (error) {
        logger.error('[Analytics] root error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load analytics' });
    }
});

/**
 * @route GET /api/analytics/dashboard
 * @desc Analytics dashboard summary (all provider roles)
 * @access Provider (all roles)
 */
router.get('/dashboard', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    try {
        const cacheKey = 'analytics:dashboard';
        const cached = await cacheService.get(cacheKey);
        if (cached) {return res.json({ success: true, data: cached, cached: true });}

        const [totalFarms, totalApps, totalCerts] = await Promise.all([
            prisma.farm.count({ where: { isDeleted: false } }),
            prisma.application.count({ where: { isDeleted: false } }),
            prisma.certificate.count({ where: { isDeleted: false } }),
        ]);

        const data = {
            summary: { totalFarms, totalApplications: totalApps, totalCertificates: totalCerts },
            availableEndpoints: [
                '/analytics/geography/farms',
                '/analytics/geography/certification-rate',
                '/analytics/trends/applications',
                '/analytics/trends/plant-types',
            ],
        };

        await cacheService.set(cacheKey, data, 300);
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Analytics] dashboard error:', error);
        return res.status(500).json({ success: false, error: 'Failed to load analytics dashboard' });
    }
});

/**
 * @route GET /api/analytics/geography/farms
 * @desc Get farm distribution for heat map visualization
 * @access Provider
 */
router.get('/geography/farms', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    try {
        const { 
            plantType,
            certificationStatus,
            period = 'all',
        } = req.query;

        const cacheKey = `analytics:geo:farms:${plantType || 'all'}:${certificationStatus || 'all'}:${period}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached, cached: true });
        }

        // Build where clause
        const where = { isDeleted: false };
        
        if (plantType) {
            where.plantType = plantType;
        }

        // Get farms with coordinates
        const farms = await prisma.farm.findMany({
            where: {
                ...where,
                latitude: { not: null },
                longitude: { not: null },
            },
            select: {
                id: true,
                farmName: true,
                province: true,
                district: true,
                latitude: true,
                longitude: true,
                farmType: true,
                status: true,
                // (Removed an unused `_count` select that referenced non-existent
                // Farm relations `cycles`/`applications` — it raised a
                // PrismaClientValidationError and is not read in the response.)
            },
        });

        // Get certification status for each farm — single bulk query instead
        // of N findFirst()s. With ~1000 farms this drops the cert-lookup leg
        // from 1000 sequential round-trips to 1.
        const farmIds = farms.map(f => f.id);
        const activeCerts = farmIds.length === 0
            ? []
            : await prisma.certificate.findMany({
                where: {
                    farmId: { in: farmIds },
                    status: 'ACTIVE',
                    expiryDate: { gt: new Date() },
                },
                select: {
                    farmId: true,
                    certificateNumber: true,
                    standardName: true,
                    expiryDate: true,
                },
            });

        // Take the first matching cert per farmId — same non-deterministic
        // pick the original `findFirst()` produced; preserves semantics.
        const certByFarmId = new Map();
        for (const cert of activeCerts) {
            if (!certByFarmId.has(cert.farmId)) {
                const { farmId: _farmId, ...rest } = cert;
                certByFarmId.set(cert.farmId, rest);
            }
        }

        const farmsWithCertStatus = farms.map((farm) => {
            const cert = certByFarmId.get(farm.id) || null;
            return {
                ...farm,
                hasCertificate: !!cert,
                certificate: cert,
            };
        });

        // Filter by certification status if specified
        let filteredFarms = farmsWithCertStatus;
        if (certificationStatus === 'certified') {
            filteredFarms = farmsWithCertStatus.filter(f => f.hasCertificate);
        } else if (certificationStatus === 'uncertified') {
            filteredFarms = farmsWithCertStatus.filter(f => !f.hasCertificate);
        }

        // Aggregate by province for summary
        const byProvince = {};
        filteredFarms.forEach(farm => {
            const prov = farm.province || 'Unknown';
            if (!byProvince[prov]) {
                byProvince[prov] = {
                    province: prov,
                    count: 0,
                    certified: 0,
                    uncertified: 0,
                };
            }
            byProvince[prov].count++;
            if (farm.hasCertificate) {
                byProvince[prov].certified++;
            } else {
                byProvince[prov].uncertified++;
            }
        });

        const result = {
            totalFarms: filteredFarms.length,
            certifiedFarms: filteredFarms.filter(f => f.hasCertificate).length,
            uncertifiedFarms: filteredFarms.filter(f => !f.hasCertificate).length,
            farms: filteredFarms.map(f => ({
                id: f.id,
                name: f.farmName,
                latitude: f.latitude,
                longitude: f.longitude,
                province: f.province,
                district: f.district,
                type: f.farmType,
                status: f.status,
                hasCertificate: f.hasCertificate,
                // NOTE: cycleCount/applicationCount were removed — they read
                // f._count.{cycles,applications} but the select has no `_count`
                // (Farm has no such relations; see select comment above), so
                // f._count was undefined → TypeError → 500 on any geo-tagged farm.
            })),
            byProvince: Object.values(byProvince).sort((a, b) => b.count - a.count),
        };

        // Cache for 1 hour
        await cacheService.set(cacheKey, result, 3600);

        res.json({
            success: true,
            data: result,
        });

    } catch (error) {
        logger.error({
            type: 'geo_analytics_error',
            error: safeErrorMessage(error),
        }, 'Geographic analytics failed');

        res.status(500).json({
            success: false,
            error: 'Failed to load geographic data',
        });
    }
});

/**
 * @route GET /api/analytics/geography/certification-rate
 * @desc Get certification rate by province/region
 * @access Provider
 */
router.get('/geography/certification-rate', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    // STALE SCHEMA — disabled 2026-05-03 after a security/correctness sweep
    // caught it 500'ing on every call. The legacy raw SQL was authored
    // against a much older schema:
    //
    //   - `c.farm_id` / `c.expiry_date` — Certificate columns are camelCase
    //     (`farmId`, `expiryDate`) and Postgres requires `c."farmId"` quoting
    //     in raw SQL when the column was created with mixed-case identifiers.
    //   - `f.is_deleted` — Farm column is `isDeleted`.
    //   - `c.status = 'ACTIVE'` — schema default is lowercase 'active' (see
    //     `prisma/schema/certification.prisma:51`).
    //
    // Zero frontend callers (verified via repo grep). Mechanical fixes are
    // tractable but the semantic intent of the certification-rate metric
    // still needs product sign-off (which provinces? expired vs active vs
    // any-time-issued? per-applicant or per-farm? what is the denominator?).
    // Returning 501 with a clear pointer is more honest than silently 500ing
    // or guessing the statistical definition.
    logger.warn('[analytics] /geography/certification-rate called but disabled — see route comment');
    res.status(501).json({
        success: false,
        error: 'Endpoint disabled pending re-design against current schema',
        details: 'The legacy raw SQL referenced columns that have since been renamed. Re-implement against the current schema before re-enabling. See route handler comment.',
    });
});

// TREND ANALYSIS

/**
 * @route GET /api/analytics/trends/applications
 * @desc Get application submission trends over time
 * @access Provider
 */
router.get('/trends/applications', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    // STALE SCHEMA — disabled 2026-05-03 alongside /geography/certification-rate.
    //
    //   - `FROM "GCPApplication"` — table renamed long ago; current name is
    //     `applications` per `prisma/schema/application.prisma:200`
    //     (`@@map("applications")`).
    //   - `submitted_at` column does not exist on Application. Submission
    //     time is implicit via `createdAt` for the row; stage-transition
    //     timestamps live inside the `workflowHistory` JSON column.
    //   - `is_deleted` should be `"isDeleted"`.
    //   - The status filter compares to 'APPROVED' / 'PENDING' which are not
    //     valid values in the current state-machine
    //     (`shared/workflow-state-machine.js`). Closest equivalents are
    //     CERTIFIED and UNDER_REVIEW respectively, but mapping needs product
    //     sign-off — should the funnel count REVISION_REQUESTED as pending?
    //     Should EXPIRED count against approved? — out of scope for a
    //     mechanical schema-fix.
    //
    // Zero frontend callers verified via repo grep. Returns 501 until the
    // metric definition is re-confirmed.
    logger.warn('[analytics] /trends/applications called but disabled — see route comment');
    res.status(501).json({
        success: false,
        error: 'Endpoint disabled pending re-design against current schema',
        details: 'Legacy SQL references the long-renamed "GCPApplication" table and an undefined `submitted_at` column. Re-implement against `applications` (`@@map`) with explicit status-bucket definitions before re-enabling.',
    });
});

/**
 * @route GET /api/analytics/trends/plant-types
 * @desc Get trends by plant type
 * @access Provider
 */
router.get('/trends/plant-types', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    // STALE SCHEMA — disabled 2026-05-03 alongside the other two analytics
    // raw-SQL endpoints. PlantSpecies columns are camelCase
    // (`nameTH`, `isActive` — see `prisma/schema/trace.prisma`). PlantingCycle
    // and Farm references use snake_case `farm_id`, `is_deleted`,
    // `actual_yield` which don't match real column names. Identical fix
    // pattern to /geography/certification-rate — mechanically tractable, but
    // the cache key + caller assumptions need re-validation. Zero frontend
    // callers; returns 501 to make the staleness visible.
    logger.warn('[analytics] /trends/plant-types called but disabled — see route comment');
    res.status(501).json({
        success: false,
        error: 'Endpoint disabled pending re-design against current schema',
        details: 'Legacy SQL uses snake_case column names (farm_id, is_deleted, actual_yield, name_th, is_active) that don\'t match the camelCase columns Prisma emits.',
    });
});

registerPredictivePerformanceRoutes(router, {
    authenticate: authenticate,
    requireRole,
    prisma,
    cacheService,
    logger,
});

module.exports = router;
