// Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
// inside this helper file moved to `planting-service`. The `prisma`
// symbol is no longer pulled from `deps` here.

const plantingService = require('../../../services/planting-service');
// Required lazily: holder-access loads the permission engine, which suites that
// stub entity-service cannot load.
const holderScopeOf = (req) => require('../../../services/holder-access').holderScope(req);
const { safeErrorMessage } = require('../../../shared/api-response');
const { localYear } = require('../../../utils/working-days');

function registerActivityAndHarvestRoutes(router, deps) {
  const {
    ensureCycleOwned,
    // Wave B fix M2 — gated mutation routes front with READ-shaped
    // reachability (ensureCycleReachable) so the per-permission engine is
    // the sole mutation authority; GET reads keep ensureCycleOwned.
    ensureCycleReachable,
    requireCycleFarmPermission,
    resolveActivityPermission,
    HARVEST_LEGACY_SUNSET,
    getAuthenticatedUserId,
    normalizeActivityScope,
    normalizeActivityType,
    normalizeAttachmentIds,
    ALLOWED_ACTIVITY_SCOPE,
    ALLOWED_ACTIVITY_TYPES,
    toPositiveInt,
    toActivityResponse,
    logger,
    storedAreaToSqm,
    qrcodeService,
  } = deps;

// Owner decision: activity permission is PER-TYPE — the gate resolves
// ACTIVITY_<TYPE> from the payload (unknown type → 400 before the check).
router.post('/:id/activities', ensureCycleReachable, requireCycleFarmPermission(resolveActivityPermission), async (req, res) => {
  try {
    const cycleId = String(req.params.id);
    const scope = normalizeActivityScope(req.body?.scope);
    const activityType = normalizeActivityType(req.body?.activityType);
    const attachmentIds = normalizeAttachmentIds(req.body?.attachmentIds);

    if (!ALLOWED_ACTIVITY_SCOPE.has(scope)) {
      return res.status(400).json({ success: false, message: 'Invalid scope' });
    }

    if (!ALLOWED_ACTIVITY_TYPES.has(activityType)) {
      return res.status(400).json({ success: false, message: 'Invalid activityType' });
    }

    // Ownership: each attachmentId MUST belong to the authenticated user.
    // Without this check a user could attach another user's documents to
    // their own cultivation log (cross-tenant data leak).
    if (attachmentIds.length > 0) {
      const userId = getAuthenticatedUserId(req);
      const ownedAttachments = await plantingService.findOwnedApplicationDocuments(attachmentIds, userId, {
        holderScope: await holderScopeOf(req),
      });
      if (ownedAttachments.length !== attachmentIds.length) {
        return res.status(403).json({
          success: false,
          message: 'One or more attachmentIds do not belong to the authenticated user',
          code: 'ATTACHMENT_OWNERSHIP_DENIED',
        });
      }
    }

    // An activity is recorded against the cycle or one of its plots. The
    // `plantUnitId` this route used to accept — validated against the cycle and
    // stamped onto the log — bound the record to a single tracked plant, which
    // spec R8 retires: resolution stops at the plot. A caller still sending the
    // field is ignored rather than 400'd, so an old client keeps logging.
    const plotId = req.body?.plotId ? String(req.body.plotId).trim() : null;

    if (scope === 'PLOT' && !plotId) {
      return res.status(400).json({ success: false, message: 'plotId is required when scope is PLOT' });
    }

    if (plotId) {
      const exists = await plantingService.findCyclePlotInCycle({ cycleId, plotId });
      if (!exists) {
        return res.status(400).json({ success: false, message: 'plotId does not belong to this cycle' });
      }
    }

    const quantity = req.body?.quantity !== undefined && req.body?.quantity !== null
      ? Number(req.body.quantity)
      : null;
    const activityDate = req.body?.activityDate ? new Date(req.body.activityDate) : new Date();

    if (Number.isFinite(quantity) && quantity < 0) {
      return res.status(400).json({ success: false, message: 'quantity must be greater than or equal to 0' });
    }

    if (!Number.isFinite(activityDate.getTime())) {
      return res.status(400).json({ success: false, message: 'activityDate is invalid' });
    }

    const log = await plantingService.createCultivationLog(
      {
        cycleId,
        scope,
        logType: activityType,
        logDate: activityDate,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit: req.body?.unit ? String(req.body.unit).trim() : null,
        // GACP บังคับให้บันทึกได้ว่าใช้ "สารอะไร" — คอลัมน์ productName อยู่ใน schema
        // มาตลอด (cultivation.prisma:308 'ชื่อปุ๋ย/สารเคมี/ฯลฯ') แต่ประตูนี้ไม่เคยรับ
        // และหน้าจอไม่เคยถาม ⇒ ผู้ซื้อ/อย. ตอบไม่ได้ว่าพ่นอะไรใส่ล็อตนี้ (2026-09-07)
        productName: req.body?.productName ? String(req.body.productName).trim() : null,
        // ผู้ปฏิบัติงานจริง — คนละคนกับ recordedBy (บัญชีที่กดบันทึก) ได้ · ไม่บังคับกรอก
        // (มติ operator 2026-09-07 แบบ ก.) · ตัดความยาวกันการยัดข้อความยาวเข้าคอลัมน์ชื่อ
        performedBy: req.body?.performedBy
          ? String(req.body.performedBy).trim().slice(0, 120) || null
          : null,
        method: req.body?.method ? String(req.body.method).trim() : null,
        // อุณหภูมิ/ความชื้น — คอลัมน์มีมาตลอด (cultivation.prisma:315-316) แต่ประตูไม่รับ
        // คลาสเดียวกับ productName ข้างบน · ค่าที่ไม่ใช่ตัวเลข = ไม่บันทึก ไม่ใช่ 0
        temperature: Number.isFinite(Number(req.body?.temperature)) && req.body?.temperature !== null && req.body?.temperature !== ''
          ? Number(req.body.temperature) : null,
        humidity: Number.isFinite(Number(req.body?.humidity)) && req.body?.humidity !== null && req.body?.humidity !== ''
          ? Number(req.body.humidity) : null,
        weather: req.body?.weather ? String(req.body.weather).trim() : null,
        notes: req.body?.note ? String(req.body.note).trim() : null,
        photoUrl: attachmentIds[0] || null,
        attachmentIds,
        plotId,
        recordedBy: getAuthenticatedUserId(req),
      },
      {
        plot: { select: { id: true, name: true } },
      },
    );

    return res.status(201).json({
      success: true,
      message: 'Activity saved successfully',
      data: toActivityResponse(log),
    });
  } catch (error) {
    logger.error('Error creating cycle activity:', error);
    return res.status(500).json({ success: false, error: safeErrorMessage(error, 'Failed to save activity') });
  }
});

router.get('/:id/activities', ensureCycleOwned, async (req, res) => {
  try {
    const cycleId = String(req.params.id);
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);

    const where = { cycleId };

    const scope = req.query.scope ? normalizeActivityScope(req.query.scope) : null;
    if (scope && ALLOWED_ACTIVITY_SCOPE.has(scope)) {
      where.scope = scope;
    }

    const activityType = req.query.activityType ? normalizeActivityType(req.query.activityType) : null;
    if (activityType && ALLOWED_ACTIVITY_TYPES.has(activityType)) {
      where.logType = activityType;
    }

    if (req.query.plotId) {
      where.plotId = String(req.query.plotId);
    }

    // No `plantUnitId` filter: activities are not resolved per plant (spec R8).
    if (req.query.from || req.query.to) {
      where.logDate = {};
      if (req.query.from) {
        where.logDate.gte = new Date(String(req.query.from));
      }
      if (req.query.to) {
        where.logDate.lte = new Date(String(req.query.to));
      }
    }

    const [items, total] = await plantingService.listCultivationLogs({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        plot: { select: { id: true, name: true } },
      },
    });

    return res.json({
      success: true,
      data: items.map(toActivityResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    logger.error('Error listing cycle activities:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch activities' });
  }
});

router.post('/:id/harvest-batches', ensureCycleReachable, requireCycleFarmPermission('HARVEST_RECORD'), async (req, res) => {
  try {
    const cycleId = String(req.params.id || '').trim();
    const { createHarvestBatches } = require('../../../services/planting-cycle-service');
    const result = await createHarvestBatches(cycleId, req.body || {}, {
      healthId: req.healthIdentity?.healthId || null,
      userId: getAuthenticatedUserId(req),
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Error creating harvest batches by plot:', error);
    return res.status(500).json({ success: false, error: safeErrorMessage(error, 'Failed to create harvest batches') });
  }
});

router.post('/:id/harvest', ensureCycleReachable, requireCycleFarmPermission('HARVEST_RECORD'), async (req, res) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', HARVEST_LEGACY_SUNSET);
  res.setHeader('Link', `</api/planting-cycles/${req.params.id}/harvest-batches>; rel="successor-version"`);

  try {
    const { id } = req.params;
    const { harvestDate, actualYield, qualityGrade, notes } = req.body;

    const cycle = await plantingService.findCycleForLegacyHarvest(id);

    if (!cycle) {
      return res.status(404).json({ success: false, message: 'Cycle not found' });
    }

    if (cycle.status === 'HARVESTED' || cycle.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'This cycle has already been harvested',
      });
    }

    if (!cycle.certificateId) {
      return res.status(400).json({
        success: false,
        message: 'Active certificate is required before harvest',
      });
    }

    const certificateStatus = String(cycle.certificate?.status || '').toLowerCase();
    if (certificateStatus !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Certificate is not active',
      });
    }

    if (cycle.certificate?.expiryDate && new Date(cycle.certificate.expiryDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Certificate has expired',
      });
    }

    // Three doors stood here and all three are gone: a refusal unless the cycle
    // had PlantUnit rows, and two quota checks over those rows (over-plan,
    // unassigned). Per-plant tracking is retired (spec R8), so nothing creates
    // those rows — the first door would have refused every harvest forever, and
    // the other two could only ever measure a set that is now always empty.
    // What harvest actually requires is above and unchanged: an unharvested
    // cycle, an active unexpired certificate, and a sane harvest date.
    const harvestDateObj = harvestDate ? new Date(harvestDate) : new Date();
    if (cycle.startDate && harvestDateObj < new Date(cycle.startDate)) {
      return res.status(400).json({
        success: false,
        message: 'Harvest date cannot be before planting start date',
      });
    }

    const totalAreaSqm = (cycle.cyclePlots || []).length > 0
      ? cycle.cyclePlots.reduce((sum, assignment) => sum + Number(assignment.allocatedAreaSqm || 0), 0)
      : storedAreaToSqm(cycle.plotArea || 0, cycle.areaUnit);

    // Agronomic yield rates are published per rai, which is why the numbers
    // look like this. That is a property of the source material, not a unit the
    // platform offers: the conversion happens once, here, and nothing upstream
    // or downstream of this line sees anything but square metres.
    const SQM_PER_RAI = 1600;
    const YIELD_KG_PER_RAI = {
      INDOOR: 150,
      INDOOR_CONTROLLED: 150,
      GREENHOUSE: 120,
      OUTDOOR: 80,
      SELF_GROWN: 80,
    };

    const yieldRate = YIELD_KG_PER_RAI[cycle.cultivationType] || YIELD_KG_PER_RAI.OUTDOOR;
    const calculatedMaxYield = Math.round((totalAreaSqm / SQM_PER_RAI) * yieldRate);

    logger.info(`[Harvest] Cycle ${id}: area=${totalAreaSqm.toFixed(2)} sqm, type=${cycle.cultivationType}, maxYield=${calculatedMaxYield}kg`);

    const batchCount = await plantingService.countHarvestBatchesGlobal();
    const batchNumber = `BATCH-${localYear()}-${String(batchCount + 1).padStart(4, '0')}`;
    const qrData = await qrcodeService.generateForRecord('BATCH', id);

    const batch = await plantingService.commitLegacyHarvest({
      batchData: {
        batchNumber,
        farmId: cycle.farmId,
        plantCode: cycle.plantSpecies?.code || null,
        cycleId: id,
        harvestDate: harvestDateObj,
        freshWeight: actualYield ? parseFloat(actualYield) : calculatedMaxYield,
        dryWeight: calculatedMaxYield,
        qualityGrade: qualityGrade || null,
        notes: `${notes || ''}\n[System] Calculated max yield: ${calculatedMaxYield} kg`,
        status: 'HARVESTED',
        // STAGE A.2 (detokenize): stamp the non-PII User UUID, not the national
        // ID (matches the peer write sites; recordedBy is display-only).
        recordedBy: getAuthenticatedUserId(req) || null,
        qrCode: qrData.qrCode,
        trackingUrl: qrData.trackingUrl,
      },
      cycleId: id,
      cycleUpdate: {
        status: 'HARVESTED',
        actualHarvestDate: harvestDateObj,
        actualYield: actualYield ? parseFloat(actualYield) : null,
      },
    });

    // The batch row and the cycle's HARVESTED status are already committed by
    // commitLegacyHarvest above. What used to follow was a linkToBatch call that
    // stamped every PlantUnit of the cycle onto this batch and reported the
    // count as `plantUnitsLinked`. The evidence chain resolves to the cycle and
    // the plot now (spec R8), so the link and the field are gone rather than
    // reported as zero — a zero would read as "measured and empty".
    return res.status(201).json({
      success: true,
      message: 'Harvest batch created successfully',
      data: {
        batch,
        qrCode: qrData,
      },
    });
  } catch (error) {
    logger.error('Error harvesting cycle:', error);
    return res.status(500).json({ success: false, error: safeErrorMessage(error, 'Failed to harvest cycle') });
  }
});
}

module.exports = {
  registerActivityAndHarvestRoutes,
};
