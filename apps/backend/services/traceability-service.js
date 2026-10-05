const { prisma } = require('./prisma-database');
const { findUserByHealthIdSecurely } = require('./user-lookup-service');
// PDPA close-natid-round4 — mask the raw national-ID actorIdentity before it is
// persisted into PlantingCycle.notes (AUTO_TRACE_META JSON, a dump-readable text
// column with no PDPA encrypt hook). See ensureAutoTraceCycle below + the twin
// in services/traceability/auto-first-cycle-trace.js.
const { maskThaiId } = require('../utils/field-encryption');
const qrcodeService = require('./qrcode/qrcode-service');
const logger = require('../shared/logger');
const {
  auditLogger,
  AuditCategory,
  AuditSeverity,
  ResourceType,
} = require('../middleware/audit-logger');
// W1-3 (batch/lot identifier SSOT): single canonical batchNumber/lotNumber
// generator — see shared/harvest-identifiers.js header for the full
// before/after. This file used to define its OWN racy count()+1
// buildBatchNumber (a duplicate of the sequence-safe one in
// planting-cycle-service.js) plus a byte-for-byte duplicate buildLotNumber.
const { buildBatchNumber, buildLotNumber } = require('../shared/harvest-identifiers');
// ฟาร์มบนหน้าสาธารณะถามด้วยชุดเดียวกับที่ตอบ — เหตุผลเต็มที่หัวไฟล์นั้น
const { PUBLIC_FARM_SELECT } = require('./trace-service/public-farm');
const { PUBLIC_PLANT_SELECT } = require('./trace-service/public-plant');
const labEvidence = require('./lab-evidence-service');
const { localYear } = require('../utils/working-days');

const AUTO_TRACE_META_PREFIX = 'AUTO_TRACE_META:';
const EPSILON = 0.0001;

// Service-layer whitelist for findTraceEntityById. The route layer has its own
// VERIFY_ENTITY_TYPES map (string → modelName), but the service must also
// enforce the whitelist so callers that bypass the route cannot probe arbitrary
// Prisma models (e.g. findTraceEntityById('user', id) to leak PII).
const ALLOWED_TRACE_MODEL_NAMES = Object.freeze(new Set([
  'harvestBatch',
  'lot',
  'plantingCycle',
]));

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAutoTraceMeta(notes) {
  const raw = String(notes || '').trim();
  if (!raw || !raw.startsWith(AUTO_TRACE_META_PREFIX)) {
    return null;
  }
  const payload = raw.slice(AUTO_TRACE_META_PREFIX.length);
  try {
    const parsed = JSON.parse(payload);
    return asObject(parsed);
  } catch (_error) {
    return null;
  }
}

function buildAutoTraceNote(meta) {
  return `${AUTO_TRACE_META_PREFIX}${JSON.stringify(meta || {})}`;
}

function normalizePackagingRow(row, index) {
  const item = asObject(row);
  const packagingType = String(
    item.packaging_type
    || item.packagingType
    || item.packageType
    || item.type
    || item.name
    || '',
  ).trim();
  const unitWeight = toNumber(
    item.unit_weight
    || item.unitWeight
    || item.weightKg
    || item.weight
    || 0,
    0,
  );
  const unitCount = toInteger(
    item.unit_count
    || item.unitCount
    || item.quantity
    || item.count
    || item.units
    || 0,
    0,
  );
  const computedTotal = unitWeight * unitCount;
  const totalWeight = toNumber(item.total_weight || item.totalWeight || computedTotal, computedTotal);

  if (!packagingType || unitWeight <= 0 || unitCount <= 0 || totalWeight <= 0) {
    return null;
  }

  return {
    packagingType,
    unitWeight,
    unitCount,
    totalWeight,
    rowIndex: index,
    raw: item,
  };
}

function extractApplicationPackagingRows(formData) {
  const data = asObject(formData);
  const harvestData = asObject(data.harvestData);

  const arrayCandidates = [
    data.applicationPackaging,
    data.packagingRows,
    data.packagingPlan,
    data.packagingPlans,
    harvestData.packagingRows,
    harvestData.packagingPlan,
    harvestData.packagingPlans,
    harvestData.packagingDetails,
    data.lots,
  ];

  for (const candidate of arrayCandidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) {
      continue;
    }

    const normalized = candidate
      .map((row, index) => normalizePackagingRow(row, index))
      .filter(Boolean);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const legacyPackaging = String(
    harvestData.packaging
    || data.packaging
    || '',
  ).trim();
  if (!legacyPackaging) {
    return [];
  }

  const fallbackCount = toInteger(
    harvestData.unitCount
    || harvestData.packagingUnitCount
    || harvestData.quantity
    || 0,
    0,
  );
  const fallbackWeight = toNumber(
    harvestData.unitWeight
    || harvestData.packagingUnitWeight
    || 0,
    0,
  );

  if (fallbackCount > 0 && fallbackWeight > 0) {
    return [{
      packagingType: legacyPackaging,
      unitWeight: fallbackWeight,
      unitCount: fallbackCount,
      totalWeight: fallbackWeight * fallbackCount,
      rowIndex: 0,
      raw: {
        packagingType: legacyPackaging,
        unitWeight: fallbackWeight,
        unitCount: fallbackCount,
      },
    }];
  }

  return [];
}

function resolveDeclaredHarvestWeight(formData, packagingRows) {
  const data = asObject(formData);
  const harvestData = asObject(data.harvestData);
  const productionData = asObject(data.productionData);
  const packagingTotal = packagingRows.reduce((sum, row) => sum + row.totalWeight, 0);
  const declaredCandidates = [
    harvestData.totalHarvestWeight,
    harvestData.totalWeight,
    harvestData.expectedYield,
    data.totalHarvestWeight,
    data.totalWeight,
    productionData.estimatedYield,
    data.estimatedYield,
  ];
  for (const candidate of declaredCandidates) {
    const parsed = toNumber(candidate, 0);
    if (parsed > 0) {
      return Math.max(parsed, packagingTotal);
    }
  }
  return packagingTotal;
}

async function resolveFarmIdForApplication(tx, application) {
  const ownerHealthId = String(application.healthId || '').trim();
  if (!ownerHealthId) {
    return null;
  }
  const owner = await findUserByHealthIdSecurely(ownerHealthId, {
    select: { id: true },
    client: tx,
  });
  const ownerId = owner?.id || null;
  if (!ownerId) {
    return null;
  }

  const formData = asObject(application.formData);
  const farmData = asObject(formData.farmData);
  const requestedFarmId = String(
    farmData.id
    || formData.farmId
    || formData.locationData?.farmId
    || '',
  ).trim();

  if (requestedFarmId) {
    const owned = await tx.farm.findFirst({
      where: {
        id: requestedFarmId,
        ownerId,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (owned?.id) {
      return owned.id;
    }
  }

  const fallbackFarm = await tx.farm.findFirst({
    where: {
      ownerId,
      isDeleted: false,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return fallbackFarm?.id || null;
}

async function resolvePlantSpeciesIdForTrace(tx, formData) {
  const data = asObject(formData);
  const lookupTokens = [
    data.plantCode,
    data.plantId,
    data.plantName,
    asObject(data.productionData).plantName,
  ]
    .map((token) => String(token || '').trim())
    .filter(Boolean);

  for (const token of lookupTokens) {
    const byCode = await tx.plantSpecies.findFirst({
      where: {
        code: {
          equals: token,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });
    if (byCode?.id) {
      return byCode.id;
    }

    const byName = await tx.plantSpecies.findFirst({
      where: {
        OR: [
          {
            nameTH: {
              equals: token,
              mode: 'insensitive',
            },
          },
          {
            nameEN: {
              equals: token,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: { id: true },
    });
    if (byName?.id) {
      return byName.id;
    }
  }

  const fallback = await tx.plantSpecies.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return fallback?.id || null;
}

async function ensureAutoTraceCycle(tx, {
  application,
  farmId,
  certificateId,
  actorIdentity,
}) {
  if (!certificateId) {
    return null;
  }

  const existingCycle = await tx.plantingCycle.findFirst({
    where: {
      farmId,
      certificateId,
      isDeleted: false,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existingCycle?.id) {
    return existingCycle.id;
  }

  const speciesId = await resolvePlantSpeciesIdForTrace(tx, application.formData);
  if (!speciesId) {
    throw new Error('Unable to resolve plant species for trace cycle creation');
  }

  const cycleNumber = (await tx.plantingCycle.count({
    where: {
      farmId,
      isDeleted: false,
    },
  })) + 1;

  const buddhistYear = localYear() + 543; // Bangkok year
  const cycle = await tx.plantingCycle.create({
    data: {
      cycleName: `AUTO-CYCLE-${buddhistYear}-${cycleNumber}`,
      cycleNumber,
      farmId,
      certificateId,
      plantSpeciesId: speciesId,
      startDate: new Date(),
      status: 'HARVESTED',
      cultivationType: 'SELF_GROWN',
      notes: buildAutoTraceNote({
        traceSource: 'AUTO_FIRST_CYCLE',
        createdFrom: 'AUTO',
        applicationId: application.id,
        applicationNumber: application.applicationNumber,
        // PDPA close-natid-round4 — mask the raw national-ID actor identity
        // before persisting to PlantingCycle.notes (see the import-site note).
        actorIdentity: actorIdentity ? maskThaiId(actorIdentity) : null,
      }),
    },
    select: { id: true },
  });

  return cycle.id;
}

// W1-3: buildBatchNumber/buildLotNumber used to be defined here (a racy
// count()+1 duplicate of planting-cycle-service's sequence-safe version, plus
// a byte-for-byte duplicate of its buildLotNumber). Both now come from the
// shared/harvest-identifiers SSOT (imported at the top of this file) —
// unchanged call sites below, unchanged behaviour for buildLotNumber.

// Bug 6.3 — lab-test status is EXPLICIT, never auto-derived from URL presence.
// The farmer MAY self-attest PASS, but only by sending it explicitly; merely
// attaching a report URL no longer flips a lot to PASSED (that silently vouched
// for an unverified/failed report), and FAILED is now representable. Defaults to
// PENDING when the caller omits the field.
const LOT_TEST_STATUSES = Object.freeze(['PENDING', 'PASSED', 'FAILED']);

function normalizeLotTestStatus(value) {
  if (value === undefined || value === null || value === '') {
    return 'PENDING';
  }
  const normalized = String(value).trim().toUpperCase();
  if (!LOT_TEST_STATUSES.includes(normalized)) {
    const err = new Error(
      `Invalid testStatus '${value}' (allowed: ${LOT_TEST_STATUSES.join(', ')})`,
    );
    err.code = 'INVALID_TEST_STATUS';
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

async function logAction({
  action,
  actorId,
  actorRole,
  resourceId,
  ipAddress,
  userAgent,
  metadata,
  severity = AuditSeverity.INFO,
}) {
  await auditLogger.log({
    category: AuditCategory.APPLICATION,
    action,
    severity,
    actorId: actorId || 'SYSTEM',
    actorRole: actorRole || 'SYSTEM',
    actorType: 'SYSTEM',
    resourceType: ResourceType.APPLICATION,
    resourceId: resourceId || 'UNKNOWN',
    ipAddress: ipAddress || 'system',
    userAgent: userAgent || 'traceability-service',
    metadata: metadata || {},
  });
}

async function logQrGenerated({
  actorId,
  actorRole,
  applicationId,
  entityType,
  entityId,
  qrCode,
  trackingUrl,
  ipAddress,
  userAgent,
}) {
  await logAction({
    action: 'QR_GENERATED',
    actorId,
    actorRole,
    resourceId: applicationId,
    ipAddress,
    userAgent,
    metadata: {
      entityType,
      entityId,
      qrCode,
      trackingUrl,
    },
  });
}

const { autoCreateFirstCycleTraceForPassedAudit: autoCreateFirstCycleTraceForPassedAuditCore } = require('./traceability/auto-first-cycle-trace');

async function autoCreateFirstCycleTraceForPassedAudit(args) {
  return autoCreateFirstCycleTraceForPassedAuditCore(args, {
    prisma,
    qrcodeService,
    logger,
    AUTO_TRACE_META_PREFIX,
    EPSILON,
    extractApplicationPackagingRows,
    resolveFarmIdForApplication,
    ensureAutoTraceCycle,
    resolveDeclaredHarvestWeight,
    buildBatchNumber,
    buildLotNumber,
    buildAutoTraceNote,
    logAction,
    logQrGenerated,
  });
}

function isAutoTraceBatch(batch) {
  const notes = typeof batch === 'string' ? batch : batch?.notes;
  const parsed = parseAutoTraceMeta(notes);
  return parsed?.traceSource === 'AUTO_FIRST_CYCLE';
}

// ─────────────────────────────────────────────────────────────────────────
// Batch 15 (2026-05-16) — Lot CRUD + public trace reads
//
// Used by routes/api/trace/lots.js, trace-batch-lot-routes.js,
// trace-verification-routes.js. Prior to this batch those routes hit
// prisma.lot / prisma.harvestBatch / prisma.traceQrSecurity /
// prisma.plantingCycle directly with bespoke include shapes. Keeping
// the projection shapes here means the public-facing "scan this QR"
// endpoints return a consistent payload + the trace-evidence chain
// stays in one file (DTAM 5-year retention; e-Transactions Act s.12).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Replaces routes/api/trace/lots.js:53 prisma.harvestBatch.findUnique
 * — verifyBatchOwnership helper. Returns just the farmId for the
 * ownership check.
 */
async function findHarvestBatchFarmId(batchId) {
  return prisma.harvestBatch.findUnique({
    where: { id: batchId },
    select: { farmId: true },
  });
}

/**
 * Replaces routes/api/trace/lots.js:107 prisma.harvestBatch.findUnique
 * — read of a batch with existing lots so the route can compute the
 * weight quota before creating a new lot.
 */
async function findHarvestBatchWithLots(batchId) {
  return prisma.harvestBatch.findUnique({
    where: { id: batchId },
    include: { lots: true },
  });
}

/**
 * Replaces routes/api/trace/lots.js:144 prisma.lot.count
 * — lot count for the canonical lot-number suffix calculation.
 */
async function countLotsByBatch(batchId) {
  return prisma.lot.count({ where: { batchId } });
}

/*
 * createLot() was removed on 2026-08-23.
 *
 * It wrote a lot straight to the database with no weight-quota check, and nothing
 * called it — the real path is createLotWithQuotaCheck() below. An unguarded
 * creator sitting in the export list is not dead code, it is a trap: the next
 * person who needs to create a lot finds the shorter name first, and the
 * overselling cap that the whole traceability chain rests on is simply skipped.
 */

/**
 * Service-layer lot creation with weight-quota enforcement.
 *
 * GACP compliance: a lot's weight must not cause the batch's cumulative
 * packaged weight to exceed the batch's dryWeight (preferred) or freshWeight.
 * Overselling is a certification breach — this validation lives at the
 * service layer so it is enforced regardless of the caller (route, job, test).
 *
 * @param {string} batchId
 * @param {object} lotData — same shape as createLot(data)
 * @returns {Promise<object>} created lot
 * @throws {{ code: 'LOT_WEIGHT_QUOTA_EXCEEDED' }} when quota is breached
 */
async function createLotWithQuotaCheck(batchId, lotData) {
  if (!batchId) {
    throw Object.assign(new Error('batchId is required'), { code: 'VALIDATION_ERROR' });
  }

  // Bug 5.3 (TOCTOU): the old path read the batch + lots, computed the quota,
  // then created — with NO lock between read and write. Two concurrent lot
  // creates both observed the same used-weight and both passed, over-issuing
  // past the batch weight cap (a GACP certification breach).
  //
  // Fix: run the quota read + lot create inside a single interactive
  // $transaction and take a SELECT … FOR UPDATE row lock on the batch. The lock
  // serialises concurrent writers on the SAME batch (pgbouncer-safe — one
  // interactive tx, explicit row lock, no advisory-lock cross-statement state).
  // The remaining-quota is recomputed INSIDE the locked scope so the second
  // writer sees the first writer's committed lot.
  return prisma.$transaction(async (tx) => {
    // Acquire the row lock first. If the batch does not exist, the lock query
    // returns no rows → 404. This is the authoritative existence check.
    const locked = await tx.$queryRaw`
      SELECT "id" FROM "harvest_batches" WHERE "id" = ${batchId} FOR UPDATE
    `;
    if (!Array.isArray(locked) || locked.length === 0) {
      throw Object.assign(new Error(`Harvest batch ${batchId} not found`), { code: 'NOT_FOUND' });
    }

    // Read the (now lock-stable) batch inside the same tx.
    const batch = await tx.harvestBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw Object.assign(new Error(`Harvest batch ${batchId} not found`), { code: 'NOT_FOUND' });
    }

    const limitWeight = Number(batch.dryWeight || batch.freshWeight || 0);

    // Bug #22 (carpet-bomb-inversion audit 2026-07-06) — FAIL CLOSED on a
    // non-positive weight limit. This guard used to be `if (limitWeight > 0)`, so a
    // batch whose dryWeight AND freshWeight resolve to 0/null fell straight THROUGH
    // the quota check → the sole overselling cap was DISABLED and unbounded packaged
    // lots could mint off a weightless batch, each QR-certifying arbitrary GACP
    // quantities. An owner CAN reach this state: the batch PUT does not validate
    // weights and they are not immutable ({freshWeight:0,dryWeight:0}). A missing/
    // zero limit is NOT "no limit"; it means "no available weight" → reject. A real
    // positive limit still permits allocation up to it (enforced unconditionally
    // below, since limitWeight > 0 is now guaranteed past this point).
    if (!(limitWeight > 0)) {
      throw Object.assign(
        new Error(
          `Lot weight quota exceeded: batch ${batchId} has no positive fresh/dry `
          + `weight recorded (limit ${limitWeight}kg) — no lot weight can be allocated.`,
        ),
        {
          code: 'LOT_WEIGHT_QUOTA_EXCEEDED',
          limit: limitWeight,
          used: 0,
          requested: Number(lotData.totalWeight || 0),
          remaining: 0,
        },
      );
    }

    // 5.3 (adversarial-verify): the used-weight SUM must EXCLUDE soft-deleted
    // lots. A nested include is NOT soft-delete-filtered → it would sum
    // tombstoned lots and fail-CLOSED (false-reject a legitimate lot). A
    // TOP-LEVEL aggregate goes through the soft-delete extension; belt-and-
    // suspenders, we also pin isDeleted:false explicitly.
    const usedAgg = await tx.lot.aggregate({
      where: { batchId, isDeleted: false },
      _sum: { totalWeight: true },
    });

    // A printed label does not stop existing because its row was deleted.
    //
    // Excluding tombstones is right for lots that never left the system, and the
    // comment above says why. It is wrong for one case: once a lot's QR label has
    // been PRINTED, a physical code exists on a bag somewhere. Soft-deleting that
    // row handed its weight back to the quota, so the same harvest could be
    // packaged again while the first labels were still in circulation certifying
    // the same produce — delete, re-issue, repeat, without ever tripping the cap.
    //
    // printedAt is the honest discriminator: it is set when the label is first
    // printed (schema/trace.prisma:47) and markLotAsPrinted only ever sets it once,
    // guarding on `printedAt: null`. A lot deleted BEFORE printing still returns
    // its weight, because nothing physical was issued.
    //
    // Counted as a second aggregate rather than by widening the first, so the
    // original exclusion stays exactly as written and reviewable.
    const printedTombstoneAgg = await tx.lot.aggregate({
      where: { batchId, isDeleted: true, printedAt: { not: null } },
      _sum: { totalWeight: true },
    });

    const usedWeight = Number(usedAgg._sum.totalWeight || 0)
      + Number(printedTombstoneAgg._sum.totalWeight || 0);
    const newWeight = Number(lotData.totalWeight || 0);
    const projected = usedWeight + newWeight;
    if (projected > limitWeight + EPSILON) {
      throw Object.assign(
        new Error(
          `Lot weight quota exceeded: batch limit ${limitWeight}kg, `
          + `used ${usedWeight}kg, requested ${newWeight}kg.`,
        ),
        {
          code: 'LOT_WEIGHT_QUOTA_EXCEEDED',
          limit: limitWeight,
          used: usedWeight,
          requested: newWeight,
          remaining: Math.max(0, limitWeight - usedWeight),
        },
      );
    }

    // Bug 5.5 (adversarial-verify MF): allocate the lotNumber ONCE, under the
    // FOR UPDATE lock (which already serialises concurrent writers on this batch,
    // so there is no concurrency collision to retry). We do NOT loop-retry inside
    // the interactive tx: Prisma 5.22 has no per-statement savepoint, so a P2002
    // aborts the whole tx and the next tx.* call would throw (500, not 409). The
    // suffix count spans soft-deleted rows (raw, extension-unfiltered) so a future
    // tombstoned lotNumber cannot collide with a fresh one. buildLotNumber handles
    // ≥26 (A..Z then -27..). An explicit caller-supplied lotNumber is honoured.
    let lotNumber = lotData.lotNumber;
    if (!lotNumber) {
      const rawCount = await tx.$queryRaw`SELECT COUNT(*)::int AS c FROM "lots" WHERE "batchId" = ${batchId}`;
      const c = Array.isArray(rawCount) && rawCount[0] ? Number(rawCount[0].c) : 0;
      lotNumber = buildLotNumber(batch.batchNumber, c);
    }
    try {
      return await tx.lot.create({ data: { ...lotData, batchId, lotNumber } });
    } catch (error) {
      if (error?.code === 'P2002') {
        const conflict = new Error('Could not allocate a unique lot number');
        conflict.code = 'LOT_NUMBER_CONFLICT';
        conflict.statusCode = 409;
        conflict.cause = error;
        throw conflict;
      }
      throw error;
    }
  });
}

/**
 * Replaces routes/api/trace/lots.js:179 prisma.lot.update
 * — second-step update used right after create to bind the trackingUrl
 * (which needs the lot id that only exists after create returns).
 */
async function updateLotTrackingUrl(id, trackingUrl) {
  return prisma.lot.update({
    where: { id },
    data: { trackingUrl },
  });
}

/**
 * Replaces routes/api/trace/lots.js:303 prisma.lot.findUnique
 * — full lot detail with batch + farm + plant + cycle includes used by
 * GET /api/lots/:id.
 */
async function findLotDetailById(id) {
  return prisma.lot.findUnique({
    where: { id },
    include: {
      batch: {
        include: {
          farm: {
            select: {
              id: true,
              farmName: true,
              province: true,
              district: true,
              ownerId: true,
            },
          },
          plant: {
            select: { code: true, nameTH: true, nameEN: true },
          },
          cycle: {
            select: {
              cycleName: true,
              startDate: true,
              certificateId: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Replaces routes/api/trace/lots.js:387 prisma.lot.findUnique
 * — narrow projection used by PUT /api/lots/:id to perform the print-
 * lock check + ownership probe without pulling the full include tree.
 */
async function findLotForUpdate(id) {
  return prisma.lot.findUnique({
    where: { id },
    include: { batch: { select: { farmId: true, notes: true } } },
  });
}

/**
 * Replaces routes/api/trace/lots.js:460 prisma.lot.update
 * — update with the post-update include used by PUT /api/lots/:id.
 */
async function updateLotWithFarmInclude(id, data) {
  return prisma.lot.update({
    where: { id },
    data,
    include: {
      batch: {
        include: {
          farm: {
            select: {
              id: true,
              farmName: true,
              province: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Replaces routes/api/trace/trace-batch-lot-routes.js:24 prisma.harvestBatch.findFirst
 * — public trace lookup, OR-match on id/batchNumber/qrCode with full
 * include shape used by GET /api/trace/batch/:batchId.
 */
async function findPublicBatchByAnyIdentifier(identifier) {
  return prisma.harvestBatch.findFirst({
    where: {
      isDeleted: false,
      OR: [
        { id: identifier },
        { batchNumber: identifier },
        { qrCode: identifier },
      ],
    },
    include: {
      // T12/T13 (2026-09-06): เส้นนี้เคยขอแค่ชื่อ/อำเภอ/จังหวัด ทำให้มติที่เปิดที่อยู่เป็นจริง
      // เฉพาะบนประตู /api/trace/:qr ส่วนประตูนี้ยังตอบเหมือนก่อนมติ · id ขอเพิ่มเอง (ใช้ภายใน)
      farm: { select: { ...PUBLIC_FARM_SELECT, id: true } },
      // ห้องปฏิบัติการตรวจ "รุ่น" — COA ของรุ่นนี้จึงโหลดมาพร้อมกัน ไม่ต้องยิงคิวรีรอบสอง
      labResults: { where: { isDeleted: false }, orderBy: { uploadedAt: 'desc' } },
      cycle: {
        select: {
          id: true,
          // A3-layer-2b (audit 2026-07-06): expose the cycle's owning farmId so the
          // public route can drop a cross-farm cert (batch.cycle.farmId !== batch.farmId)
          // in-memory, without a per-request plantingCycle.findUnique. farmId is an
          // internal id already effectively exposed via the farm relation — not PII.
          farmId: true,
          cycleName: true,
          startDate: true,
          certificate: {
            select: {
              certificateNumber: true,
              expiryDate: true,
              issuedDate: true,
              status: true,
            },
          },
        },
      },
      lots: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          lotNumber: true,
          packageType: true,
          quantity: true,
          unitWeight: true,
          totalWeight: true,
          trackingUrl: true,
        },
      },
    },
  });
}

/**
 * Replaces routes/api/trace/trace-batch-lot-routes.js:126
 * and trace-batch-lot-routes.js:287 prisma.traceQrSecurity.findFirst
 * — ACTIVE QR-security row for a given entity, used to source the
 * normalised payload that drives the trace response.
 */
async function findActiveTraceIntegrityRecord(entityType, entityId) {
  return prisma.traceQrSecurity.findFirst({
    where: {
      entityType,
      entityId,
      status: 'ACTIVE',
    },
    select: {
      payload: true,
    },
  });
}

/**
 * Replaces routes/api/trace/trace-batch-lot-routes.js:233 prisma.lot.findFirst
 * — public trace lookup, OR-match on id/lotNumber/qrCode with full
 * include shape used by GET /api/trace/lot/:lotId.
 */
async function findPublicLotByAnyIdentifier(identifier) {
  return prisma.lot.findFirst({
    where: {
      isDeleted: false,
      OR: [
        { id: identifier },
        { lotNumber: identifier },
        { qrCode: identifier },
      ],
    },
    include: {
      batch: {
        include: {
          // ชุดเดียวกับประตูอีกเส้น — id ขอเพิ่มเอง ไม่เคยถูกตีพิมพ์ออกไป
          farm: { select: { ...PUBLIC_FARM_SELECT, id: true } },
          // มติ operator 2026-09-07 (ข้อ 7 รายงาน 5 ฝ่าย): หน้าสแกนผู้ซื้อ "บอก" ชื่อพืช
          // — ขอเฉพาะสี่คอลัมน์ของ toPublicPlant ไม่ยกแถวทะเบียน (บทเรียน 7717859f)
          plant: { select: { ...PUBLIC_PLANT_SELECT } },
          // T11: ล็อตไม่เคยมี COA ของตัวเอง — มันสืบทอดจากรุ่นที่มันมา
          labResults: { where: { isDeleted: false }, orderBy: { uploadedAt: 'desc' } },
          cycle: {
            select: {
              id: true,
              // A3-layer-2b (audit 2026-07-06): expose the cycle's owning farmId so the
              // public lot route can drop a cross-farm cert (batch.cycle.farmId !==
              // batch.farmId) in-memory, without a per-request plantingCycle.findUnique.
              // farmId is an internal id already exposed via the farm relation — not PII.
              farmId: true,
              cycleName: true,
              certificate: {
                select: {
                  certificateNumber: true,
                  expiryDate: true,
                  issuedDate: true,
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

/**
 * "ฟาร์มนี้มีผลตรวจกี่ฉบับ" — คำกล่าวอ้างของ **ฟาร์ม** ไม่ใช่ของล็อตที่อยู่ในมือคนสแกน
 * (lab-evidence-service ปฏิเสธที่จะยุบสองอันนี้เป็นบูลีนเดียว และนี่คือฝั่งข้อมูลของมัน)
 *
 * คืนแค่ marker พอให้ *นับ* ได้: ไม่ดึงชื่อแล็บ เลขที่รายงาน หรือไฟล์ของรุ่นอื่นในฟาร์มเดียวกัน
 * ออกมาให้หลุด · อ่านไม่ได้ = ปล่อยให้ผู้เรียกตัดสินใจ ผู้เรียกทั้งสองเส้นเลือก 0 ไม่ใช่ล้ม
 * เพราะบรรทัดของฟาร์มเป็นข้อมูลเสริม ส่วนบรรทัดของล็อตมาจากรุ่นที่โหลดมาแล้ว
 */
async function findFarmLabResultMarkers(farmId) {
  return labEvidence.findFarmLabResultMarkers(prisma, farmId);
}

/**
 * Replaces routes/api/trace/trace-verification-routes.js:33
 * — generic existence probe used by /api/trace/verify/:entityType/:entityId
 * to confirm the entity exists before recording a scan. The allow-list
 * is enforced at the route level (VERIFY_ENTITY_TYPES); this method
 * just dispatches to the right model based on the resolved name.
 */
async function findTraceEntityById(modelName, entityId) {
  // Guard at service layer: reject any modelName not in the explicit whitelist.
  // The route layer has its own VERIFY_ENTITY_TYPES map, but any caller that
  // bypasses the route (background jobs, tests, other services) would still hit
  // this check — preventing arbitrary Prisma model access.
  if (!ALLOWED_TRACE_MODEL_NAMES.has(modelName)) {
    throw Object.assign(
      new Error(`findTraceEntityById: modelName '${modelName}' is not in the allowed list`),
      { code: 'INVALID_ENTITY_TYPE' },
    );
  }
  const model = prisma[modelName];
  if (!model || typeof model.findFirst !== 'function') { return null; }
  return model.findFirst({
    where: { id: entityId, isDeleted: false },
    select: { id: true },
  });
}

/**
 * Replaces routes/api/trace/trace-verification-routes.js:114 prisma.plantingCycle.findFirst
 * — cycle lookup with farm include for the ownership check in
 * POST /api/trace/generate (CYCLE branch).
 */
async function findCycleWithFarmForTrace(cycleId) {
  return prisma.plantingCycle.findFirst({
    where: { id: cycleId },
    include: { farm: true },
  });
}

/**
 * Replaces routes/api/trace/trace-verification-routes.js:136 prisma.harvestBatch.findFirst
 * — batch lookup with farm include for the ownership check in
 * POST /api/trace/generate (BATCH branch).
 */
async function findBatchWithFarmForTrace(batchId) {
  return prisma.harvestBatch.findFirst({
    where: { id: batchId },
    include: { farm: true },
  });
}

/**
 * Replaces routes/api/trace/trace-verification-routes.js:150 prisma.harvestBatch.update
 * — writes a freshly generated trace QR onto the batch row.
 */
async function updateBatchTraceQr(id, { qrCode, trackingUrl }) {
  return prisma.harvestBatch.update({
    where: { id },
    data: {
      qrCode,
      trackingUrl,
    },
  });
}

/**
 * Replaces routes/api/trace/lots.js:42 prisma.farm.findMany
 * — getUserFarmIds helper inside lots.js. Mirrors
 * farm-service.listOwnerFarmIds so lots.js can drop its inline copy.
 */
async function listOwnerFarmIdsForTrace(ownerId, { holderScope = null } = {}) {
  if (!ownerId) {
    return [];
  }
  // A health door passes its holder scope: the farms of the caller's holders
  // (the farm-access fragment, spec 2026-09-30 §3.1). Without one the owner where stays.
  const scoped = require('./holder-access').holderReadWhereIfScoped(holderScope, 'Farm');
  const farms = await prisma.farm.findMany({
    where: {
      ...(Object.keys(scoped).length > 0 ? scoped : { ownerId }),
      isDeleted: false,
    },
    select: { id: true },
  });
  return farms.map(f => f.id);
}


/**
 * The farms whose lots the caller may WRITE (create, update, print, labels): the
 * farms the caller OWNS (Farm.ownerId), the pre-R2 gate of every lot door
 * (cc87292a). T&T is frozen, so R2 Task 12 does not widen lot writes to the other
 * members of a farm's holder; only lot READS follow membership
 * (listOwnerFarmIdsForTrace). A health door passes its holder scope: the read
 * then also carries the farm-access fragment (registered for the read witness),
 * so an owner whose membership on the farm's holder is no longer ACTIVE is not
 * given back a write.
 */
async function listWritableFarmIdsForTrace(ownerId, { holderScope = null } = {}) {
  if (!ownerId) {
    return [];
  }
  const scoped = require('./holder-access').holderReadWhereIfScoped(holderScope, 'Farm');
  const farms = await prisma.farm.findMany({
    where: { ...scoped, AND: [{ ownerId }], isDeleted: false },
    select: { id: true },
  });
  return farms.map(f => f.id);
}

/**
 * Replaces routes/api/helpers/lots-label-routes.js:15 prisma.lot.findUnique
 * — single-lot label print path. Same farm-ownership include shape used
 * by the batch label endpoint so the route can run one ownership probe.
 */
async function findLotForLabel(id) {
  return prisma.lot.findUnique({
    where: { id },
    include: {
      batch: {
        include: {
          farm: { select: { id: true, farmName: true, ownerId: true } },
        },
      },
    },
  });
}

/**
 * Replaces routes/api/helpers/lots-label-routes.js:67 prisma.lot.findMany
 * — batch label print path. Caller validates ownership against
 * `listOwnerFarmIdsForTrace`.
 */
async function findLotsForBatchLabels(lotIds) {
  return prisma.lot.findMany({
    where: { id: { in: lotIds } },
    include: {
      batch: {
        include: {
          farm: { select: { id: true, farmName: true, ownerId: true } },
        },
      },
    },
  });
}

/**
 * Replaces routes/api/helpers/lots-utility-routes.js:17 prisma.lot.findUnique
 * — read-side existence/print-lock probe for POST /api/lots/:id/print.
 */
async function findLotForPrintCheck(id) {
  return prisma.lot.findUnique({ where: { id } });
}

/**
 * Replaces routes/api/helpers/lots-utility-routes.js:37 prisma.lot.update
 * — mark a lot as printed (locks future edits). Status flip + printedAt
 * timestamp are written atomically by Prisma so a partial commit cannot
 * leave the row "printed but unlocked".
 *
 * Atomic print-lock claim: the `where` is scoped to `printedAt: null` so the
 * null→timestamp flip is conditional. Two concurrent POST /:id/print calls
 * both read printedAt=null in the route's TOCTOU probe, but only one update
 * matches the {id, printedAt: null} predicate — the race loser's update hits
 * P2025 and is surfaced as LOT_ALREADY_PRINTED. This guarantees exactly-once
 * print semantics (one lock event, one audit row) instead of a double flip.
 * (Same optimistic-claim pattern as payment-slip-service.js:829.)
 */
async function markLotAsPrinted(id) {
  try {
    return await prisma.lot.update({
      where: { id, printedAt: null },
      data: {
        printedAt: new Date(),
        status: 'PRINTED',
      },
    });
  } catch (err) {
    // P2025 = no row matched {id, printedAt: null}. Callers verify existence +
    // ownership before reaching here, so a miss means a concurrent request
    // already claimed the print-lock. The lock is a one-way latch — the loser
    // must NOT re-flip status or emit a second print; signal already-printed.
    if (err?.code === 'P2025') {
      throw Object.assign(
        new Error(`Lot ${id} is already printed`),
        { code: 'LOT_ALREADY_PRINTED' },
      );
    }
    throw err;
  }
}

/**
 * Replaces routes/api/helpers/lots-utility-routes.js:73 prisma.lot.findUnique
 * — narrow projection used by GET /api/lots/:id/qr (image bytes only).
 */
async function findLotQrPayload(id) {
  return prisma.lot.findUnique({
    where: { id },
    select: { qrCode: true, trackingUrl: true },
  });
}

/**
 * Replaces routes/api/helpers/lots-utility-routes.js:110 prisma.lot.findUnique
 * — print-label payload with batch + farm + plant includes for the
 * client-side renderer.
 */
async function findLotPrintLabelPayload(id) {
  return prisma.lot.findUnique({
    where: { id },
    include: {
      batch: {
        include: {
          farm: {
            // BUG-FIX (carpet 2026-06-05): Farm has no `farmNameTH` column —
            // selecting it made prisma.lot.findUnique throw "Unknown field" for
            // EVERY id, so GET /api/lots/:id/qr/print returned 500 on all input
            // (not just bad ids). Farm exposes only `farmName`.
            select: { farmName: true, province: true },
          },
          plant: { select: { nameTH: true, nameEN: true } },
        },
      },
    },
  });
}

/**
 * Replaces routes/api/helpers/lots-utility-routes.js:178 prisma.lot.findMany
 * — list lots for a batch, soft-delete filtered, ordered oldest-first.
 */
async function listLotsByBatchId(batchId) {
  return prisma.lot.findMany({
    where: { batchId, isDeleted: false },
    // หน้าจอล็อตของเกษตรกรพิมพ์สายพันธุ์ของรุ่นที่ล็อตนี้มาจาก · แถว Lot เปล่า ๆ ไม่มีทางรู้
    // จึง join รุ่นมาด้วยเท่าที่หน้าจอใช้ — ไม่ใช่ทั้งแถว · ความสัมพันธ์ชื่อ `plant`
    // (harvest.prisma:31) ซึ่งเป็นชื่อที่ฝั่งหน้าจอเดาผิดมาตลอดว่าเป็น `species`
    include: {
      batch: {
        select: {
          batchNumber: true,
          harvestDate: true,
          plant: { select: { code: true, nameTH: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

module.exports = {
  extractApplicationPackagingRows,
  parseAutoTraceMeta,
  isAutoTraceBatch,
  autoCreateFirstCycleTraceForPassedAudit,
  // Bug 5.5 — shared guarded lot-number suffix helper (route was inlining it).
  buildLotNumber,
  // Bug 6.3 — explicit, validated lab-test status (no URL-auto-PASS).
  normalizeLotTestStatus,
  LOT_TEST_STATUSES,
  // Batch 15 — service-layer wrappers for trace/lots routes
  findHarvestBatchFarmId,
  findHarvestBatchWithLots,
  countLotsByBatch,
  updateLotTrackingUrl,
  findLotDetailById,
  findLotForUpdate,
  updateLotWithFarmInclude,
  findPublicBatchByAnyIdentifier,
  findActiveTraceIntegrityRecord,
  findPublicLotByAnyIdentifier,
  findFarmLabResultMarkers,
  findTraceEntityById,
  createLotWithQuotaCheck,
  findCycleWithFarmForTrace,
  findBatchWithFarmForTrace,
  updateBatchTraceQr,
  listOwnerFarmIdsForTrace,
  listWritableFarmIdsForTrace,
  // Batch 16 — service-layer wrappers for helpers/lots-{label,utility}-routes
  findLotForLabel,
  findLotsForBatchLabels,
  findLotForPrintCheck,
  markLotAsPrinted,
  findLotQrPayload,
  findLotPrintLabelPayload,
  listLotsByBatchId,
};
