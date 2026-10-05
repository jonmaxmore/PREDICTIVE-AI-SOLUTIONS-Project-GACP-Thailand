const { safeErrorMessage } = require('../../../shared/api-response');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
const { getZonedParts, startOfLocalCalendarDay, endOfLocalDay } = require('../../../utils/working-days');

function registerPredictivePerformanceRoutes(router, deps) {
    const {
        authenticate,
        requireRole,
        prisma,
        cacheService,
        logger,
    } = deps;

    router.get('/predictions/certification-expiry', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
        try {
            const { months = 6 } = req.query;
            // End of the Bangkok day `months` calendar months from today.
            const todayBkk = getZonedParts(new Date());
            const cutoffDate = endOfLocalDay(startOfLocalCalendarDay(todayBkk.year, todayBkk.month + parseInt(months), todayBkk.day));

            // Three schema-drift bugs caught in a security/correctness sweep
            // (2026-05-03):
            //   1. `status: 'ACTIVE'` — Certificate.status defaults to
            //      lowercase 'active' (`certification.prisma:51`); UPPER would
            //      match nothing.
            //   2. `include: { farm: ... }` — Certificate has NO `farm`
            //      relation. It carries denormalized `farmName` and
            //      `province` string columns directly (`certification.prisma:
            //      22-29`). Including a phantom relation 500'd the query.
            //   3. `select: { phone: true }` on User — User column is
            //      `phoneNumber`, not `phone` (`auth.prisma`). Would have
            //      500'd even if the farm-relation issue were fixed.
            // The user relation goes through Certificate.userId → User
            // directly (no farm hop required for owner contact info).
            const expiring = await prisma.certificate.findMany({
                where: {
                    status: 'active',
                    expiryDate: {
                        lte: cutoffDate,
                        gt: new Date(),
                    },
                },
                include: {
                    user: {
                        select: {
                            email: true,
                            phoneNumber: true,
                        },
                    },
                },
                orderBy: { expiryDate: 'asc' },
            });

            const byMonth = {};
            expiring.forEach((cert) => {
                const month = getZonedParts(cert.expiryDate).isoDate.slice(0, 7); // Bangkok month
                if (!byMonth[month]) {
                    byMonth[month] = {
                        month,
                        count: 0,
                        certificates: [],
                    };
                }

                byMonth[month].count++;
                byMonth[month].certificates.push({
                    id: cert.id,
                    number: cert.certificateNumber,
                    farmName: cert.farmName,
                    province: cert.province,
                    ownerEmail: cert.user?.email || null,
                    ownerPhone: cert.user?.phoneNumber || null,
                    expiryDate: cert.expiryDate,
                    daysUntilExpiry: Math.floor((cert.expiryDate - new Date()) / (1000 * 60 * 60 * 24)),
                });
            });

            const avgAuditTime = 4;
            const totalAudits = expiring.length;
            const totalHours = totalAudits * avgAuditTime;

            return res.json({
                success: true,
                data: {
                    summary: {
                        totalExpiring: expiring.length,
                        timeFrame: `${months} months`,
                        estimatedAuditHours: totalHours,
                        estimatedAuditorsNeeded: Math.ceil(totalHours / (20 * 8)),
                    },
                    byMonth: Object.values(byMonth),
                },
            });
        } catch (error) {
            logger.error({
                type: 'expiry_prediction_error',
                error: safeErrorMessage(error),
            }, 'Expiry prediction failed');

            return res.status(500).json({
                success: false,
                error: 'Failed to load predictions',
            });
        }
    });

    router.get('/predictions/harvest-forecast', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
        try {
            const { months = 3 } = req.query;
            // End of the Bangkok day `months` calendar months from today.
            const todayBkk = getZonedParts(new Date());
            const cutoffDate = endOfLocalDay(startOfLocalCalendarDay(todayBkk.year, todayBkk.month + parseInt(months), todayBkk.day));

            const upcomingHarvests = await prisma.plantingCycle.findMany({
                where: {
                    expectedHarvestDate: {
                        lte: cutoffDate,
                        gte: new Date(),
                    },
                    isDeleted: false,
                    // 'IN_PROGRESS' is NOT a valid PlantingCycle status (domain is
                    // PLANNING/PLANTED/GROWING/READY_HARVEST/HARVESTED/COMPLETED) →
                    // matched nothing, so the harvest forecast was always empty. The
                    // upcoming-harvest set is the still-growing cycles.
                    status: { in: ['PLANTED', 'GROWING', 'READY_HARVEST'] },
                },
                include: {
                    farm: {
                        select: {
                            farmName: true,
                            province: true,
                        },
                    },
                    plantSpecies: {
                        select: {
                            nameTH: true,
                            code: true,
                        },
                    },
                },
            });

            const forecast = upcomingHarvests.map((cycle) => {
                const estimatedYield = cycle.estimatedYield
                    || (cycle.plotArea ? cycle.plotArea * 100 : 0);

                return {
                    cycleId: cycle.id,
                    farmName: cycle.farm?.farmName,
                    province: cycle.farm?.province,
                    plantType: cycle.plantSpecies?.nameTH,
                    expectedDate: cycle.expectedHarvestDate,
                    estimatedYield,
                    plotArea: cycle.plotArea,
                    confidence: cycle.actualYield ? 'HIGH' : 'MEDIUM',
                };
            });

            const byMonth = {};
            forecast.forEach((item) => {
                const month = getZonedParts(item.expectedDate).isoDate.slice(0, 7); // Bangkok month
                if (!byMonth[month]) {
                    byMonth[month] = { month, totalYield: 0, count: 0, byProvince: {} };
                }

                byMonth[month].totalYield += item.estimatedYield;
                byMonth[month].count++;
                const province = item.province || 'Unknown';
                if (!byMonth[month].byProvince[province]) {
                    byMonth[month].byProvince[province] = { province, yield: 0, count: 0 };
                }

                byMonth[month].byProvince[province].yield += item.estimatedYield;
                byMonth[month].byProvince[province].count++;
            });

            return res.json({
                success: true,
                data: {
                    summary: {
                        totalCycles: forecast.length,
                        totalEstimatedYield: forecast.reduce((sum, item) => sum + item.estimatedYield, 0),
                        timeFrame: `${months} months`,
                    },
                    details: forecast,
                    byMonth: Object.values(byMonth).map((month) => ({
                        ...month,
                        byProvince: Object.values(month.byProvince),
                    })),
                },
            });
        } catch (error) {
            logger.error({
                type: 'harvest_forecast_error',
                error: safeErrorMessage(error),
            }, 'Harvest forecast failed');

            return res.status(500).json({
                success: false,
                error: 'Failed to load forecast',
            });
        }
    });

    router.get('/performance/overview', authenticate, requireRole(ROLE_GROUPS.ADMIN_ONLY), async (req, res) => {
        // STALE SCHEMA — disabled 2026-05-03. All four raw SQL queries
        // referenced tables / columns that do not exist:
        //
        //   1. `FROM "GCPApplication"` — table is `applications`
        //      (`prisma/schema/application.prisma:200`).
        //   2. `submitted_at` and `updated_at` on Application — Application
        //      has `createdAt` / `updatedAt` (no submission timestamp). Stage
        //      timestamps live inside the `workflowHistory` JSON column.
        //   3. `FROM audits` — no such table. The codebase has `audit_logs`
        //      (`AuditLog` model), `audit_checklists` and a per-application
        //      audit flow scattered across PostAuditTask + WorkActivity.
        //      There is no single "audits" table to aggregate from.
        //   4. `FROM certificates WHERE created_at` — column is `createdAt`
        //      (camelCase + double-quote required in raw SQL).
        //   5. `FROM certificate_verification_logs` — table doesn't exist.
        //      The .catch(() => [{ total: 0 }]) hid this failure but the
        //      rest of the Promise.all still rejected.
        //
        // Zero frontend callers verified via repo grep. Returns 501 until the
        // KPI definitions are re-confirmed against current schema.
        // Specifically: which tables count toward "audits.completed" — open
        // PostAuditTask rows? completed WorkActivity rows of type
        // ON_SITE_AUDIT? Both? — needs product sign-off, not a guess.
        logger.warn('[analytics] /performance/overview called but disabled — see route comment');
        return res.status(501).json({
            success: false,
            error: 'Endpoint disabled pending re-design against current schema',
            details: 'Legacy SQL referenced 4 phantom tables/columns. Re-implement with explicit KPI definitions: which tables count toward each metric, which application statuses are "submitted", whether audit completion is counted by PostAuditTask or WorkActivity.',
        });
    });

    router.get('/dashboard', authenticate, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
        try {
            const cacheKey = 'analytics:dashboard:summary';
            const cached = await cacheService.get(cacheKey);
            if (cached) {
                return res.json({ success: true, data: cached, cached: true });
            }

            const [
                totalFarms,
                totalCertificates,
                totalApplications,
                pendingApplications,
                expiringCertificates,
                recentVerifications,
            ] = await Promise.all([
                prisma.farm.count({ where: { isDeleted: false } }),
                prisma.certificate.count({ where: { status: 'ACTIVE' } }),
                prisma.application.count(),
                prisma.application.count({
                    where: { status: { in: ['SUBMITTED', 'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED'] } },
                }),
                prisma.certificate.count({
                    where: {
                        status: 'ACTIVE',
                        expiryDate: {
                            lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                            gt: new Date(),
                        },
                    },
                }),
                prisma.certificateVerificationLogs?.count({
                    where: {
                        verifiedAt: {
                            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                        },
                    },
                }).catch(() => 0),
            ]);

            const result = {
                summary: {
                    totalFarms,
                    totalCertificates,
                    totalApplications,
                    pendingApplications,
                    expiringCertificates,
                    recentVerifications,
                },
                alerts: [],
            };

            if (expiringCertificates > 50) {
                result.alerts.push({
                    type: 'CERTIFICATES_EXPIRING',
                    severity: 'HIGH',
                    message: `${expiringCertificates} certificates expiring in next 90 days`,
                    action: '/provider/certificates/dashboard',
                });
            }

            if (pendingApplications > 100) {
                result.alerts.push({
                    type: 'APPLICATIONS_BACKLOG',
                    severity: 'MEDIUM',
                    message: `${pendingApplications} applications pending review`,
                    action: '/provider/applications/queue',
                });
            }

            await cacheService.set(cacheKey, result, 300);

            return res.json({
                success: true,
                data: result,
            });
        } catch (error) {
            logger.error({
                type: 'dashboard_summary_error',
                error: safeErrorMessage(error),
            }, 'Dashboard summary failed');

            return res.status(500).json({
                success: false,
                error: 'Failed to load dashboard',
            });
        }
    });
}

module.exports = {
    registerPredictivePerformanceRoutes,
};
