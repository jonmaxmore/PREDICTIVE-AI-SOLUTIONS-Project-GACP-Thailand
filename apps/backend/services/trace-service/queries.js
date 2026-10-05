const {
    prisma,
    qrcodeService,
    getRequestIp,
    logger,
} = require('./common');

async function findPlotCycleByQrCode(qrCode) {
    const encodedLookup = encodeURIComponent(qrCode);
    const legacyPublicPath = `/trace/plot-cycle/${encodedLookup}`;

    // Primary lookup
    let securityRecord = await prisma.traceQrSecurity.findFirst({
        where: {
            entityType: 'PLANTING_CYCLE_PLOT',
            OR: [
                { qrCode },
                { id: qrCode },
            ],
            isActive: true,
        },
        select: {
            id: true,
            entityId: true,
            payload: true,
            publicUrl: true,
            qrCode: true,
        },
    });

    // Legacy fallback: resolve from persisted publicUrl path
    if (!securityRecord) {
        securityRecord = await prisma.traceQrSecurity.findFirst({
            where: {
                entityType: 'PLANTING_CYCLE_PLOT',
                publicUrl: { contains: encodedLookup },
                isActive: true,
            },
            select: {
                id: true,
                entityId: true,
                payload: true,
                publicUrl: true,
                qrCode: true,
            },
        });
    }

    // Last-resort compatibility
    if (!securityRecord) {
        securityRecord = await prisma.traceQrSecurity.findFirst({
            where: {
                entityType: 'PLANTING_CYCLE_PLOT',
                OR: [
                    { qrCode },
                    { publicUrl: { contains: encodedLookup } },
                    { publicUrl: legacyPublicPath },
                ],
            },
            select: {
                id: true,
                entityId: true,
                payload: true,
                publicUrl: true,
                qrCode: true,
            },
        });
    }

    return securityRecord;
}

async function findLotByQrCode(qrCode) {
    return prisma.lot.findFirst({
        where: {
            OR: [
                { qrCode },
                { lotNumber: qrCode },
                { id: qrCode },
            ],
        },
        include: {
            batch: {
                include: {
                    farm: {
                        select: {
                            id: true, farmName: true,
                            farmType: true, province: true,
                            district: true,
                        },
                    },
                    cycle: {
                        include: {
                            certificate: {
                                select: {
                                    id: true, certificateNumber: true,
                                    standardName: true,
                                    issuedDate: true, expiryDate: true,
                                    status: true,
                                    application: {
                                        select: {
                                            labResults: true,
                                            labResultStatus: true,
                                            labName: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
}

async function findBatchById(batchId) {
    return prisma.harvestBatch.findFirst({
        where: {
            isDeleted: false,
            OR: [
                { id: batchId },
                { batchNumber: batchId },
                { qrCode: batchId },
            ],
        },
        include: {
            farm: {
                select: {
                    id: true, farmName: true,
                    province: true, district: true,
                },
            },
            cycle: {
                include: {
                    certificate: {
                        select: {
                            id: true, certificateNumber: true,
                            standardName: true,
                            issuedDate: true, expiryDate: true,
                            status: true,
                        },
                    },
                    plantSpecies: {
                        select: {
                            code: true, nameTH: true,
                            nameEN: true, scientificName: true,
                        },
                    },
                },
            },
            lots: {
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true, lotNumber: true,
                    packageType: true, quantity: true,
                    unitWeight: true, totalWeight: true,
                    trackingUrl: true,
                },
            },
        },
    });
}

async function findLotById(lotId) {
    return prisma.lot.findFirst({
        where: {
            isDeleted: false,
            OR: [
                { id: lotId },
                { lotNumber: lotId },
                { qrCode: lotId },
            ],
        },
        include: {
            batch: {
                include: {
                    farm: {
                        select: {
                            id: true, farmName: true,
                            farmType: true, province: true,
                            district: true,
                        },
                    },
                    cycle: {
                        include: {
                            certificate: {
                                select: {
                                    id: true, certificateNumber: true,
                                    standardName: true,
                                    issuedDate: true, expiryDate: true,
                                    status: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });
}

// `getPlotCyclePlantSummary` was deleted on 2026-08-25. It grouped and counted
// PlantUnit rows for a plot's trace summary — the exact read R8 of
// design note 2026-08-20-planting-tnt-design retires. It had no
// remaining callers even before the retirement; nothing replaces it, because a
// plot's plant count is now the declared plannedPlantCount on the assignment.

async function recordIntegrityScan(entityType, entityId, req) {
    try {
        return await qrcodeService.recordTraceScan(entityType, entityId, {
            requestIp: getRequestIp(req),
            userAgent: req.get('user-agent'),
            requestPath: req.originalUrl,
        });
    } catch (error) {
        logger.warn(`[trace] ${entityType} integrity verification failed`, {
            error: error.message,
            entityId,
        });
        return { available: false, valid: null };
    }
}

// ─── Response Builders ──────────────────────────────────────

module.exports = {
    findPlotCycleByQrCode,
    findLotByQrCode,
    findBatchById,
    findLotById,
    recordIntegrityScan,
};
