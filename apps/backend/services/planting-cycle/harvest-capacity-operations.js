// Wave A chunk 3 (2026-07-02): the capacity summary's farm scope widens from
// the legacy owner pin to owner-OR-ACTIVE-entity-co-member. Required directly
// (not injected) because the deps object predates the farm-access module.
const { farmAccessWhere } = require('../farm-access');
const { assessPreHarvestInterval } = require('./pre-harvest-interval');

function createHarvestCapacityOperations(deps) {
    const {
        prisma,
        qrcodeService,
        plotAreaSqm,
        normalizePackagingRows,
        buildBatchNumber,
        buildLotNumber,
        toRoundedSqm,
        isReservedCycleStatus,
        PLOT_HARVEST_META_PREFIX,
        logger,
    } = deps;

async function createHarvestBatches(cycleId, payload, actor) {
    const rawPlotHarvests = Array.isArray(payload.plotHarvests) ? payload.plotHarvests : [];
    const harvestDate = payload.harvestDate ? new Date(payload.harvestDate) : new Date();

    if (!Number.isFinite(harvestDate.getTime())) {
        return { status: 400, body: { success: false, message: 'harvestDate is invalid' } };
    }
    if (rawPlotHarvests.length === 0) {
        return { status: 400, body: { success: false, message: 'plotHarvests is required and must contain at least one plot' } };
    }

    // ── Load cycle with certificate + plots ──
    const cycle = await prisma.plantingCycle.findUnique({
        where: { id: cycleId },
        include: {
            certificate: { select: { id: true, status: true, expiryDate: true } },
            plantSpecies: { select: { code: true, nameTH: true, nameEN: true } },
            cyclePlots: {
                include: {
                    plot: { select: { id: true, name: true, solarSystem: true } },
                },
            },
            // No per-plant count is selected: the harvest resolves to the cycle
            // and its plots (spec R8), and nothing downstream counts plants.
        },
    });

    if (!cycle || cycle.isDeleted) {
        return { status: 404, body: { success: false, message: 'Cycle not found' } };
    }
    if (cycle.status === 'HARVESTED' || cycle.status === 'COMPLETED') {
        return { status: 400, body: { success: false, message: 'This cycle has already been harvested' } };
    }
    if (!cycle.certificateId) {
        return { status: 400, body: { success: false, message: 'Active certificate is required before harvest' } };
    }
    if (String(cycle.certificate?.status || '').toLowerCase() !== 'active') {
        return { status: 400, body: { success: false, message: 'Certificate is not active' } };
    }
    if (cycle.certificate?.expiryDate && new Date(cycle.certificate.expiryDate) < new Date()) {
        return { status: 400, body: { success: false, message: 'Certificate has expired' } };
    }
    // A harvest used to be refused here unless the cycle had PlantUnit rows, and
    // two further quota doors then measured those rows (over-plan, unassigned).
    // All three are gone. Per-plant tracking is retired (spec R8): granularity
    // ends at the plot, the cycle and the Lot, so no cycle has plant rows to
    // count and the quota doors could only ever inspect an empty set.
    //
    // What harvest requires is what remains: an unharvested cycle, an active
    // unexpired certificate, and at least one plot assignment carrying weights
    // that its packaging rows do not exceed.

    const assignments = Array.isArray(cycle.cyclePlots) ? cycle.cyclePlots : [];
    if (assignments.length === 0) {
        return { status: 400, body: { success: false, message: 'Cycle has no plot assignments' } };
    }

    // ── Validate & normalize plotHarvests ──
    const assignmentsById = new Map(assignments.map((a) => [String(a.id), a]));
    const seenCyclePlotIds = new Set();
    const normalizedPlotHarvests = [];

    for (const entry of rawPlotHarvests) {
        const item = entry && typeof entry === 'object' ? entry : {};
        const cyclePlotId = String(item.cyclePlotId || '').trim();
        if (!cyclePlotId) {
            return { status: 400, body: { success: false, message: 'cyclePlotId is required for each plotHarvest item' } };
        }
        if (seenCyclePlotIds.has(cyclePlotId)) {
            return { status: 400, body: { success: false, message: `Duplicate cyclePlotId: ${cyclePlotId}` } };
        }
        seenCyclePlotIds.add(cyclePlotId);

        const assignment = assignmentsById.get(cyclePlotId);
        if (!assignment) {
            return { status: 400, body: { success: false, message: `cyclePlotId does not belong to this cycle: ${cyclePlotId}` } };
        }

        const freshWeightKg = Number(item.freshWeightKg);
        if (!Number.isFinite(freshWeightKg) || freshWeightKg <= 0) {
            return { status: 400, body: { success: false, message: `freshWeightKg must be greater than 0 for cyclePlotId ${cyclePlotId}` } };
        }

        const packagingRows = normalizePackagingRows(item.packagingRows);
        if (packagingRows.length === 0) {
            return { status: 400, body: { success: false, message: `packagingRows is required for cyclePlotId ${cyclePlotId}` } };
        }

        const packagingTotal = packagingRows.reduce((sum, row) => sum + Number(row.totalWeight || 0), 0);
        if (packagingTotal - freshWeightKg > 0.0001) {
            return { status: 400, body: { success: false, message: `packaging total weight exceeds freshWeightKg for cyclePlotId ${cyclePlotId}` } };
        }

        normalizedPlotHarvests.push({
            cyclePlotId, assignment, freshWeightKg,
            qualityGrade: item.qualityGrade ? String(item.qualityGrade).trim() : null,
            notes: item.notes ? String(item.notes).trim() : null,
            packagingRows,
        });
    }

    if (assignments.length > 1 && normalizedPlotHarvests.length !== assignments.length) {
        return { status: 400, body: { success: false, message: 'plotHarvests must include all cycle plots before harvest can be completed' } };
    }

    // ── Prisma Transaction ──
    // STAGE A.2 (detokenize): stamp HarvestBatch.recordedBy with the non-PII
    // User UUID (actor.userId), NOT the national ID — matches the peer write
    // sites (harvest-batches.js / plant-units.js) and keeps the national ID out
    // of the dump. recordedBy is display-only (no where:{recordedBy} lookup).
    const actorRecordedBy = actor.userId || null;
    const created = await prisma.$transaction(async (tx) => {
        const batches = [];
        for (const harvestItem of normalizedPlotHarvests) {
            const batchNumber = await buildBatchNumber(tx);
            const batchQrCode = qrcodeService.generateQRCodeId();
            const source = {
                plotId: harvestItem.assignment.plot?.id || null,
                plotName: harvestItem.assignment.plot?.name || null,
                cyclePlotId: harvestItem.cyclePlotId,
                cycleId: cycle.id,
                cycleName: cycle.cycleName,
                cultivationMethod: String(harvestItem.assignment.plot?.solarSystem || cycle.cultivationType || 'OUTDOOR').toUpperCase(),
            };
            const notePayload = {
                sourceLevel: 'PLOT', source,
                createdFrom: 'HEALTH_HARVEST_BATCHES',
                createdAt: new Date().toISOString(),
                note: harvestItem.notes || null,
            };

            const createdBatch = await tx.harvestBatch.create({
                data: {
                    batchNumber, farmId: cycle.farmId, cycleId: cycle.id,
                    plantCode: cycle.plantSpecies?.code || null, harvestDate,
                    freshWeight: harvestItem.freshWeightKg,
                    dryWeight: harvestItem.packagingRows.reduce((sum, row) => sum + Number(row.totalWeight || 0), 0),
                    qualityGrade: harvestItem.qualityGrade,
                    notes: `${PLOT_HARVEST_META_PREFIX}${JSON.stringify(notePayload)}`,
                    status: 'PACKED', recordedBy: actorRecordedBy,
                    qrCode: batchQrCode, trackingUrl: null,
                },
                select: { id: true, batchNumber: true, qrCode: true, harvestDate: true, freshWeight: true, notes: true },
            });

            const batchTrackingUrl = qrcodeService.generatePublicTraceUrl(`batch/${createdBatch.id}`);
            const batch = await tx.harvestBatch.update({
                where: { id: createdBatch.id },
                data: { trackingUrl: batchTrackingUrl },
                select: { id: true, batchNumber: true, qrCode: true, trackingUrl: true, harvestDate: true, freshWeight: true, notes: true },
            });

            const lots = [];
            for (let index = 0; index < harvestItem.packagingRows.length; index += 1) {
                const row = harvestItem.packagingRows[index];
                const lotQrCode = qrcodeService.generateQRCodeId();
                const createdLot = await tx.lot.create({
                    data: {
                        lotNumber: buildLotNumber(batch.batchNumber, index),
                        batchId: batch.id,
                        packageType: row.packageType, quantity: row.quantity,
                        unitWeight: row.unitWeight, totalWeight: row.totalWeight,
                        packagedAt: harvestDate, qrCode: lotQrCode,
                        trackingUrl: null, status: 'PACKAGED', destinationType: 'RAW_MATERIAL',
                    },
                    select: { id: true, lotNumber: true, qrCode: true },
                });

                const lotTrackingUrl = qrcodeService.generatePublicTraceUrl(`lot/${createdLot.id}`);
                const lot = await tx.lot.update({
                    where: { id: createdLot.id },
                    data: { trackingUrl: lotTrackingUrl },
                    select: {
                        id: true, lotNumber: true, packageType: true, quantity: true,
                        unitWeight: true, totalWeight: true, qrCode: true, trackingUrl: true,
                    },
                });
                lots.push(lot);
            }

            batches.push({ batch, lots, source });
        }

        await tx.plantingCycle.update({
            where: { id: cycle.id },
            data: {
                status: 'HARVESTED', actualHarvestDate: harvestDate,
                actualYield: normalizedPlotHarvests.reduce((sum, item) => sum + item.freshWeightKg, 0),
            },
        });

        return batches;
    });

    // ── Integrity registration ──
    const integrityTasks = [];
    for (const item of created) {
        integrityTasks.push(
            qrcodeService.registerTraceIntegrity({
                entityType: 'HARVEST_BATCH', entityId: item.batch.id,
                qrCode: item.batch.qrCode, publicUrl: item.batch.trackingUrl,
                payload: {
                    scope: 'RAW_MATERIAL_GACP',
                    source: {
                        plot: { plotId: item.source.plotId, plotName: item.source.plotName, cyclePlotId: item.source.cyclePlotId },
                        cycle: { cycleId: item.source.cycleId, cycleName: item.source.cycleName },
                        cultivationMethod: item.source.cultivationMethod,
                    },
                    batchId: item.batch.id, batchNumber: item.batch.batchNumber,
                    harvestDate: item.batch.harvestDate, totalHarvestWeight: item.batch.freshWeight,
                    lotCount: item.lots.length,
                },
            }),
        );

        for (const lot of item.lots) {
            integrityTasks.push(
                qrcodeService.registerTraceIntegrity({
                    entityType: 'PACKAGING_LOT', entityId: lot.id,
                    qrCode: lot.qrCode, publicUrl: lot.trackingUrl,
                    payload: {
                        scope: 'RAW_MATERIAL_GACP',
                        source: {
                            plot: { plotId: item.source.plotId, plotName: item.source.plotName, cyclePlotId: item.source.cyclePlotId },
                            cycle: { cycleId: item.source.cycleId, cycleName: item.source.cycleName },
                            cultivationMethod: item.source.cultivationMethod,
                        },
                        lotId: lot.id, lotNumber: lot.lotNumber, batchId: item.batch.id,
                        packagingType: lot.packageType, unitWeight: lot.unitWeight,
                        unitCount: lot.quantity, totalWeight: lot.totalWeight,
                    },
                }),
            );
        }
    }

    await Promise.all(integrityTasks).catch((error) => {
        logger.warn('Failed to persist integrity records for harvest-batches:', error);
    });

    // A loop stood here that called plantUnitService.linkToBatch once per batch
    // and reported the total as `linkedPlantUnits` — the field that showed 500
    // linked plants in the walk that prompted this removal. Per-plant tracking is
    // retired (spec R8), so the link and its field are deleted rather than
    // reported as zero: a zero would read as "measured and empty".
    //
    // Everything the harvest actually produces is already durable at this point:
    // the batch rows, the lot rows and the cycle's HARVESTED status committed in
    // the transaction above, and the QR integrity records awaited just before
    // this. Removing the linking cost a response field and nothing else.
    // PHI (ระยะปลอดภัยหลังพ่นสาร) — คำเตือน ไม่ใช่การปฏิเสธ ดูเหตุผลใน
    // pre-harvest-interval.js · ล้มเหลว = ไม่มีคำเตือน ไม่ใช่การเก็บเกี่ยวล้ม
    const phiWarning = await assessPreHarvestInterval({
        prisma, cycleId, harvestDate: new Date(payload.harvestDate),
    }).catch(() => null);

    return {
        status: 201,
        body: {
            success: true,
            message: 'Harvest batches created successfully',
            data: {
                cycleId, sourceLevel: 'PLOT',
                batchCount: created.length,
                batches: created.map((item) => ({ batch: item.batch, lots: item.lots, source: item.source })),
                // null เมื่อไม่มีการพ่นในหน้าต่างเฝ้าระวัง — หน้าจอโชว์เมื่อมีเท่านั้น
                phiWarning,
            },
        },
    };
}

/**
 * Get capacity summary for a user's farms.
 * Full business logic extracted from GET /capacity/summary handler.
 *
 * @param {string} userId
 * @param {string} [farmIdFilter] - Optional farm ID filter
 * @returns {Promise<{ status: number, body: object }>}
 */
async function getCapacitySummary(userId, farmIdFilter, { holderScope = null } = {}) {
    if (!userId) {
        return { status: 401, body: { success: false, error: 'Unauthorized' } };
    }

    const farmWhere = {
        ...(await farmAccessWhere(userId)),
        isDeleted: false,
        ...(farmIdFilter ? { id: farmIdFilter } : {}),
    };

    const farms = await prisma.farm.findMany({
        where: farmWhere,
        select: { id: true, farmName: true },
    });

    if (farms.length === 0) {
        return {
            status: 200,
            body: {
                success: true,
                data: {
                    scope: farmIdFilter ? 'FARM' : 'ALL',
                    allowedAreaSqm: 0, reservedAreaSqm: 0,
                    remainingAreaSqm: 0, overReservedAreaSqm: 0,
                    farmBreakdown: [],
                },
            },
        };
    }

    const farmIds = farms.map((f) => String(f.id));
    const now = new Date();
    const [activeCertificates, plots, reservedCycles] = await Promise.all([
        prisma.certificate.findMany({
            where: {
                farmId: { in: farmIds },
                isDeleted: false, status: { in: ['active', 'ACTIVE'] },
                expiryDate: { gte: now },
                // A health door passes its holder scope: the certificates its holders
                // hold. Without one the filer where stays.
                ...(holderScope && Array.isArray(holderScope.readIds)
                    ? require('../holder-access').holderReadWhere(holderScope, 'Certificate')
                    : { userId: String(userId) }),
            },
            select: { farmId: true },
        }),
        prisma.plot.findMany({
            where: { farmId: { in: farmIds } },
            select: { farmId: true, areaSqm: true, area: true, areaUnit: true },
        }),
        prisma.plantingCycle.findMany({
            where: { farmId: { in: farmIds }, isDeleted: false },
            select: {
                id: true, farmId: true, status: true,
                cyclePlots: { select: { allocatedAreaSqm: true } },
            },
        }),
    ]);

    const activeFarmIds = new Set(
        activeCertificates.map((item) => String(item.farmId || '').trim()).filter(Boolean),
    );
    const farmNameById = new Map(farms.map((f) => [String(f.id), f.farmName || null]));

    const allowedByFarmId = new Map();
    for (const plot of plots) {
        const farmId = String(plot.farmId || '').trim();
        if (!activeFarmIds.has(farmId)) { continue; }
        const areaSqm = plotAreaSqm(plot);
        allowedByFarmId.set(farmId, Number(allowedByFarmId.get(farmId) || 0) + Number(areaSqm || 0));
    }

    const reservedByFarmId = new Map();
    for (const cycle of reservedCycles) {
        if (!isReservedCycleStatus(cycle.status)) { continue; }
        const farmId = String(cycle.farmId || '').trim();
        if (!activeFarmIds.has(farmId)) { continue; }
        const cycleReserved = Array.isArray(cycle.cyclePlots)
            ? cycle.cyclePlots.reduce((sum, a) => sum + Number(a.allocatedAreaSqm || 0), 0)
            : 0;
        reservedByFarmId.set(farmId, Number(reservedByFarmId.get(farmId) || 0) + Number(cycleReserved || 0));
    }

    const targetFarmIds = Array.from(activeFarmIds.values()).filter((fid) => farmIds.includes(fid));
    const farmBreakdown = targetFarmIds.map((farmId) => {
        const allowed = Number(allowedByFarmId.get(farmId) || 0);
        const reserved = Number(reservedByFarmId.get(farmId) || 0);
        return {
            farmId,
            farmName: farmNameById.get(farmId) || null,
            allowedAreaSqm: toRoundedSqm(allowed),
            reservedAreaSqm: toRoundedSqm(reserved),
            remainingAreaSqm: toRoundedSqm(Math.max(0, allowed - reserved)),
            overReservedAreaSqm: toRoundedSqm(Math.max(0, reserved - allowed)),
        };
    });

    const allowedAreaSqm = toRoundedSqm(farmBreakdown.reduce((s, f) => s + Number(f.allowedAreaSqm || 0), 0));
    const reservedAreaSqm = toRoundedSqm(farmBreakdown.reduce((s, f) => s + Number(f.reservedAreaSqm || 0), 0));
    const overReservedAreaSqm = toRoundedSqm(farmBreakdown.reduce((s, f) => s + Number(f.overReservedAreaSqm || 0), 0));
    const remainingAreaSqm = toRoundedSqm(Math.max(0, allowedAreaSqm - reservedAreaSqm));

    return {
        status: 200,
        body: {
            success: true,
            data: {
                scope: farmIdFilter ? 'FARM' : 'ALL',
                allowedAreaSqm, reservedAreaSqm, remainingAreaSqm, overReservedAreaSqm,
                farmBreakdown,
            },
        },
    };
}

// ─── Module Exports ─────────────────────────────────────────

    return {
        createHarvestBatches,
        getCapacitySummary,
    };
}

module.exports = {
    createHarvestCapacityOperations,
};
