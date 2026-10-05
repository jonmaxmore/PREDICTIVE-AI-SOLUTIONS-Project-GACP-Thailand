// PDPA close-natid-round4 — `actorIdentity` is built by getActorIdentity (route
// helper), which returns a RAW providerId/healthId = a 13-digit Thai national ID
// (falling back to the User UUID). It is persisted into the AUTO_TRACE_META JSON
// embedded in HarvestBatch.notes / PlantingCycle.notes (a dump-readable text
// column with no PDPA encrypt hook), so the raw ID would leak in a dump. Mask it
// at the persist boundary (maskThaiId → 1-XXXX-XXXX-X-0123), matching every
// sibling persisted-actorIdentity site (trace/lots.js:214, the provider workflow
// audit handlers). recordedBy=actorId (a User UUID) still captures the actor for
// non-display attribution; this mask only neuters the redundant national-ID copy.
const { maskThaiId } = require('../../utils/field-encryption');

async function autoCreateFirstCycleTraceForPassedAudit({
  applicationId,
  certificateId = null,
  actorId,
  actorRole,
  actorIdentity,
  ipAddress,
  userAgent,
}, deps) {
  const {
    prisma,
    qrcodeService,
    logger,
    logAction,
    logQrGenerated,
    extractApplicationPackagingRows,
    resolveFarmIdForApplication,
    ensureAutoTraceCycle,
    resolveDeclaredHarvestWeight,
    EPSILON,
    buildBatchNumber,
    buildAutoTraceNote,
    buildLotNumber,
    AUTO_TRACE_META_PREFIX,
  } = deps || {};

  const application = await prisma.application.findFirst({
    where: { id: applicationId, isDeleted: false },
    select: {
      id: true,
      applicationNumber: true,
      healthId: true,
      formData: true,
      status: true,
    },
  });

  if (!application) {
    throw new Error('Application not found for auto trace creation');
  }

  const existingAutoBatch = await prisma.harvestBatch.findFirst({
    where: {
      isDeleted: false,
      notes: { startsWith: AUTO_TRACE_META_PREFIX, contains: `"applicationId":"${application.id}"` },
    },
    select: { id: true, batchNumber: true },
  });
  if (existingAutoBatch) {
    return {
      created: false,
      reason: 'already-created',
      batchId: existingAutoBatch.id,
      batchNumber: existingAutoBatch.batchNumber,
    };
  }

  const packagingRows = extractApplicationPackagingRows(application.formData);
  if (packagingRows.length === 0) {
    throw new Error('Application packaging rows are required for auto trace creation');
  }

  const creation = await prisma.$transaction(async (tx) => {
    const farmId = await resolveFarmIdForApplication(tx, application);
    if (!farmId) {
      throw new Error('No farm found for application owner');
    }

    const cycleId = await ensureAutoTraceCycle(tx, {
      application,
      farmId,
      certificateId,
      actorIdentity,
    });

    const declaredHarvestWeight = resolveDeclaredHarvestWeight(application.formData, packagingRows);
    if (declaredHarvestWeight <= 0) {
      throw new Error('Unable to determine harvest weight from application packaging');
    }

    const packagingTotalWeight = packagingRows.reduce((sum, row) => sum + row.totalWeight, 0);
    if (packagingTotalWeight - declaredHarvestWeight > EPSILON) {
      throw new Error('Packaging total exceeds harvest weight');
    }

    const batchNumber = await buildBatchNumber(tx);
    const batchQrCode = qrcodeService.generateQRCodeId();
    const autoMeta = {
      traceSource: 'AUTO_FIRST_CYCLE',
      createdFrom: 'AUTO',
      applicationId: application.id,
      applicationNumber: application.applicationNumber,
      certificateId: certificateId || null,
      cycleId: cycleId || null,
      packagingRowCount: packagingRows.length,
      // PDPA close-natid-round4 — mask the raw national-ID actor identity (see
      // the import-site note). null stays null.
      actorIdentity: actorIdentity ? maskThaiId(actorIdentity) : null,
      createdAt: new Date().toISOString(),
    };

    const createdBatch = await tx.harvestBatch.create({
      data: {
        batchNumber,
        farmId,
        cycleId: cycleId || null,
        harvestDate: new Date(),
        freshWeight: declaredHarvestWeight,
        dryWeight: null,
        status: 'PACKED',
        qrCode: batchQrCode,
        trackingUrl: null,
        recordedBy: actorId || null,
        notes: buildAutoTraceNote(autoMeta),
      },
      select: {
        id: true,
        batchNumber: true,
        qrCode: true,
      },
    });

    const batchTrackingUrl = qrcodeService.generatePublicTraceUrl(`batch/${createdBatch.id}`);
    const batch = await tx.harvestBatch.update({
      where: { id: createdBatch.id },
      data: { trackingUrl: batchTrackingUrl },
      select: {
        id: true,
        batchNumber: true,
        trackingUrl: true,
        qrCode: true,
        harvestDate: true,
        freshWeight: true,
      },
    });

    const lots = [];
    for (let index = 0; index < packagingRows.length; index += 1) {
      const row = packagingRows[index];
      const lotQrCode = qrcodeService.generateQRCodeId();
      const createdLot = await tx.lot.create({
        data: {
          lotNumber: buildLotNumber(batch.batchNumber, index),
          batchId: batch.id,
          packageType: row.packagingType,
          quantity: row.unitCount,
          unitWeight: row.unitWeight,
          totalWeight: row.totalWeight,
          packagedAt: new Date(),
          qrCode: lotQrCode,
          trackingUrl: null,
          status: 'PACKAGED',
          destinationType: 'RAW_MATERIAL',
        },
        select: {
          id: true,
          lotNumber: true,
          qrCode: true,
        },
      });

      const lotTrackingUrl = qrcodeService.generatePublicTraceUrl(`lot/${createdLot.id}`);
      const lot = await tx.lot.update({
        where: { id: createdLot.id },
        data: { trackingUrl: lotTrackingUrl },
        select: {
          id: true,
          lotNumber: true,
          packageType: true,
          quantity: true,
          unitWeight: true,
          totalWeight: true,
          trackingUrl: true,
          qrCode: true,
        },
      });
      lots.push(lot);
    }

    if (lots.length !== packagingRows.length) {
      throw new Error('Lot creation count does not match packaging rows');
    }

    return {
      skipped: false,
      batch,
      lots,
      packagingRows,
      packagingTotalWeight,
      declaredHarvestWeight,
      farmId,
      cycleId: cycleId || null,
    };
  });

  if (creation.skipped) {
    return { created: false, reason: creation.reason };
  }

  const integrityTasks = [
    qrcodeService.registerTraceIntegrity({
      entityType: 'HARVEST_BATCH',
      entityId: creation.batch.id,
      qrCode: creation.batch.qrCode,
      publicUrl: creation.batch.trackingUrl,
      payload: {
        scope: 'RAW_MATERIAL_GACP',
        source: 'APPLICATION',
        batchId: creation.batch.id,
        batchNumber: creation.batch.batchNumber,
        harvestDate: creation.batch.harvestDate,
        totalHarvestWeight: creation.batch.freshWeight,
        lotCount: creation.lots.length,
      },
    }),
    ...creation.lots.map((lot) => qrcodeService.registerTraceIntegrity({
      entityType: 'PACKAGING_LOT',
      entityId: lot.id,
      qrCode: lot.qrCode,
      publicUrl: lot.trackingUrl,
      payload: {
        scope: 'RAW_MATERIAL_GACP',
        source: 'APPLICATION',
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        batchId: creation.batch.id,
        packagingType: lot.packageType,
        unitWeight: lot.unitWeight,
        unitCount: lot.quantity,
        totalWeight: lot.totalWeight,
      },
    })),
  ];

  await Promise.all(integrityTasks).catch((error) => {
    logger.warn('[traceability-service] QR integrity persistence failed', { message: error.message });
  });

  const auditOperations = [
    () => logAction({
      action: 'AUTO_BATCH_CREATED',
      actorId,
      actorRole,
      resourceId: application.id,
      ipAddress,
      userAgent,
      metadata: {
        applicationNumber: application.applicationNumber,
        batchId: creation.batch.id,
        batchNumber: creation.batch.batchNumber,
        farmId: creation.farmId,
        cycleId: creation.cycleId || null,
        createdFrom: 'AUTO',
      },
    }),
    () => logAction({
      action: 'AUTO_LOTS_CREATED_FROM_APPLICATION',
      actorId,
      actorRole,
      resourceId: application.id,
      ipAddress,
      userAgent,
      metadata: {
        applicationNumber: application.applicationNumber,
        batchId: creation.batch.id,
        cycleId: creation.cycleId || null,
        lotCount: creation.lots.length,
        packagingRows: creation.packagingRows.map((row) => ({
          packagingType: row.packagingType,
          unitWeight: row.unitWeight,
          unitCount: row.unitCount,
          totalWeight: row.totalWeight,
        })),
      },
    }),
    () => logQrGenerated({
      actorId,
      actorRole,
      applicationId: application.id,
      entityType: 'HARVEST_BATCH',
      entityId: creation.batch.id,
      qrCode: creation.batch.qrCode,
      trackingUrl: creation.batch.trackingUrl,
      ipAddress,
      userAgent,
    }),
    ...creation.lots.map((lot) => () => logQrGenerated({
      actorId,
      actorRole,
      applicationId: application.id,
      entityType: 'PACKAGING_LOT',
      entityId: lot.id,
      qrCode: lot.qrCode,
      trackingUrl: lot.trackingUrl,
      ipAddress,
      userAgent,
    })),
  ];

  for (const runAudit of auditOperations) {
    try {
      await runAudit();
    } catch (error) {
      logger.warn('[traceability-service] audit log failure', { message: error.message });
    }
  }

  return {
    created: true,
    reason: 'created',
    cycleId: creation.cycleId || null,
    batch: creation.batch,
    lots: creation.lots,
  };
}

module.exports = {
  autoCreateFirstCycleTraceForPassedAudit,
};
