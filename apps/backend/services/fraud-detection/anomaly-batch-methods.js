function createFraudAnomalyBatchMethods({ prisma, cacheService, logger }) {
    return {
        async detectYieldAnomalies(cycleId) {
            try {
                const cycle = await prisma.plantingCycle.findUnique({
                    where: { id: cycleId },
                    include: {
                        farm: true,
                        plantSpecies: true,
                        batches: true,
                    },
                });

                if (!cycle) {
                    return { error: 'Cycle not found' };
                }

                const anomalies = [];

                // 1. Yield per area anomaly
                if (cycle.plotArea && cycle.actualYield) {
                    const yieldPerRai = cycle.actualYield / cycle.plotArea;
                    const avgYield = await this._getAverageYield(
                        cycle.plantSpeciesId,
                        cycle.cultivationType,
                    );

                    if (avgYield > 0) {
                        const deviation = Math.abs(yieldPerRai - avgYield) / avgYield;

                        if (deviation > 0.5) {
                            anomalies.push({
                                type: 'YIELD_ANOMALY',
                                severity: deviation > 1.0 ? 'HIGH' : 'MEDIUM',
                                description: `Yield ${deviation > 1.0 ? 'significantly' : 'moderately'} ${yieldPerRai > avgYield ? 'above' : 'below'} average`,
                                details: {
                                    actualYield: cycle.actualYield,
                                    plotArea: cycle.plotArea,
                                    yieldPerRai: Math.round(yieldPerRai * 100) / 100,
                                    averageYield: Math.round(avgYield * 100) / 100,
                                    deviation: `${Math.round(deviation * 100)}%`,
                                },
                                riskScore: deviation > 1.0 ? 60 : 40,
                            });
                        }
                    }
                }

                // 2. Harvest timing anomaly
                if (cycle.expectedHarvestDate && cycle.actualHarvestDate) {
                    const expected = new Date(cycle.expectedHarvestDate);
                    const actual = new Date(cycle.actualHarvestDate);
                    const diffDays = Math.abs(actual - expected) / (1000 * 60 * 60 * 24);

                    if (diffDays > 30) {
                        anomalies.push({
                            type: 'HARVEST_TIMING_ANOMALY',
                            severity: diffDays > 60 ? 'HIGH' : 'MEDIUM',
                            description: `Harvest ${diffDays > 60 ? 'significantly' : 'moderately'} ${actual > expected ? 'late' : 'early'}`,
                            details: {
                                expectedDate: cycle.expectedHarvestDate,
                                actualDate: cycle.actualHarvestDate,
                                differenceDays: Math.round(diffDays),
                            },
                            riskScore: diffDays > 60 ? 50 : 30,
                        });
                    }
                }

                // 3. Multiple harvests
                if (cycle.batches.length > 3) {
                    anomalies.push({
                        type: 'MULTIPLE_HARVESTS',
                        severity: 'MEDIUM',
                        description: `Unusual number of harvest batches (${cycle.batches.length})`,
                        riskScore: 35,
                    });
                }

                const totalRiskScore = anomalies.reduce((sum, a) => sum + a.riskScore, 0);

                return {
                    cycleId: cycle.id,
                    farmName: cycle.farm?.farmName,
                    analyzedAt: new Date().toISOString(),
                    riskScore: Math.min(totalRiskScore, 100),
                    riskLevel: this._calculateRiskLevel(totalRiskScore),
                    anomalies,
                    recommendations: this._generateRecommendations(anomalies),
                };

            } catch (error) {
                logger.error({
                    type: 'anomaly_detection_error',
                    error: error.message,
                    cycleId,
                }, 'Anomaly detection failed');
                throw error;
            }
        },

        async _getAverageYield(plantSpeciesId, cultivationType) {
            const cacheKey = `avg_yield:${plantSpeciesId}:${cultivationType}`;
            const cached = await cacheService.get(cacheKey);
            if (cached) {
                return cached;
            }

            // planting_cycles columns are camelCase (no @map in cultivation.prisma) —
            // Prisma quotes them, so unquoted snake_case identifiers fold to lowercase
            // and Postgres errors 42703 (undefined column). Quote the camelCase names
            // (matching the already-correct pc."plantSpeciesId").
            const result = await prisma.$queryRaw`
                SELECT AVG(pc."actualYield" / NULLIF(pc."plotArea", 0)) as avg_yield
                FROM planting_cycles pc
                WHERE pc."plantSpeciesId" = ${plantSpeciesId}
                AND pc."cultivationType" = ${cultivationType}
                AND pc."actualYield" IS NOT NULL
                AND pc."plotArea" IS NOT NULL
                AND pc."actualYield" > 0
            `;

            const avgYield = result[0]?.avg_yield || 0;
            await cacheService.set(cacheKey, avgYield, 86400);

            return avgYield;
        },

        async batchFraudDetection() {
            try {
                // Application has NO `farm` relation and NO `farmId` (the old
                // include:{farm} threw PrismaClientValidationError → endpoint always
                // 500'd; app.farmId was undefined). Linkage is via Entity
                // (Application.entityId === Farm.entityId) with an owner-chain fallback
                // (Farm.ownerId → User.canonicalId === Application.healthId) — the same
                // canonical linkage as _applicationIdsForFarm(), here in reverse.
                // Resolve the DISTINCT farms behind SUBMITTED apps, then run per-farm
                // duplicate detection (per-farm results are cached → natural dedup).
                const pendingApps = await prisma.application.findMany({
                    where: { status: 'SUBMITTED', isDeleted: false },
                    select: { entityId: true, healthId: true },
                });

                const entityIds = [...new Set(pendingApps.map((a) => a.entityId).filter(Boolean))];
                const healthIds = [...new Set(pendingApps.map((a) => a.healthId).filter(Boolean))];
                const farmIdSet = new Set();

                if (entityIds.length > 0) {
                    const byEntity = await prisma.farm.findMany({
                        where: { entityId: { in: entityIds }, isDeleted: false },
                        select: { id: true },
                    });
                    byEntity.forEach((f) => farmIdSet.add(f.id));
                }
                if (healthIds.length > 0) {
                    const owners = await prisma.user.findMany({
                        where: { canonicalId: { in: healthIds } },
                        select: { id: true },
                    });
                    const ownerIds = owners.map((o) => o.id);
                    if (ownerIds.length > 0) {
                        const byOwner = await prisma.farm.findMany({
                            where: { ownerId: { in: ownerIds }, isDeleted: false },
                            select: { id: true },
                        });
                        byOwner.forEach((f) => farmIdSet.add(f.id));
                    }
                }

                const results = [];

                for (const farmId of farmIdSet) {
                    const detection = await this.detectDuplicateFarms(farmId);
                    if (!detection || detection.error) { continue; }

                    results.push({
                        farmId,
                        riskScore: detection.riskScore,
                        riskLevel: detection.riskLevel,
                        findingsCount: Array.isArray(detection.findings) ? detection.findings.length : 0,
                    });
                }

                const highRisk = results.filter((r) => r.riskLevel === 'HIGH');
                const mediumRisk = results.filter((r) => r.riskLevel === 'MEDIUM');

                return {
                    analyzedAt: new Date().toISOString(),
                    totalAnalyzed: results.length,
                    highRisk: highRisk.length,
                    mediumRisk: mediumRisk.length,
                    lowRisk: results.length - highRisk.length - mediumRisk.length,
                    flaggedApplications: highRisk,
                };

            } catch (error) {
                logger.error({
                    type: 'batch_fraud_detection_error',
                    error: error.message,
                }, 'Batch fraud detection failed');
                throw error;
            }
        },
    };
}

module.exports = { createFraudAnomalyBatchMethods };
