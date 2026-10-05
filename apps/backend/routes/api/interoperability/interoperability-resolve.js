'use strict';

/**
 * Universal code resolver for downstream partners (DTAM Next integration,
 * owner directive 2026-07-08). Classifies ANY scanned string — QR payload URL,
 * certificate number, plant/batch/lot code — and returns entity type +
 * PII-safe provenance + HATEOAS links.
 *
 * DOCUMENTED PROBE PRECEDENCE (the partner contract — keep the doc in
 * docs/integration/partner-interoperability-api.md in lockstep):
 *   0. URL normalization: full https URLs and paths; /verify/<cert>,
 *      /trace/plant|plot-cycle|batch|lot/<code>, legacy doubled
 *      /trace/trace/plant/<qr>; bare /trace/<code> falls through untyped.
 *   1. Deterministic prefixes: GACP-* → certificate · UNIT- → plant code ·
 *      PU- → plant qrCode · BT- → batch qrCode · BATCH- → batchNumber.
 *   2. LOT- is AMBIGUOUS in live data (lotNumbers always start LOT-, but two
 *      legacy batchNumber generators also emit LOT-*): Lot.lotNumber is
 *      probed FIRST, then HarvestBatch.batchNumber.
 *   3. TraceQrSecurity.qrCode unique index — classifies plot-cycle QRs and
 *      batch/lot qrCode UUIDs in a single indexed query.
 *   4. Bare-string cascade (fixed order): certificate → plant unit →
 *      planting cycle → harvest batch → lot.
 *
 * PII: responses reuse the trust-record posture (farm name/province/district,
 * certificate number, statuses) — NEVER applicantName / national IDs.
 */

const {
  prisma,
  ROUTE_BASE,
  computeTrustStatus,
  fetchCertificateByLookup,
  buildTrustRecord,
} = require('./interoperability-core');
const { toCertificateSlug } = require('../../../services/certificate-number-display');

// Farm's display column is farmName (NOT name) — prisma-select-field-mismatch
// class, caught live on the staging UAT drill 2026-07-08.
const FARM_SELECT = { select: { farmName: true, province: true, district: true } };
const CERT_LITE = { select: { certificateNumber: true, status: true } };

function farmView(farm) {
  if (!farm) { return null; }
  return { name: farm.farmName || null, province: farm.province || null, district: farm.district || null };
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/**
 * Normalize a scanned string. Returns { code, typed } where `typed` is one of
 * CERTIFICATE | PLOT_CYCLE_QR | HARVEST_BATCH | PACKAGING_LOT when the URL path
 * names the entity family, else null.
 */
function normalizeScannedCode(raw) {
  const s = safeDecode(String(raw || '').trim());
  if (!s) { return { code: '', typed: null }; }

  if (/^https?:\/\//i.test(s) || s.startsWith('/')) {
    let pathname = s;
    try { pathname = new URL(s, 'https://resolver.local').pathname; } catch { /* keep raw */ }
    const parts = pathname.split('/').filter(Boolean).map(safeDecode);
    // Legacy bug class: doubled /trace/trace/<kind>/<qr> — strip every leading
    // 'trace' segment. The generator that emitted the doubled paths was the
    // per-plant service, deleted on 2026-08-25; the loop stays because those
    // URLs are printed on labels already in circulation.
    while (parts.length > 0 && parts[0].toLowerCase() === 'trace') { parts.shift(); }
    const head = (parts[0] || '').toLowerCase();
    const tail = parts[1];
    if (head === 'verify' && tail) { return { code: tail, typed: 'CERTIFICATE' }; }
    const typedMap = {
      // No `plant` entry. R8
      // (design note 2026-08-20-planting-tnt-design) retires
      // per-plant tracking, so /trace/plant/<qr> names nothing the platform
      // resolves; such a code now falls through to the untyped cascade and
      // comes back unmatched, which is the truthful answer.
      'plot-cycle': 'PLOT_CYCLE_QR',
      batch: 'HARVEST_BATCH',
      lot: 'PACKAGING_LOT',
    };
    if (typedMap[head] && tail) { return { code: tail, typed: typedMap[head] }; }
    if (parts.length >= 1) { return { code: parts[parts.length - 1], typed: null }; }
    return { code: '', typed: null };
  }
  return { code: s, typed: null };
}

function links(entityType, entityId, publicTracePath) {
  const out = { traceEvents: `${ROUTE_BASE}/trace/events/${entityType}/${entityId}` };
  if (publicTracePath) { out.publicTrace = publicTracePath; }
  return out;
}

async function probeCertificate(code, keyKind = 'certificateNumber') {
  const certificate = await fetchCertificateByLookup(code);
  if (!certificate) { return null; }
  const trustStatus = computeTrustStatus(certificate);
  return {
    matched: { entityType: 'CERTIFICATE', entityId: certificate.certificateNumber, keyKind },
    trust: { trustStatus, valid: trustStatus === 'ACTIVE' },
    provenance: buildTrustRecord(certificate, trustStatus),
    links: {
      ...links('CERTIFICATE', toCertificateSlug(certificate.certificateNumber)),
      verify: `${ROUTE_BASE}/verification?certificateNumber=${encodeURIComponent(toCertificateSlug(certificate.certificateNumber))}`,
      publicVerify: `/verify/${encodeURIComponent(toCertificateSlug(certificate.certificateNumber))}`,
    },
  };
}

// `probePlantUnit` was deleted on 2026-08-25. It read a PlantUnit row and
// published a whole per-plant provenance block to partners — plant code and
// status, the plot it stood in, a live count of the cycle's plant rows, and the
// batch and lots it fed. R8 of
// design note 2026-08-20-planting-tnt-design retires per-plant
// tracking: partner resolution stops at planting cycle / plot and at Lot, so an
// unmatched result is now the correct answer for a plant code, not a gap.

async function probeHarvestBatch(code, keyKind = 'batchKey', keys = null) {
  const or = keys || [{ id: code }, { uuid: code }, { batchNumber: code }, { qrCode: code }];
  const batch = await prisma.harvestBatch.findFirst({
    where: { OR: or, isDeleted: false },
    include: { farm: FARM_SELECT, cycle: { include: { certificate: CERT_LITE } } },
  });
  if (!batch) { return null; }
  return {
    matched: { entityType: 'HARVEST_BATCH', entityId: batch.id, keyKind },
    provenance: {
      batchNumber: batch.batchNumber,
      farm: farmView(batch.farm),
      certificateNumber: batch.cycle?.certificate?.certificateNumber || null,
      certificateStatus: batch.cycle?.certificate?.status || null,
    },
    links: links('HARVEST_BATCH', batch.id, `/trace/batch/${encodeURIComponent(batch.id)}`),
  };
}

async function probeLot(code, keyKind = 'lotKey', keys = null) {
  const or = keys || [{ id: code }, { uuid: code }, { lotNumber: code }, { qrCode: code }];
  const lot = await prisma.lot.findFirst({
    where: { OR: or, isDeleted: false },
    include: {
      batch: { include: { farm: FARM_SELECT, cycle: { include: { certificate: CERT_LITE } } } },
    },
  });
  if (!lot) { return null; }
  return {
    matched: { entityType: 'PACKAGING_LOT', entityId: lot.id, keyKind },
    provenance: {
      lotNumber: lot.lotNumber,
      batchNumber: lot.batch?.batchNumber || null,
      farm: farmView(lot.batch?.farm),
      certificateNumber: lot.batch?.cycle?.certificate?.certificateNumber || null,
      certificateStatus: lot.batch?.cycle?.certificate?.status || null,
    },
    links: links('PACKAGING_LOT', lot.id, `/trace/lot/${encodeURIComponent(lot.id)}`),
  };
}

async function probePlantingCycle(code, keyKind = 'cycleKey') {
  const cycle = await prisma.plantingCycle.findFirst({
    where: { OR: [{ id: code }, { uuid: code }], isDeleted: false },
    include: { farm: FARM_SELECT, certificate: CERT_LITE },
  });
  if (!cycle) { return null; }
  return {
    matched: { entityType: 'PLANTING_CYCLE', entityId: cycle.id, keyKind },
    provenance: {
      farm: farmView(cycle.farm),
      certificateNumber: cycle.certificate?.certificateNumber || null,
      certificateStatus: cycle.certificate?.status || null,
    },
    links: links('PLANTING_CYCLE', cycle.id),
  };
}

async function probePlotCycleByCyclePlotId(cyclePlotId, qrCode, seal) {
  const cyclePlot = await prisma.plantingCyclePlot.findFirst({
    where: { id: cyclePlotId },
    include: { cycle: { include: { farm: FARM_SELECT, certificate: CERT_LITE } } },
  });
  if (!cyclePlot) { return null; }
  return {
    matched: { entityType: 'PLANTING_CYCLE_PLOT', entityId: cyclePlot.id, keyKind: 'traceQrIndex' },
    provenance: {
      cycleId: cyclePlot.cycle?.id || null,
      farm: farmView(cyclePlot.cycle?.farm),
      certificateNumber: cyclePlot.cycle?.certificate?.certificateNumber || null,
      certificateStatus: cyclePlot.cycle?.certificate?.status || null,
    },
    // The trace-events endpoint has no PLANTING_CYCLE_PLOT type — link the
    // parent cycle's events (documented in the partner guide).
    links: {
      traceEvents: cyclePlot.cycle?.id
        ? `${ROUTE_BASE}/trace/events/PLANTING_CYCLE/${cyclePlot.cycle.id}`
        : undefined,
      publicTrace: `/trace/plot-cycle/${encodeURIComponent(qrCode)}`,
    },
    seal,
  };
}

/** TraceQrSecurity unique index — the cheap classifier for opaque UUID QRs. */
async function probeTraceQrIndex(code) {
  const row = await prisma.traceQrSecurity.findUnique({ where: { qrCode: code } });
  if (!row) { return null; }
  const seal = { sealed: true, status: row.status, scanCount: row.scanCount };
  if (row.entityType === 'PLANTING_CYCLE_PLOT') {
    return probePlotCycleByCyclePlotId(row.entityId, code, seal);
  }
  let hit = null;
  if (row.entityType === 'HARVEST_BATCH') {
    hit = await probeHarvestBatch(row.entityId, 'traceQrIndex', [{ id: row.entityId }]);
  } else if (row.entityType === 'PACKAGING_LOT') {
    hit = await probeLot(row.entityId, 'traceQrIndex', [{ id: row.entityId }]);
  }
  // A TraceQrSecurity row of entityType PLANT_UNIT no longer resolves: per-plant
  // tracking is retired (R8, 2026-08-25). Historic rows stay in the table and
  // simply return unmatched.
  if (hit) { hit.seal = seal; }
  return hit;
}

/**
 * Resolve a normalized code. Returns { result } or { probed } when nothing
 * matched. Per-probe errors are NOT swallowed — a DB fault must surface as a
 * 5xx, not a false "not found" (the public generic resolver's silent-404
 * behavior is a known trap; this partner contract fails loudly).
 */
async function resolveScannedCode(raw) {
  const { code, typed } = normalizeScannedCode(raw);
  const probed = [];
  if (!code) { return { probed }; }

  const run = async (name, fn) => {
    probed.push(name);
    return fn();
  };

  // URL told us the family — probe only that family.
  if (typed === 'CERTIFICATE') {
    return { result: await run('certificate', () => probeCertificate(code)), probed };
  }
  if (typed === 'PLOT_CYCLE_QR') {
    return { result: await run('traceQrIndex', () => probeTraceQrIndex(code)), probed };
  }
  if (typed === 'HARVEST_BATCH') {
    return { result: await run('harvestBatch', () => probeHarvestBatch(code)), probed };
  }
  if (typed === 'PACKAGING_LOT') {
    return { result: await run('lot', () => probeLot(code)), probed };
  }

  // Deterministic prefixes.
  const upper = code.toUpperCase();
  if (upper.startsWith('GACP-') || upper.startsWith('TH-GACP')) {
    return { result: await run('certificate', () => probeCertificate(code)), probed };
  }
  // The UNIT-* and PU-* prefixes are not probed. They were the per-plant code
  // and per-plant QR families, retired with per-plant tracking on 2026-08-25
  // (R8). Nothing mints them any more and nothing resolves them.
  if (upper.startsWith('BT-')) {
    return { result: await run('harvestBatch', () => probeHarvestBatch(code, 'batchQr', [{ qrCode: code }])), probed };
  }
  if (upper.startsWith('BATCH-')) {
    return { result: await run('harvestBatch', () => probeHarvestBatch(code, 'batchNumber', [{ batchNumber: code }])), probed };
  }
  if (upper.startsWith('LOT-')) {
    const lot = await run('lot', () => probeLot(code, 'lotNumber', [{ lotNumber: code }]));
    if (lot) { return { result: lot, probed }; }
    // Legacy: two retired batchNumber generators also emitted LOT-*.
    return { result: await run('harvestBatch', () => probeHarvestBatch(code, 'batchNumber', [{ batchNumber: code }])), probed };
  }

  // Opaque strings: the TraceQrSecurity unique index first (one query
  // classifies plot-cycle QRs + batch/lot qrCode UUIDs), then the cascade.
  const indexed = await run('traceQrIndex', () => probeTraceQrIndex(code));
  if (indexed) { return { result: indexed, probed }; }

  const cascade = [
    ['certificate', () => probeCertificate(code, 'certificateKey')],
    ['plantingCycle', () => probePlantingCycle(code)],
    ['harvestBatch', () => probeHarvestBatch(code)],
    ['lot', () => probeLot(code)],
  ];
  for (const [name, fn] of cascade) {
    const hit = await run(name, fn);  
    if (hit) { return { result: hit, probed }; }
  }
  return { probed };
}

module.exports = { resolveScannedCode, normalizeScannedCode };
