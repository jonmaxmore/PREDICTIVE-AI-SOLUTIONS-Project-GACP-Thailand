const {
  authenticateProvider,
  PERMISSIONS,
  requireCanonicalPermission,
  logger,
  toInt,
} = require('./shared');
// Batch 10 — Prisma bypass cleanup. Provider-side planting reads now go through
// the planting-service which centralises the isDeleted filter + projection
// shape and lets us mask sensitive farm columns in one place if needed later.
const plantingService = require('../../../../services/planting-service');
const { buildPlotQrRow } = require('../../../../services/plot-qr-row');


// No `toCycleIntegritySummary` helper lives here any more. Every field it
// produced — totalPlantUnits, activeUnits, removedUnits, overPlanCount,
// unassignedCount, traceabilityReady, needsReview — was a statement about
// PlantUnit rows, and R8 of
// design note 2026-08-20-planting-tnt-design retires per-plant
// tracking (removed 2026-08-25). The one surviving number it computed, the
// declared plannedPlantCount, is already on every cyclePlots[] row of the
// payload, so nothing is lost by dropping the whole `integrity` object rather
// than shipping it with zeros — a zero here would claim the platform counted
// plants and found none.

const providerPlantingCyclesList = [
  authenticateProvider,
  requireCanonicalPermission(PERMISSIONS.TRACKING_VIEW_ALL),
  async (req, res) => {
    try {
      const page = toInt(req.query.page, 1, 1, 10000);
      const limit = toInt(req.query.limit, 20, 1, 100);
      const status = String(req.query.status || '').trim().toUpperCase();
      const search = String(req.query.q || '').trim();
      const farmId = req.query.farmId ? String(req.query.farmId).trim() : null;

      // plantingService.listProviderCycles — replaces direct
      // prisma.plantingCycle.findMany + prisma.plantingCycle.count.
      const { items, total } = await plantingService.listProviderCycles({
        status: status || null,
        search: search || null,
        farmId,
        skip: (page - 1) * limit,
        take: limit,
      });

      const cycleIds = items.map((item) => String(item.id || '').trim()).filter(Boolean);
      // plantingService.aggregateCycleLotCounts — batch + lot rollup only. The
      // two prisma.plantUnit.groupBy calls this used to also collect (REMOVED
      // and unassigned units) went out with per-plant tracking on 2026-08-25.
      const { batchRows, lotRows } = await plantingService.aggregateCycleLotCounts(cycleIds);

      const cycleIdByBatchId = new Map(
        batchRows.map((row) => [String(row.id), String(row.cycleId || '')]),
      );
      const lotsByCycleId = new Map();
      for (const row of lotRows) {
        const cycleId = cycleIdByBatchId.get(String(row.batchId));
        if (!cycleId) {
          continue;
        }
        const current = Number(lotsByCycleId.get(cycleId) || 0);
        lotsByCycleId.set(cycleId, current + Number(row._count?._all || 0));
      }

      const data = items.map((item) => ({
        id: item.id,
        cycleName: item.cycleName,
        status: item.status,
        startDate: item.startDate,
        expectedHarvestDate: item.expectedHarvestDate,
        farm: item.farm,
        plotCount: item.cyclePlots.length,
        cultivationMethods: Array.from(new Set(item.cyclePlots.map((assignment) => assignment.plot?.solarSystem).filter(Boolean))),
        totalAreaSqm: item.cyclePlots.reduce((sum, assignment) => sum + Number(assignment.allocatedAreaSqm || 0), 0),
        counts: {
          activities: item._count?.cultivationLogs || 0,
          batches: item._count?.batches || 0,
          lots: lotsByCycleId.get(String(item.id)) || 0,
        },
      }));

      return res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error) {
      logger.error('[provider] failed to list planting cycles:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch planting cycles' });
    }
  },
];

const providerPlantingCycleDetail = [
  authenticateProvider,
  requireCanonicalPermission(PERMISSIONS.TRACKING_VIEW_ALL),
  async (req, res) => {
    try {
      // plantingService.getProviderCycleDetail — replaces
      // prisma.plantingCycle.findUnique + the lot count query.
      const result = await plantingService.getProviderCycleDetail(req.params.id);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Planting cycle not found' });
      }
      const { cycle, lotCount } = result;

      return res.json({
        success: true,
        data: {
          ...cycle,
          // Built explicitly rather than spreading cycle._count. A spread
          // republishes whatever the row happens to carry, which is how a
          // retired key creeps back into a response; per-plant counts are
          // retired (R8, 2026-08-25) and must not travel even if a caller
          // hands us a row that still has one.
          _count: {
            cultivationLogs: cycle._count?.cultivationLogs || 0,
            batches: cycle._count?.batches || 0,
            lots: lotCount,
          },
        },
      });
    } catch (error) {
      logger.error('[provider] failed to get planting cycle detail:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch planting cycle detail' });
    }
  },
];

const providerPlantingCycleActivities = [
  authenticateProvider,
  requireCanonicalPermission(PERMISSIONS.TRACKING_VIEW_ALL),
  async (req, res) => {
    try {
      const cycleId = String(req.params.id);
      const page = toInt(req.query.page, 1, 1, 10000);
      const limit = toInt(req.query.limit, 20, 1, 100);

      // plantingService.listProviderCycleActivities — replaces
      // prisma.cultivationLog.findMany + prisma.cultivationLog.count.
      const { items, total, farmId: diaryFarmId } = await plantingService.listProviderCycleActivities({
        cycleId,
        scope: req.query.scope || null,
        activityType: req.query.activityType || null,
        skip: (page - 1) * limit,
        take: limit,
      });
      // PDPA ม.39 — these rows name a plot and never a farm, so the recorder walking the
      // body would find nothing to record. State it instead. See services/farm-access-audit.
      if (diaryFarmId) { res.locals.auditFarmIds = [diaryFarmId]; }

      return res.json({
        success: true,
        data: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error) {
      logger.error('[provider] failed to get planting activities:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch planting activities' });
    }
  },
];

const providerPlantingCyclePlotQrs = [
  authenticateProvider,
  requireCanonicalPermission(PERMISSIONS.TRACKING_VIEW_ALL),
  async (req, res) => {
    try {
      const cycleId = String(req.params.id || '').trim();
      if (!cycleId) {
        return res.status(400).json({ success: false, error: 'Cycle ID is required' });
      }

      // plantingService.getProviderCyclePlotQrs — replaces
      // prisma.plantingCycle.findUnique + prisma.traceQrSecurity.findMany.
      const result = await plantingService.getProviderCyclePlotQrs(cycleId);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Planting cycle not found' });
      }
      const { cycle, qrByCyclePlotId } = result;

      // PDPA ม.39 — a plot code is that farm's data, and this payload names only plots,
      // so the recorder walking the body would find no farm to record. State it.
      if (cycle.farmId) { res.locals.auditFarmIds = [cycle.farmId]; }

      // T8 — shared row builder; see services/plot-qr-row.js for why the permanent
      // code and the season's seal both travel, and why each says which it is.
      const data = (cycle.cyclePlots || []).map((assignment) => buildPlotQrRow({
        assignment,
        seasonal: qrByCyclePlotId.get(String(assignment.id)) || null,
        cultivationType: cycle.cultivationType,
      }));

      return res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error('[provider] failed to get planting cycle plot qrs:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch plot QR list' });
    }
  },
];

module.exports = {
  providerPlantingCyclesList,
  providerPlantingCycleDetail,
  providerPlantingCycleActivities,
  providerPlantingCyclePlotQrs,
};
