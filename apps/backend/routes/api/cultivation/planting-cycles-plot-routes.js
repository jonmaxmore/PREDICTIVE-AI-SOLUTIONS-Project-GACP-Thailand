// Plot-scoped sub-routes of the planting-cycle router (plot-cycle QR codes).
//
// This file was `planting-cycles-unit-plot-routes.js` and also carried the
// per-plant unit routes: generate, bulk-confirm, reconcile, and the deprecated
// `/generate-units` alias. Spec R8 retired per-plant tracking permanently —
// resolution stops at the planting cycle, the plot, and the Lot — so those
// routes and the helper behind them are gone, and the name no longer claims a
// unit half that does not exist. Nothing here creates, reads, or gates on
// per-plant rows.
//
// Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access inside this
// helper file moved to `planting-service` (cycle-plot QR record reads). The
// `prisma` symbol is no longer pulled from `deps` here — the parent dispatcher
// (planting-cycles.js) still passes it but we don't read it.

const plantingService = require('../../../services/planting-service');
const { safeErrorMessage } = require('../../../shared/api-response');

function registerPlotRoutes(router, deps) {
  const {
    ensureCycleOwned,
    // Wave B fix M2 — gated mutation routes front with READ-shaped
    // reachability so the per-permission engine (which reads GRANT/REVOKE
    // rows) is the sole mutation authority; a VIEWER holding a GRANT must
    // not be 404'd before the engine runs. GET reads keep ensureCycleOwned.
    ensureCycleReachable,
    requireCycleFarmPermission,
    getAuthenticatedUserId,
    logger,
    loadOwnedCycleWithPlots,
    generatePlotCycleQrsForCycle,
    buildPlotCycleEntityId,
  } = deps;
  const { buildPlotQrRow } = require('../../../services/plot-qr-row');

router.post('/:id/plot-qrs/generate', ensureCycleReachable, requireCycleFarmPermission('QR_GENERATE'), async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const cycle = await loadOwnedCycleWithPlots(req.params.id, userId);

    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Planting cycle not found' });
    }

    const result = await generatePlotCycleQrsForCycle(cycle);
    if (result.status === 'failed') {
      // ยังไม่มีใบรับรองที่ยังมีผล = สถานะที่ผู้ยื่นแก้ได้เอง (ต่ออายุก่อน) จึงเป็น 409
      // และส่ง `code` ออกไปให้หน้าจอเลือกคำอธิบายจากชนิดของการปฏิเสธ ไม่ใช่จากข้อความ
      const conflict = result.code === 'QR_REQUIRES_ACTIVE_CERTIFICATE';
      return res.status(conflict ? 409 : 400).json({
        success: false,
        ...(result.code ? { code: result.code } : {}),
        error: result.error || 'Failed to generate plot QR records',
        ...(conflict ? { messageTh: result.error } : {}),
      });
    }

    // Bug 8.4 (adversarial-verify): the service now returns a REAL partial
    // report. Surface the failed plots to the operator instead of silently
    // returning a success with a reduced count (the pre-fix service threw on
    // the first failure, so a partial success was previously invisible).
    if (result.status === 'partial') {
      return res.status(201).json({
        success: true,
        message: `Plot-cycle QR codes partially generated — ${result.failed.length} plot(s) failed`,
        status: 'partial',
        count: result.generated.length,
        missingCount: result.missingCount,
        failed: result.failed,
        data: result.generated,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Plot-cycle QR codes generated successfully',
      count: result.generated.length,
      data: result.generated,
    });
  } catch (error) {
    logger.error('Error generating plot-cycle QR codes:', error);
    return res.status(500).json({ success: false, error: safeErrorMessage(error, 'Failed to generate plot-cycle QR codes') });
  }
});

router.get('/:id/plot-qrs', ensureCycleOwned, async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const cycle = await loadOwnedCycleWithPlots(req.params.id, userId);

    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Planting cycle not found' });
    }

    const assignments = Array.isArray(cycle.cyclePlots) ? cycle.cyclePlots : [];
    if (assignments.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
      });
    }

    const records = await plantingService.listPlotCycleQrRecordsForCycle(
      assignments.map((assignment) => buildPlotCycleEntityId(assignment)),
    );

    const recordByEntityId = new Map(records.map((record) => [String(record.entityId), record]));
    // T8 — one row builder for all three plot-QR doors (services/plot-qr-row.js). Three
    // hand-copied projections is how the farmer's door and the staff doors drift apart,
    // and it is why only one of them would have gained the permanent code.
    const data = assignments.map((assignment) => buildPlotQrRow({
      assignment,
      seasonal: recordByEntityId.get(buildPlotCycleEntityId(assignment)) || null,
      cultivationType: cycle.cultivationType,
    }));

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    logger.error('Error listing plot-cycle QR codes:', error);
    return res.status(500).json({ success: false, error: 'Failed to list plot-cycle QR codes' });
  }
});
}

module.exports = {
  registerPlotRoutes,
};
