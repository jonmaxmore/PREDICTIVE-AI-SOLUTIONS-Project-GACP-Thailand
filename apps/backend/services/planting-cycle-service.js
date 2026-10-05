/**
 * Planting Cycle Service — Extracted from routes/api/planting-cycles.js
 *
 * Contains all helper functions, constants, and reusable query logic
 * for planting cycle management.
 *
 * Route file imports from here instead of defining inline.
 */
const { prisma } = require('../services/prisma-database');
const qrcodeService = require('../services/qrcode/qrcode-service');
// Wave A chunk 3 (2026-07-02): cycle/farm ownership probes widen the legacy
// `farm.ownerId` pin to owner-OR-ACTIVE-entity-co-member (single predicate in
// services/farm-access.js). ensureCycleOwned → verifyOwnedCycle inherits this,
// which unpins every /:id/activities, /:id/harvest-batches, plant-units
// generate/confirm/reconcile and plot-qrs route in one move.
const { farmAccessWhere } = require('../services/farm-access');
const { plotAreaSqm } = require('../shared/area-utils');
// W1-3 (batch/lot identifier SSOT): single canonical batchNumber/lotNumber
// generator — see shared/harvest-identifiers.js header for the full
// before/after.
const { buildBatchNumber, buildLotNumber } = require('../shared/harvest-identifiers');

// ─── Constants ──────────────────────────────────────────────

// 'PLANT_UNIT' was removed from this set on 2026-08-25. No route honours it any
// more (spec R8 retires per-plant tracking), so leaving it admitted would let a
// caller create a cultivation log labelled PLANT_UNIT that is bound to no plant —
// a scope name for a resolution the platform no longer has.
const ALLOWED_ACTIVITY_SCOPE = new Set(['CYCLE', 'PLOT']);
const ALLOWED_ACTIVITY_TYPES = new Set([
    'IRRIGATION',
    'FERTILIZER',
    'PEST_CONTROL',
    'WEED_CONTROL',
    'INSPECTION',
    'INCIDENT',
    'OTHER',
]);

// ─── Helpers ────────────────────────────────────────────────

function getAuthenticatedUserId(req) {
    return String(req.user?.id || '').trim();
}

function toPositiveInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function normalizeActivityType(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'PESTICIDE') {
        return 'PEST_CONTROL';
    }
    if (normalized === 'WEEDING') {
        return 'WEED_CONTROL';
    }
    return normalized;
}

function normalizeActivityScope(value) {
    return String(value || 'CYCLE').trim().toUpperCase();
}

function normalizeAttachmentIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 10);
}

function toActivityResponse(log) {
    return {
        id: log.id,
        scope: log.scope,
        activityType: log.logType,
        activityDate: log.logDate,
        quantity: log.quantity,
        unit: log.unit,
        method: log.method,
        weather: log.weather,
        // ชื่อสาร + ผู้ปฏิบัติงาน — ทั้งคู่มีคอลัมน์และประตูรับค่าแล้ว แต่ projection นี้
        // ไม่เคยส่งกลับ ⇒ เกษตรกรกรอกได้แต่เปิดดูย้อนหลังไม่เห็น และผู้ตรวจถามก็ตอบไม่ได้
        // (ช่องเขียนอย่างเดียว — คลาสเดียวกับคอลัมน์ที่มีแต่ไม่มีใครถาม)
        productName: log.productName ?? null,
        performedBy: log.performedBy ?? null,
        note: log.notes,
        attachmentIds: Array.isArray(log.attachmentIds) ? log.attachmentIds : [],
        plotId: log.plotId,
        plot: log.plot ? { id: log.plot.id, name: log.plot.name } : null,
        // No `plantUnitId` / `plantUnit` keys. R8
        // (design note 2026-08-20-planting-tnt-design) retires
        // per-plant tracking, so an activity is reported against its cycle and
        // its plot and nothing finer — removed 2026-08-25.
        createdAt: log.createdAt,
        updatedAt: log.updatedAt,
    };
}

function buildPlotCycleEntityId(cyclePlot) {
    return String(cyclePlot?.id || '').trim();
}

function buildPlotCycleTracePath(qrCode) {
    return `plot-cycle/${encodeURIComponent(String(qrCode || '').trim())}`;
}

function sanitizeFarmAlias(farmName) {
    const value = String(farmName || '').trim();
    if (!value) {
        return 'Farm';
    }
    return `${value.slice(0, 2)}***`;
}

function normalizePackagingRows(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows
        .map((row, index) => {
            const item = row && typeof row === 'object' ? row : {};
            const packageType = String(item.packageType || item.packagingType || item.type || '').trim();
            const quantity = Number.parseInt(String(item.quantity ?? item.unitCount ?? item.count ?? 0), 10);
            const unitWeight = Number(item.unitWeight ?? item.weight ?? 0);
            const totalWeightRaw = Number(item.totalWeight ?? item.total_weight ?? (quantity * unitWeight));
            const totalWeight = Number.isFinite(totalWeightRaw) ? totalWeightRaw : 0;

            if (!packageType || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitWeight) || unitWeight <= 0 || !Number.isFinite(totalWeight) || totalWeight <= 0) {
                return null;
            }

            return {
                packageType,
                quantity,
                unitWeight,
                totalWeight,
                rowIndex: index,
            };
        })
        .filter(Boolean);
}

// W1-3 (batch/lot identifier SSOT): buildLotNumber/buildBatchNumber used to
// be defined here — this WAS the best implementation (transaction-scoped
// sequence, race-safe by construction) and is now promoted verbatim into
// shared/harvest-identifiers.js, imported above. Every other batch/lot-number
// call site in the codebase (certificate-service.js, harvest-service.js,
// traceability-service.js) now routes through that same SSOT. Unchanged
// call sites below (deps-injection into harvest-capacity-operations.js).

function toRoundedSqm(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function isReservedCycleStatus(status) {
    const normalized = String(status || '').toUpperCase();
    return !['HARVESTED', 'COMPLETED'].includes(normalized);
}

// ─── Payload Builders ───────────────────────────────────────

function buildPlotCyclePayload(cycle, assignment) {
    const method = String(assignment?.plot?.solarSystem || cycle?.cultivationType || 'OUTDOOR').toUpperCase();
    return {
        scope: 'RAW_MATERIAL_GACP',
        source: 'PLOT_CYCLE',
        farm: {
            id: cycle?.farm?.id || null,
            name: cycle?.farm?.farmName || null,
            alias: sanitizeFarmAlias(cycle?.farm?.farmName),
            district: cycle?.farm?.district || null,
            province: cycle?.farm?.province || null,
        },
        cycle: {
            cycleId: cycle?.id || null,
            cycleName: cycle?.cycleName || null,
            status: cycle?.status || null,
            startDate: cycle?.startDate || null,
            expectedHarvestDate: cycle?.expectedHarvestDate || null,
        },
        plot: {
            cyclePlotId: assignment?.id || null,
            plotId: assignment?.plot?.id || null,
            plotName: assignment?.plot?.name || null,
            allocatedAreaSqm: Number(assignment?.allocatedAreaSqm || 0),
            plannedPlantCount: Number(assignment?.plannedPlantCount || 0),
            cultivationMethod: method,
        },
        species: cycle?.plantSpecies
            ? {
                code: cycle.plantSpecies.code || null,
                nameTH: cycle.plantSpecies.nameTH || null,
                nameEN: cycle.plantSpecies.nameEN || null,
            }
            : null,
    };
}

// ─── Query Functions ────────────────────────────────────────

/**
 * Load a planting cycle that the user owns, with plot assignments.
 *
 * IMPORTANT: ownership and certificate-gating are separate concerns:
 *   - `loadOwnedCycleWithPlots` returns the cycle as long as the user owns
 *     the farm. It does NOT require a valid certificate, so owners can
 *     still view/manage their cycle when the certificate has expired.
 *   - Use `requireActiveCertificate(cycle)` to gate cert-restricted
 *     operations (harvest, batch creation, public QR generation).
 */
async function loadOwnedCycleWithPlots(cycleId, userId) {
    return prisma.plantingCycle.findFirst({
        where: {
            id: String(cycleId || ''),
            isDeleted: false,
            farm: {
                ...(await farmAccessWhere(userId)),
                isDeleted: false,
            },
        },
        include: {
            farm: {
                select: {
                    id: true,
                    farmName: true,
                    district: true,
                    province: true,
                },
            },
            plantSpecies: {
                select: {
                    id: true,
                    code: true,
                    nameTH: true,
                    nameEN: true,
                },
            },
            certificate: {
                select: {
                    id: true,
                    certificateNumber: true,
                    status: true,
                    issuedDate: true,
                    expiryDate: true,
                    isDeleted: true,
                },
            },
            cyclePlots: {
                include: {
                    plot: {
                        select: {
                            id: true,
                            name: true,
                            solarSystem: true,
                            // T8 — the permanent identity travels with the plot: the code that
                            // goes on the sign, plus the two marks saying whether a sign was
                            // ever printed and whether it was retired. Without these the plots
                            // tab said "ยังไม่มีรหัส" for every plot in the country.
                            plotCode: true,
                            qrIssuedAt: true,
                            qrRevokedAt: true,
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
            },
        },
    });
}

/**
 * Returns true when the cycle has an active, non-expired certificate.
 * Use this at the call site that performs a cert-gated action so the
 * caller can return a clear error code (CERT_EXPIRED / CERT_REQUIRED)
 * instead of a generic 404.
 */
function hasActiveCertificate(cycle) {
    const cert = cycle?.certificate;
    if (!cert || cert.isDeleted) { return false; }
    const status = String(cert.status || '').toLowerCase();
    if (status !== 'active') { return false; }
    if (cert.expiryDate && new Date(cert.expiryDate) < new Date()) { return false; }
    return true;
}

/**
 * S2 (adversarial-verify 2026-07-02): `options.forMutation` threads the
 * interim VIEWER floor into the access predicate — mutation call sites
 * (cycle create) pass it; reads stay byte-identical.
 */
async function verifyOwnedFarm(farmId, userId, options = {}) {
    if (!farmId || !userId) {
        return null;
    }

    return prisma.farm.findFirst({
        where: {
            id: String(farmId),
            ...(await farmAccessWhere(userId, { forMutation: options.forMutation === true })),
            isDeleted: false,
        },
        select: { id: true },
    });
}

/**
 * Owner check only — does not gate on certificate validity. Use the optional
 * `requireActiveCert: true` flag (or check `hasActiveCertificate` separately)
 * when the caller needs cert-gated actions.
 * S2: `options.forMutation` applies the VIEWER floor (see ensureCycleOwned).
 */
async function verifyOwnedCycle(cycleId, userId, options = {}) {
    if (!cycleId || !userId) {
        return null;
    }

    const where = {
        id: String(cycleId),
        isDeleted: false,
        farm: {
            ...(await farmAccessWhere(userId, { forMutation: options.forMutation === true })),
            isDeleted: false,
        },
    };

    if (options.requireActiveCert === true) {
        const now = new Date();
        where.certificateId = { not: null };
        where.certificate = {
            isDeleted: false,
            status: { in: ['active', 'ACTIVE'] },
            expiryDate: { gte: now },
        };
    }

    return prisma.plantingCycle.findFirst({
        where,
        select: { id: true, farmId: true },
    });
}

// `buildCycleIntegrity` was deleted on 2026-08-25. It asked the per-plant
// service for a quota (generated vs planned vs removed vs unassigned PlantUnit
// rows) and reported the drift as `traceabilityReady` / `overPlanCount`. R8 of
// design note 2026-08-20-planting-tnt-design retires per-plant
// tracking, so there is no quota to reconcile and no drift to report: the
// declared plant count is a number the farmer enters on the cycle and its plots,
// and nothing counts rows against it. Nothing replaces this function — callers
// stopped asking rather than asking something else.

/**
 * ป้าย QR ออกได้เมื่อแปลงนั้นมีใบรับรองที่ยังมีผล — "QR after cert only"
 *
 * ป้ายคือเครื่องหมายของระบบรับรองที่ปักอยู่บนที่ดินจริง คนเดินผ่านสแกนแล้วเห็นหน้าของระบบ
 * GACP ⇒ การออกป้ายใบใหม่ให้ที่ดินที่ใบรับรองหมดอายุหรือถูกเพิกถอน คือแพลตฟอร์มออก
 * เครื่องหมายรับรองให้พื้นที่ที่ไม่ได้รับการรับรองแล้ว
 *
 * วัดจริง 2026-09-06 ก่อนแก้: ทำให้ใบรับรองหมดอายุ แล้วยิงประตูออก QR → 201 พร้อมป้ายใหม่
 * ที่ถูกบันทึกไว้จริง และสแกนได้ 200 · การบันทึกรอบปลูกถูกบังคับข้อนี้แล้ว
 * (PLANTING_REQUIRES_CERTIFICATE) แต่การออกป้ายไม่เคยถูกถาม
 *
 * ป้ายที่ออกไปแล้วไม่ถูกแตะ — การยกเลิกป้ายเป็นการตัดสินใจที่ต้องมีคนสั่ง (qrRevokedAt)
 * ไม่ใช่ผลข้างเคียงของวันหมดอายุ
 */
async function assertCycleCertificateActive(cycle) {
    const certificateId = cycle?.certificateId ? String(cycle.certificateId) : null;
    const cert = certificateId
        ? await prisma.certificate.findUnique({
            where: { id: certificateId },
            select: { status: true, expiryDate: true, isDeleted: true, farmId: true },
        })
        : null;

    const active = Boolean(cert)
        && cert.isDeleted !== true
        && ['active', 'ACTIVE'].includes(String(cert.status || ''))
        && (!cert.expiryDate || new Date(cert.expiryDate) >= new Date())
        && String(cert.farmId || '') === String(cycle?.farmId || '');

    if (active) { return null; }
    return {
        generated: [],
        failed: [],
        missingCount: 0,
        status: 'failed',
        code: 'QR_REQUIRES_ACTIVE_CERTIFICATE',
        error: 'ออกป้าย QR ของแปลงได้เมื่อแปลงนี้มีใบรับรอง GACP ที่ยังมีผล '
            + 'หากใบรับรองหมดอายุหรือถูกเพิกถอน ให้ยื่นคำขอต่ออายุก่อน ป้ายที่ออกไปแล้วยังใช้ได้ตามเดิม',
    };
}

async function generatePlotCycleQrsForCycle(cycle) {
    const certificateRefusal = await assertCycleCertificateActive(cycle);
    if (certificateRefusal) { return certificateRefusal; }

    const assignments = Array.isArray(cycle?.cyclePlots) ? cycle.cyclePlots : [];
    if (assignments.length === 0) {
        return {
            generated: [],
            failed: [],
            missingCount: 0,
            status: 'failed',
            error: 'No plot assignments found for this cycle',
        };
    }

    const assignmentIds = assignments.map((assignment) => buildPlotCycleEntityId(assignment)).filter(Boolean);
    const existingRecords = assignmentIds.length > 0
        ? await prisma.traceQrSecurity.findMany({
            where: {
                entityType: 'PLANTING_CYCLE_PLOT',
                entityId: { in: assignmentIds },
                status: 'ACTIVE',
            },
            select: {
                entityId: true,
                qrCode: true,
                publicUrl: true,
            },
        })
        : [];

    const existingByEntityId = new Map(
        existingRecords.map((record) => [String(record.entityId), record]),
    );

    const generated = [];
    const failed = [];
    for (const assignment of assignments) {
        const entityId = buildPlotCycleEntityId(assignment);
        // Bug 8.4: register EACH plot independently. Before this, a single
        // registerTraceIntegrity failure threw out of the loop and discarded
        // every QR already generated for the cycle. Isolate the failure so the
        // remaining plots still get their QR + the caller receives a real
        // partial report (the old missingCount/`partial` branch was dead — every
        // pushed row always had a qrCode, so status was always 'generated').
        try {
            const existing = existingByEntityId.get(entityId);
            const qrCode = existing?.qrCode || qrcodeService.generateQRCodeId();
            const trackingUrl = existing?.publicUrl || qrcodeService.generatePublicTraceUrl(buildPlotCycleTracePath(qrCode));
            const payload = buildPlotCyclePayload(cycle, assignment);

            await qrcodeService.registerTraceIntegrity({
                entityType: 'PLANTING_CYCLE_PLOT',
                entityId,
                qrCode,
                publicUrl: trackingUrl,
                payload,
            });

            generated.push({
                cyclePlotId: entityId,
                plotId: assignment.plot?.id || null,
                plotName: assignment.plot?.name || null,
                qrCode,
                trackingUrl,
                cultivationMethod: String(assignment.plot?.solarSystem || cycle.cultivationType || 'OUTDOOR').toUpperCase(),
                allocatedAreaSqm: Number(assignment.allocatedAreaSqm || 0),
                plannedPlantCount: Number(assignment.plannedPlantCount || 0),
            });
        } catch (err) {
            logger.error(`[plot-cycle-qr] registration failed for cyclePlot ${entityId}: ${err?.message}`);
            failed.push({
                cyclePlotId: entityId,
                plotId: assignment.plot?.id || null,
                error: err?.message || 'trace integrity registration failed',
            });
        }
    }

    // missingCount now reflects the plots that FAILED to register (was always 0).
    const missingCount = failed.length;
    if (failed.length === 0) {
        return { generated, failed, missingCount, status: 'generated' };
    }
    if (generated.length > 0) {
        return { generated, failed, missingCount, status: 'partial' };
    }
    // Every plot failed — surface as a hard failure (the manual /plot-qrs
    // endpoint returns 400; the create-cycle automation pushes a warning)
    // rather than a misleading success with an empty result.
    return {
        generated,
        failed,
        missingCount,
        status: 'failed',
        error: `All ${failed.length} plot QR registration(s) failed`,
    };
}

// ─── Middleware ──────────────────────────────────────────────

// Wave B chunk 4 — per-permission gates layered ON TOP of ensureCycleOwned's
// reachability + interim VIEWER floor (the floor stays as defense-in-depth).
const { assertFarmActionPermission } = require('./entity-effective-permissions-service');

/**
 * Map the activity payload's type to its per-type permission code (owner
 * decision: activity permissions are PER-TYPE). Uses the same normalizer +
 * allow-set as the route handler, so legacy aliases (PESTICIDE/WEEDING) land
 * on the canonical code. Unknown type → null (the gate 400s BEFORE any
 * permission check).
 * @param {{ body?: { activityType?: string } }} req
 * @returns {string|null} e.g. 'ACTIVITY_IRRIGATION'
 */
function resolveActivityPermission(req) {
    const type = normalizeActivityType(req?.body?.activityType);
    if (!ALLOWED_ACTIVITY_TYPES.has(type)) {
        return null;
    }
    return `ACTIVITY_${type}`;
}

function getRequestPermissionCache(req) {
    if (!(req._entityPermCache instanceof Map)) {
        req._entityPermCache = new Map();
    }
    return req._entityPermCache;
}

/**
 * Inline-gate wrapper for route handlers that are NOT behind
 * ensureCycleOwned (e.g. POST / cycle create). Threads the per-request
 * effective-permission cache; denial errors propagate untouched so the
 * caller maps them to 403.
 */
async function assertFarmPermission({ farmId, farm, userId, permission, req }) {
    return assertFarmActionPermission({
        farmId,
        farm,
        userId,
        permission,
        cache: req ? getRequestPermissionCache(req) : undefined,
        // Spec 2026-09-30 §3.1 (R1): the farm read carries the holder scope.
        holderScope: req ? await require('./holder-access').holderScope(req) : null,
    });
}

/**
 * Express gate for /:id/* cycle mutations. MUST run AFTER ensureCycleOwned
 * (consumes req.cycleOwnership.farmId). Accepts a static permission code or
 * a resolver `(req) => code|null` (per-type activities).
 *
 * Semantics (binding plan):
 *   - legacy owner always passes (inside assertFarmActionPermission)
 *   - workspace member: effective permissions decide → 403
 *     ENTITY_PERMISSION_DENIED with the permission named
 *   - resolver → null (unknown activity type) → 400 BEFORE the check
 */
function requireCycleFarmPermission(permissionOrResolver) {
    return async function cycleFarmPermissionGate(req, res, next) {
        try {
            const permission = typeof permissionOrResolver === 'function'
                ? permissionOrResolver(req)
                : permissionOrResolver;
            if (!permission) {
                return res.status(400).json({ success: false, message: 'Invalid activityType' });
            }

            const userId = getAuthenticatedUserId(req);
            const farmId = req.cycleOwnership?.farmId;
            if (!userId || !farmId) {
                // ensureCycleOwned always sets cycleOwnership before this
                // gate; a missing value means the chain was mis-ordered —
                // fail closed with the same 404 shape.
                return res.status(404).json({ success: false, message: 'Planting cycle not found' });
            }

            await assertFarmActionPermission({
                farmId,
                userId,
                permission,
                cache: getRequestPermissionCache(req),
                // Spec 2026-09-30 §3.1 (R1): the farm read carries the holder scope.
                holderScope: await require('./holder-access').holderScope(req),
            });
            return next();
        } catch (error) {
            if (error?.code === 'ENTITY_PERMISSION_DENIED') {
                return res.status(403).json({
                    success: false,
                    code: 'ENTITY_PERMISSION_DENIED',
                    permission: error.permission || null,
                    error: 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน',
                });
            }
            logger.error('[cycle-permission-gate] unexpected failure:', error);
            return res.status(500).json({ success: false, error: 'Failed to verify permission' });
        }
    };
}

function ensureCycleOwned(req, res, next) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // S2 — method-derived VIEWER floor. Wave B fix M2: this middleware now
    // fronts ONLY the surfaces with NO per-permission gate (PATCH /:id cycle
    // update + the GET reads, where the floor is a no-op). Gated mutation
    // routes use ensureCycleReachable below so the engine — which reads
    // GRANT/REVOKE rows — is the sole mutation authority (a VIEWER holding
    // an explicit GRANT must not be 404'd before the engine runs).
    const method = String(req.method || '').toUpperCase();
    const forMutation = method !== 'GET' && method !== 'HEAD';

    return verifyOwnedCycle(req.params.id, userId, { forMutation }).then((cycle) => {
        if (!cycle) {
            return res.status(404).json({ success: false, message: 'Planting cycle not found' });
        }
        req.cycleOwnership = cycle;
        return next();
    });
}

/**
 * Wave B fix M2 — READ-shaped reachability for routes that carry a
 * per-permission gate (requireCycleFarmPermission) right after it. No
 * VIEWER floor here: the engine decides (VIEWER role default = [] so an
 * un-granted VIEWER is still denied — same net posture as the old floor,
 * but a GRANT now works). 404 semantics for non-members are unchanged.
 */
function ensureCycleReachable(req, res, next) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    return verifyOwnedCycle(req.params.id, userId).then((cycle) => {
        if (!cycle) {
            return res.status(404).json({ success: false, message: 'Planting cycle not found' });
        }
        req.cycleOwnership = cycle;
        return next();
    });
}

// ─── Full Handler Logic: POST /:id/harvest-batches ──────────

const { createHarvestCapacityOperations } = require('./planting-cycle/harvest-capacity-operations');
const PLOT_HARVEST_META_PREFIX = 'PLOT_HARVEST_META:';
const { createLogger } = require('../shared/logger');
const logger = createLogger('planting-cycle-service');
const {
    createHarvestBatches,
    getCapacitySummary,
} = createHarvestCapacityOperations({
    prisma,
    // No plantUnitService: the harvest operations no longer gate on or link
    // per-plant rows (spec R8 retired per-plant tracking).
    qrcodeService,
    plotAreaSqm,
    normalizePackagingRows,
    buildBatchNumber,
    buildLotNumber,
    toRoundedSqm,
    isReservedCycleStatus,
    PLOT_HARVEST_META_PREFIX,
    logger,
});

module.exports = {
    // Constants
    ALLOWED_ACTIVITY_SCOPE,
    ALLOWED_ACTIVITY_TYPES,
    PLOT_HARVEST_META_PREFIX,

    // Helpers
    getAuthenticatedUserId,
    toPositiveInt,
    normalizeActivityType,
    normalizeActivityScope,
    normalizeAttachmentIds,
    toActivityResponse,
    buildPlotCycleEntityId,
    buildPlotCycleTracePath,
    sanitizeFarmAlias,
    normalizePackagingRows,
    buildLotNumber,
    buildBatchNumber,
    buildPlotCyclePayload,
    toRoundedSqm,
    isReservedCycleStatus,

    // Query functions
    loadOwnedCycleWithPlots,
    hasActiveCertificate,
    verifyOwnedFarm,
    verifyOwnedCycle,
    generatePlotCycleQrsForCycle,

    // Full handler logic
    createHarvestBatches,
    getCapacitySummary,

    // Middleware
    ensureCycleOwned,
    ensureCycleReachable,

    // Wave B chunk 4 — per-permission gates
    resolveActivityPermission,
    requireCycleFarmPermission,
    assertFarmPermission,
};
