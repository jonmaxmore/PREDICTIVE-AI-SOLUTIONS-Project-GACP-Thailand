const TRACEABILITY_SCHEMA_VERSION = 'DTAM_TRACEABILITY_SCHEMA_1.0.0';
const TRACEABILITY_EVENT_CONTRACT_VERSION = 'DTAM_TRACE_EVENT_CONTRACT_1.0.0';
// 1.1.0 (M1, 2026-08-15): MINOR bump — `subject` gained holderDisplayName +
// holderType. Nothing was removed and no existing field changed meaning, so a
// partner pinned on 1.x keeps parsing exactly what it parsed before; one that
// pins the exact string learns there is something new to read.
const ECERT_SCHEMA_VERSION = 'DTAM_ECERT_SCHEMA_1.1.0';

function buildTraceabilitySchema() {
  return {
    schemaVersion: TRACEABILITY_SCHEMA_VERSION,
    name: 'DTAM Inter-Agency Traceability Exchange',
    description:
      'Canonical exchange schema for GACP traceability data across government agencies and partner systems.',
    entities: {
      CERTIFICATE: {
        primaryId: 'certificateNumber',
        requiredFields: ['certificateNumber', 'status', 'issuedDate', 'expiryDate'],
      },
      PLANTING_CYCLE: {
        primaryId: 'cycleId',
        requiredFields: ['cycleId', 'farmId', 'plantSpeciesId', 'startDate', 'status'],
      },
      HARVEST_BATCH: {
        primaryId: 'batchId',
        requiredFields: ['batchId', 'cycleId', 'batchNumber', 'harvestDate'],
      },
      PACKAGING_LOT: {
        primaryId: 'lotId',
        requiredFields: ['lotId', 'batchId', 'lotNumber', 'totalWeight'],
      },
      // No PLANT_UNIT entity family. R8 of
      // design note 2026-08-20-planting-tnt-design retires
      // per-plant tracking (withdrawn 2026-08-25): the finest entity a partner
      // can resolve is the planting cycle / plot on one side and the packaging
      // lot on the other. Declaring a family the resolver cannot answer would
      // promise partners a call that always comes back empty.
    },
    dataClassification: {
      public: ['certificate status', 'traceability chain IDs', 'issued/expiry dates', 'verification metadata'],
      restricted: ['userId', 'farm address details', 'internal audit references'],
      piiStrategy: 'hash_and_minimize',
    },
    interoperability: {
      transport: 'REST/JSON',
      signatures: 'RSA-SHA256',
      timestamp: 'ISO-8601 UTC',
    },
  };
}

function buildTraceEventContract() {
  return {
    contractVersion: TRACEABILITY_EVENT_CONTRACT_VERSION,
    eventShape: {
      eventId: 'string(uuid)',
      eventType: 'string',
      entityType: 'string(enum)',
      entityId: 'string',
      occurredAt: 'string(ISO-8601)',
      actorType: 'SYSTEM | provider | HEALTH | PUBLIC',
      actorIdHash: 'string(sha256 | null)',
      payload: 'object',
      integrity: {
        hash: 'string(sha256)',
        signature: 'string(hex|base64|nullable)',
      },
    },
    minimalEventTypes: [
      'CERTIFICATE_ISSUED',
      'CERTIFICATE_REVOKED',
      'TRACE_QR_REGISTERED',
      'TRACE_QR_SCANNED',
      'BATCH_CREATED',
      'LOT_CREATED',
      'PLANTING_CYCLE_CREATED',
      // 'PLANT_UNIT_STATUS_CHANGED' was withdrawn on 2026-08-25 with per-plant
      // tracking (R8) — no plant has a status to change any more.
    ],
  };
}

module.exports = {
  TRACEABILITY_SCHEMA_VERSION,
  TRACEABILITY_EVENT_CONTRACT_VERSION,
  ECERT_SCHEMA_VERSION,
  buildTraceabilitySchema,
  buildTraceEventContract,
};
