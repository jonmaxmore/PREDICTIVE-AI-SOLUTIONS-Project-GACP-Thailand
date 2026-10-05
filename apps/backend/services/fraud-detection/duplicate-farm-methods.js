// Great-circle distance in metres (haversine). Replaces the postgres
// cube/earthdistance functions (not installed) used by the old geo-duplicate
// raw SQL. Same formula as fraud-detection's document GPS check.
function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (Number(d) * Math.PI) / 180;
    const R = 6371000; // Earth radius (m)
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function createFraudDuplicateFarmMethods({ prisma, cacheService, logger }) {
    return {
        async detectDuplicateFarms(farmId) {
            try {
                await this.ensureLibraries();

                const farm = await prisma.farm.findUnique({
                    where: { id: farmId },
                    select: {
                        id: true,
                        farmName: true,
                        ownerId: true,
                        entityId: true,
                        latitude: true,
                        longitude: true,
                    },
                });

                if (!farm) {
                    return { error: 'Farm not found' };
                }

                const findings = [];
                let totalRiskScore = 0;

                // 1. Geographic proximity check
                const geoDuplicates = await this._checkGeographicDuplicates(farm);
                if (geoDuplicates.length > 0) {
                    findings.push({
                        type: 'GEOGRAPHIC_DUPLICATE',
                        severity: 'HIGH',
                        description: `Found ${geoDuplicates.length} farm(s) within ${this.thresholds.DUPLICATE_DISTANCE}m`,
                        details: geoDuplicates,
                        riskScore: this.thresholds.DUPLICATE_FARM_RISK,
                    });
                    totalRiskScore += this.thresholds.DUPLICATE_FARM_RISK;
                }

                // 2. Same owner, different farms
                const ownerFarms = await this._checkOwnerMultipleFarms(farm);
                if (ownerFarms.length > 1) {
                    findings.push({
                        type: 'MULTIPLE_FARMS_SAME_OWNER',
                        severity: 'MEDIUM',
                        description: `Owner has ${ownerFarms.length} registered farms`,
                        details: ownerFarms,
                        riskScore: 30,
                    });
                    totalRiskScore += 30;
                }

                // 3. ID card cross-check. Applications are linked to the farm via
                // Entity (Application.entityId === Farm.entityId), with an owner-based
                // fallback for the migration window — see _applicationIdsForFarm().
                // try/catch stays purely defensive (one sub-check must not 500 the
                // whole analyze).
                let idDuplicates = [];
                try { idDuplicates = await this._checkIdCardDuplicates(farm); }
                catch (e) { logger.warn('[fraud] ID-card duplicate check skipped: ' + (e?.message || e)); }
                if (idDuplicates.length > 0) {
                    findings.push({
                        type: 'ID_CARD_DUPLICATE',
                        severity: 'HIGH',
                        description: 'ID card used for multiple applications',
                        details: idDuplicates,
                        riskScore: 80,
                    });
                    totalRiskScore += 80;
                }

                // 4. Photo similarity check — applications resolved via the same
                // Entity/owner linkage as the ID-card check. try/catch defensive only.
                let photoDuplicates = [];
                try { photoDuplicates = await this._checkPhotoDuplicates(farm); }
                catch (e) { logger.warn('[fraud] photo duplicate check skipped: ' + (e?.message || e)); }
                if (photoDuplicates.length > 0) {
                    findings.push({
                        type: 'PHOTO_DUPLICATE',
                        severity: 'HIGH',
                        description: 'Similar photos found in other applications',
                        details: photoDuplicates,
                        riskScore: 75,
                    });
                    totalRiskScore += 75;
                }

                const riskLevel = this._calculateRiskLevel(totalRiskScore);

                // NOTE: Farm has NO fraudScore/fraudChecked/fraudCheckedAt columns —
                // this update threw PrismaClientValidationError → /fraud-detection/
                // farms/:id/analyze (single + batch) 500'd. The fraud result is
                // persisted to the cache below (`fraud:farm:<id>`, 1h), which is the
                // actual store; the broken Farm.update is removed. (If durable
                // persistence is needed, add the columns to Farm in a migration.)

                const result = {
                    farmId: farm.id,
                    farmName: farm.farmName,
                    analyzedAt: new Date().toISOString(),
                    riskScore: Math.min(totalRiskScore, 100),
                    riskLevel,
                    findings,
                    recommendations: this._generateRecommendations(findings),
                };

                await cacheService.set(`fraud:farm:${farmId}`, result, 3600);

                logger.info({
                    type: 'fraud_detection_complete',
                    farmId,
                    riskScore: result.riskScore,
                    riskLevel,
                    findingsCount: findings.length,
                }, 'Fraud detection analysis completed');

                return result;

            } catch (error) {
                logger.error({
                    type: 'fraud_detection_error',
                    error: error.message,
                    farmId,
                }, 'Fraud detection failed');
                throw error;
            }
        },

        async _checkGeographicDuplicates(farm) {
            // Previously a raw $queryRaw using snake_case columns
            // (f.farm_name / f.is_deleted — the real columns are camelCase
            // "farmName"/"isDeleted") AND the postgres cube/earthdistance
            // functions (ll_to_earth/earth_distance) which are NOT installed on
            // this database → POST /fraud-detection/farms/:id/analyze threw
            // (42703 + undefined-function) and 500'd UNCONDITIONALLY. Compute
            // distance in JS (haversine) over the candidate farms instead — the
            // same approach the working GET /farms/duplicates path uses. At GACP
            // farm volumes the in-memory scan is well within budget.
            if (farm.latitude == null || farm.longitude == null) { return []; }
            const threshold = Number(this.thresholds.DUPLICATE_DISTANCE);
            const candidates = await prisma.farm.findMany({
                where: {
                    id: { not: farm.id },
                    isDeleted: false,
                    latitude: { not: null },
                    longitude: { not: null },
                },
                select: {
                    id: true, farmName: true, latitude: true, longitude: true,
                    province: true, district: true,
                },
            });
            const out = [];
            for (const f of candidates) {
                const distance = haversineMeters(farm.latitude, farm.longitude, f.latitude, f.longitude);
                if (Number.isFinite(distance) && distance < threshold) {
                    out.push({
                        farmId: f.id,
                        farmName: f.farmName,
                        distance: Math.round(distance),
                        province: f.province,
                        district: f.district,
                    });
                }
            }
            out.sort((a, b) => a.distance - b.distance);
            return out;
        },

        async _checkOwnerMultipleFarms(farm) {
            if (!farm.ownerId) {
                return [];
            }

            return await prisma.farm.findMany({
                where: {
                    ownerId: farm.ownerId,
                    isDeleted: false,
                },
                select: {
                    id: true,
                    farmName: true,
                    province: true,
                    createdAt: true,
                },
            });
        },

        // Resolve the application IDs associated with a farm (linkage Option 1,
        // 2026-06-08). There is NO direct Application↔Farm FK; the legal applicant
        // and the farm owner are both modelled as an Entity, so an application and
        // its farm share the same entityId (Application.entityId === Farm.entityId).
        // During the Wave-B migration window entityId may still be null, so fall
        // back to the owner chain: Farm.ownerId → User.id → User.canonicalId →
        // Application.healthId. Returns [] when nothing resolves. (Previously these
        // checks queried Application.farmId / included application.farm — neither
        // exists — so they threw and were degraded to no-ops; this restores them.)
        async _applicationIdsForFarm(farm) {
            if (farm.entityId) {
                const apps = await prisma.application.findMany({
                    where: { entityId: farm.entityId, isDeleted: false },
                    select: { id: true },
                });
                if (apps.length > 0) { return apps.map((a) => a.id); }
            }
            if (farm.ownerId) {
                const owner = await prisma.user.findUnique({
                    where: { id: farm.ownerId },
                    select: { canonicalId: true },
                });
                if (owner?.canonicalId) {
                    const apps = await prisma.application.findMany({
                        where: { healthId: owner.canonicalId, isDeleted: false },
                        select: { id: true },
                    });
                    return apps.map((a) => a.id);
                }
            }
            return [];
        },

        async _checkIdCardDuplicates(farm) {
            const appIds = await this._applicationIdsForFarm(farm);
            if (appIds.length === 0) { return []; }

            // ID-card documents on this farm's applications.
            const ownDocs = await prisma.applicationDocument.findMany({
                where: {
                    applicationId: { in: appIds },
                    documentType: { contains: 'ID' },
                    idNumber: { not: null },
                },
                select: { idNumber: true },
            });
            const idNumbers = [...new Set(ownDocs.map((d) => d.idNumber).filter(Boolean))];
            if (idNumbers.length === 0) { return []; }

            // Same ID number used by OTHER applications (one batched query).
            const dups = await prisma.applicationDocument.findMany({
                where: {
                    idNumber: { in: idNumbers },
                    applicationId: { notIn: appIds },
                },
                select: { idNumber: true, applicationId: true },
            });

            const grouped = new Map(); // idNumber → Set<applicationId>
            for (const d of dups) {
                if (!grouped.has(d.idNumber)) { grouped.set(d.idNumber, new Set()); }
                grouped.get(d.idNumber).add(d.applicationId);
            }

            const findings = [];
            for (const [idNumber, appSet] of grouped) {
                findings.push({
                    idNumber: this._maskIdNumber(idNumber),
                    usedInApplications: [...appSet].map((applicationId) => ({ applicationId })),
                });
            }
            return findings;
        },

        async _checkPhotoDuplicates(farm) {
            const appIds = await this._applicationIdsForFarm(farm);
            if (appIds.length === 0) { return []; }

            const photos = await prisma.applicationDocument.findMany({
                where: {
                    applicationId: { in: appIds },
                    documentType: { contains: 'PHOTO' },
                    photoHash: { not: null },
                },
                select: { id: true, photoHash: true },
            });
            if (photos.length === 0) { return []; }

            const photoIds = photos.map((p) => p.id);
            const hashes = [...new Set(photos.map((p) => p.photoHash))];

            // Same photo hash in OTHER applications' documents (one batched query).
            const allSimilar = await prisma.applicationDocument.findMany({
                where: {
                    photoHash: { in: hashes },
                    id: { notIn: photoIds },
                },
                select: { id: true, photoHash: true, applicationId: true },
            });

            const byHash = new Map();
            for (const sim of allSimilar) {
                if (!byHash.has(sim.photoHash)) { byHash.set(sim.photoHash, []); }
                byHash.get(sim.photoHash).push({
                    photoId: sim.id,
                    applicationId: sim.applicationId,
                    similarity: 'EXACT_MATCH',
                });
            }

            const findings = [];
            for (const photo of photos) {
                const similarPhotos = byHash.get(photo.photoHash);
                if (similarPhotos && similarPhotos.length > 0) {
                    findings.push({ photoId: photo.id, similarPhotos });
                }
            }
            return findings;
        },
    };
}

module.exports = { createFraudDuplicateFarmMethods };
