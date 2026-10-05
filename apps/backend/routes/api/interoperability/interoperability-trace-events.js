const {
  prisma,
  TRUST_STATUS,
  computeTrustStatus,
  createEvent,
  fetchCertificateByLookup,
} = require('./interoperability-core');
// B2-followup: this partner-gated trace feed is the 4th revokedReason
// projection — mask any 13-digit national ID an operator typed into the revoke
// reason before broadcasting it (same mask the PDPA cluster applies elsewhere).
const { maskThaiIdsInText } = require('../../../utils/field-encryption');

async function collectTraceEvents(entityType, entityId) {
  const events = [];

  if (entityType === 'CERTIFICATE') {
    const certificate = await fetchCertificateByLookup(entityId);
    if (!certificate) {
      return null;
    }

    events.push(createEvent({
      eventType: 'CERTIFICATE_ISSUED',
      entityType,
      entityId: certificate.certificateNumber,
      occurredAt: certificate.issuedDate,
      actorType: 'PROVIDER',
      actorId: certificate.issuedBy,
      payload: {
        trustStatus: computeTrustStatus(certificate),
      },
    }));

    if (certificate.revokedAt || String(certificate.status || '').toUpperCase() === TRUST_STATUS.REVOKED) {
      events.push(createEvent({
        eventType: 'CERTIFICATE_REVOKED',
        entityType,
        entityId: certificate.certificateNumber,
        occurredAt: certificate.revokedAt || certificate.updatedAt,
        actorType: 'PROVIDER',
        actorId: certificate.revokedBy,
        payload: {
          reason: maskThaiIdsInText(certificate.revokedReason) || null,
        },
      }));
    }
  }

  if (entityType === 'PLANTING_CYCLE') {
    const cycle = await prisma.plantingCycle.findFirst({
      where: {
        OR: [{ id: entityId }, { uuid: entityId }],
        isDeleted: false,
      },
      include: {
        farm: {
          select: { id: true, farmName: true },
        },
      },
    });
    if (!cycle) {
      return null;
    }

    events.push(createEvent({
      eventType: 'PLANTING_CYCLE_CREATED',
      entityType,
      entityId: cycle.id,
      occurredAt: cycle.createdAt,
      payload: {
        farmId: cycle.farmId,
        farmName: cycle.farm?.farmName || null,
        status: cycle.status,
      },
    }));

    if (cycle.startDate) {
      events.push(createEvent({
        eventType: 'PLANTING_CYCLE_STARTED',
        entityType,
        entityId: cycle.id,
        occurredAt: cycle.startDate,
        payload: {
          cultivationType: cycle.cultivationType || null,
        },
      }));
    }

    if (cycle.actualHarvestDate) {
      events.push(createEvent({
        eventType: 'PLANTING_CYCLE_HARVESTED',
        entityType,
        entityId: cycle.id,
        occurredAt: cycle.actualHarvestDate,
        payload: {
          actualYield: cycle.actualYield || null,
        },
      }));
    }
  }

  if (entityType === 'HARVEST_BATCH') {
    const batch = await prisma.harvestBatch.findFirst({
      where: {
        OR: [{ id: entityId }, { batchNumber: entityId }, { qrCode: entityId }],
        isDeleted: false,
      },
    });
    if (!batch) {
      return null;
    }

    events.push(createEvent({
      eventType: 'BATCH_CREATED',
      entityType,
      entityId: batch.id,
      occurredAt: batch.createdAt,
      payload: {
        batchNumber: batch.batchNumber,
        status: batch.status,
      },
    }));

    if (batch.harvestDate) {
      events.push(createEvent({
        eventType: 'BATCH_HARVESTED',
        entityType,
        entityId: batch.id,
        occurredAt: batch.harvestDate,
        payload: {
          freshWeight: batch.freshWeight || null,
        },
      }));
    }
  }

  if (entityType === 'PACKAGING_LOT') {
    const lot = await prisma.lot.findFirst({
      where: {
        OR: [{ id: entityId }, { lotNumber: entityId }, { qrCode: entityId }],
        isDeleted: false,
      },
    });
    if (!lot) {
      return null;
    }

    events.push(createEvent({
      eventType: 'LOT_CREATED',
      entityType,
      entityId: lot.id,
      occurredAt: lot.createdAt,
      payload: {
        lotNumber: lot.lotNumber,
        batchId: lot.batchId,
        totalWeight: lot.totalWeight || null,
      },
    }));

    if (lot.printedAt) {
      events.push(createEvent({
        eventType: 'LOT_QR_LABEL_PRINTED',
        entityType,
        entityId: lot.id,
        occurredAt: lot.printedAt,
        payload: {
          printLocked: true,
        },
      }));
    }
  }

  // The PLANT_UNIT branch was deleted on 2026-08-25. It read a PlantUnit row
  // and emitted the per-plant event chain — PLANT_UNIT_CREATED / _CONFIRMED /
  // _HARVESTED / _SOLD. R8 of
  // design note 2026-08-20-planting-tnt-design retires per-plant
  // tracking, so there is no such event to emit; the chain a partner follows
  // runs planting cycle / plot -> harvest batch -> lot.

  const security = await prisma.traceQrSecurity.findFirst({
    where: { entityType, entityId, status: 'ACTIVE' },
    include: {
      scans: {
        orderBy: { createdAt: 'asc' },
        take: 100,
      },
    },
  });

  if (security) {
    events.push(createEvent({
      eventType: 'TRACE_QR_REGISTERED',
      entityType,
      entityId,
      occurredAt: security.createdAt,
      payload: {
        qrCode: security.qrCode || null,
        publicUrl: security.publicUrl,
        keyFingerprint: security.keyFingerprint || null,
      },
      signature: security.signature || null,
    }));

    for (const scan of security.scans) {
      events.push(createEvent({
        eventType: 'TRACE_QR_SCANNED',
        entityType,
        entityId,
        occurredAt: scan.createdAt,
        actorType: 'PUBLIC',
        actorId: scan.requestIp || null,
        payload: {
          requestPath: scan.requestPath || null,
          verified: scan.verified === true,
        },
      }));
    }
  }

  events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  return events;
}

module.exports = {
  collectTraceEvents,
};
