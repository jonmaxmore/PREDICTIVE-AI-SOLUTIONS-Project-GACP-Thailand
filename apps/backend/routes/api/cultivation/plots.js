const express = require('express');
const { logger } = require('../../../shared');
const farmService = require('../../../services/farm-service');
const plantingService = require('../../../services/planting-service');
const { resolveFarmAccess } = require('../../../services/farm-access');
// Wave B chunk 4 — plots are cycle-prep, so plot create/delete gate on
// CYCLE_CREATE (plan mapping) for workspace co-members; owner always passes.
const { assertFarmActionPermission } = require('../../../services/entity-effective-permissions-service');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const { entityPermissionDeniedBody } = require('../../../shared/entity-permission-denied');

function respondPermissionDenied(res, error, fallbackPermission) {
  return res.status(403).json(entityPermissionDeniedBody(error?.permission || fallbackPermission));
}

/**
 * Plot routes
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): all direct prisma calls
 * moved to `farm-service.findOwnedFarmForPlotOps` (ownership probe) and
 * `planting-service.{createPlotForFarm, listPlotsByFarm,
 * findPlotWithFarmOwner, deletePlot}` (Plot CRUD). Ownership predicates
 * (`farm.ownerId`) and `isDeleted: false` are enforced at the service
 * boundary so a route bug cannot widen them.
 */

const router = express.Router();

function getHealthUserId(req) {
  return String(req.user?.id || '').trim();
}

router.post('/farms/:farmId/plots', authenticateHealth, async (req, res) => {
  try {
    const userId = getHealthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { farmId } = req.params;
    // `area` is the retired request field for the same square-metre number. It
    // stays accepted so an existing client is not broken by the rename; the
    // contract change drops it and `areaSqm` stands alone.
    const { name, area, areaSqm, areaUnit, solarSystem } = req.body || {};
    const requestedAreaSqm = areaSqm ?? area;

    if (!name || requestedAreaSqm === undefined || requestedAreaSqm === null) {
      return res.status(400).json({ success: false, message: 'name and areaSqm are required' });
    }

    // Wave B fix M2 — READ-shaped reachability: the CYCLE_CREATE engine
    // gate below is the sole mutation authority (a VIEWER holding a GRANT
    // must not be 404'd before the engine runs).
    const farm = await farmService.findOwnedFarmForPlotOps(farmId, userId);
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    // Wave B chunk 4 — per-member gate (CYCLE_CREATE; plots are cycle-prep).
    try {
      await assertFarmActionPermission({ farmId: String(farmId), userId, permission: 'CYCLE_CREATE' });
    } catch (permError) {
      if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
        return respondPermissionDenied(res, permError, 'CYCLE_CREATE');
      }
      throw permError;
    }

    const requestedSystem = String(solarSystem || 'OUTDOOR').toUpperCase();

    // B6 / กทล.๑ ส่วนที่ ๔ (๓): once a certificate exists, the scope it covers is decided by
    // the CERTIFICATE's source application — a record this farm's own PATCH door cannot
    // reach. The farm column below is what a two-step bypass moved first, so checking it
    // alone let a farm grow indoors on an outdoor certificate.
    try {
      const { assertPlotWithinCertifiedScope } = require('../../../services/certified-scope');
      await assertPlotWithinCertifiedScope({ farmId: String(farmId), solarSystem: requestedSystem });
    } catch (scopeError) {
      if (scopeError?.code === 'PLOT_OUTSIDE_CERTIFIED_SCOPE'
        || scopeError?.code === 'CERTIFIED_SCOPE_UNVERIFIABLE') {
        return res.status(scopeError.statusCode || 409).json({
          success: false, code: scopeError.code,
          message: scopeError.messageTh, messageTh: scopeError.messageTh,
        });
      }
      throw scopeError;
    }

    // Before certification nothing has been certified, so the farm's own declaration is
    // all there is — this check keeps doing that job.
    if (farm.cultivationMethod && farm.cultivationMethod !== 'BOTH' && farm.cultivationMethod !== requestedSystem) {
      return res.status(400).json({
        success: false,
        message: `Farm is certified for ${farm.cultivationMethod} and cannot create ${requestedSystem} plot`,
      });
    }

    const plot = await plantingService.createPlotForFarm({
      farmId,
      name,
      areaSqm: requestedAreaSqm,
      areaUnit,
      solarSystem: requestedSystem,
    });

    logger.info(`Created plot ${plot.id} for farm ${farmId}`);
    return res.status(201).json({ success: true, data: plot });
  } catch (error) {
    logger.error(`Error creating plot: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

router.get('/farms/:farmId/plots', authenticateHealth, async (req, res) => {
  try {
    const userId = getHealthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { farmId } = req.params;
    const farm = await farmService.findOwnedFarmForPlotOps(farmId, userId);
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const plots = await plantingService.listPlotsByFarm(farmId);

    // ขอบเขตที่ใบรับรองครอบคลุม — ส่งไปด้วยเพื่อให้หน้าเลือกแปลง "ทำให้จางพร้อมบอกเหตุ"
    // แทนการซ่อนแปลงที่เลือกไม่ได้ · ซ่อนแล้วเกษตรกรจะถามว่า "แปลงโรงเรือนหายไปไหน"
    // ซึ่งผิดเกณฑ์ที่ operator ตั้งไว้ว่าต้องใช้ได้เองโดยไม่ต้องถามใคร
    //
    // อยู่ข้าง `data` ไม่ใช่ข้างใน เพราะ `data` เป็นอาร์เรย์ที่ผู้เรียกอ่านตรง ๆ อยู่แล้ว
    // (planting-service.ts:84 asArray) · เพิ่มอย่างเดียว ไม่มีอะไรพังได้
    //
    // null = ฟาร์มยังไม่มีใบรับรองที่มีผล ⇒ หน้าจอไม่ต้องกั้นอะไร (ด่าน "ต้องมีใบก่อนปลูก"
    // เป็นคนละด่าน อยู่ที่ createCycle)
    let certifiedAreaTypes = null;
    try {
      const { certifiedAreaTypes: resolve } = require('../../../services/certified-scope');
      const { holderScope } = require('../../../services/holder-access');
      ({ areaTypes: certifiedAreaTypes } = await resolve({ farmId: String(farmId), holderScope: await holderScope(req) }));
    } catch (scopeError) {
      // อ่านขอบเขตไม่ได้ ไม่ควรทำให้รายการแปลงหายไปทั้งหน้า · หน้าจอจะไม่กั้นอะไร
      // และด่านจริงที่ createCycle ยังทำงานเหมือนเดิม — ด่านอยู่ที่การเขียน ไม่ใช่การอ่าน
      logger.warn(`[plots] certified scope unreadable for farm ${farmId}: ${scopeError.message}`);
    }

    return res.json({ success: true, data: plots, certifiedAreaTypes });
  } catch (error) {
    logger.error(`Error fetching plots: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

router.delete('/plots/:id', authenticateHealth, async (req, res) => {
  try {
    const userId = getHealthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params;
    const plot = await plantingService.findPlotWithFarmOwner(id);

    // Wave A chunk 3 — owner OR ACTIVE co-member of the farm entity
    // (404-not-403 semantics preserved). Wave B fix M2 — read-shaped: the
    // CYCLE_CREATE engine gate below is the sole mutation authority.
    if (!plot || !(await resolveFarmAccess(plot.farm, userId))) {
      return res.status(404).json({ success: false, message: 'Plot not found' });
    }

    // Wave B chunk 4 — per-member gate (CYCLE_CREATE; plots are cycle-prep).
    try {
      await assertFarmActionPermission({ farm: plot.farm, userId, permission: 'CYCLE_CREATE' });
    } catch (permError) {
      if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
        return respondPermissionDenied(res, permError, 'CYCLE_CREATE');
      }
      throw permError;
    }

    await plantingService.deletePlot(id);
    return res.json({ success: true, message: 'Plot deleted' });
  } catch (error) {
    logger.error(`Error deleting plot: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

module.exports = router;
