/**
 * Planting Cycle APIs (Health runtime)
 * Canonical flow: cycle -> plots -> activities -> harvest batch/lot
 *
 * Resolution stops at the plot and the cycle. Per-plant tracking was retired
 * permanently by the planting/T&T spec (R8): a plot of 100 plants carries one
 * code, not 100. "จำนวนต้น" survives only as plannedPlantCount — a number on the
 * cycle — never as tracked rows, so nothing here mints or reads per-plant units.
 */


const express = require('express');
const router = express.Router();
const { classifyCycleValidationError } = require('../../../services/planting-cycle-refusals');
const plantingService = require('../../../services/planting-service');
const { prisma } = require('../../../services/prisma-database');
const qrcodeService = require('../../../services/qrcode/qrcode-service');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const { storedAreaToSqm } = require('../../../shared/area-utils');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const { registerPlotRoutes } = require('./planting-cycles-plot-routes');
const { registerActivityAndHarvestRoutes } = require('./planting-cycles-activity-harvest-routes');

const {
  // Constants
  ALLOWED_ACTIVITY_SCOPE,
  ALLOWED_ACTIVITY_TYPES,
  // Helpers
  getAuthenticatedUserId,
  toPositiveInt,
  normalizeActivityType,
  normalizeActivityScope,
  normalizeAttachmentIds,
  toActivityResponse,
  buildPlotCycleEntityId,
  // Query functions
  loadOwnedCycleWithPlots,
  verifyOwnedFarm,
  generatePlotCycleQrsForCycle,
  // Middleware
  ensureCycleOwned,
  // Wave B fix M2 — read-shaped reachability for gated mutation routes
  ensureCycleReachable,
  // Wave B chunk 4 — per-permission gates
  requireCycleFarmPermission,
  resolveActivityPermission,
  assertFarmPermission,
} = require('../../../services/planting-cycle-service');

// Sunset dates are deployment-visible policy, so they resolve in config/ where a
// release owner can find them — not from a process.env read inside a route file.
const { HARVEST_LEGACY_SUNSET } = require('../../../config/api-deprecation-policy');


router.use(authenticateHealth);

// GET /integrity/report and GET /:id/integrity were deleted on 2026-08-25.
//
// Both served one thing: buildCycleIntegrity, a per-plant unit audit that
// compared generated PlantUnit rows against the planned count and reported the
// drift (overPlanCount, unassignedCount, legacy-data flags, traceabilityReady).
// Spec R8 retires per-plant tracking, so there is no quota to reconcile and no
// drift to measure — the declared plant count is a number the farmer types, and
// nothing counts rows against it. The endpoints are gone rather than returning an
// all-zero report, which would claim the rows were counted and found in order.
router.get('/my', async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const cycles = await plantingService.listByOwner(userId, req.query.status);

    return res.json({
      success: true,
      count: cycles.length,
      data: cycles,
    });
  } catch (error) {
    logger.error('Error fetching owned planting cycles:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch planting cycles' });
  }
});

router.get('/capacity/summary', async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const farmIdFilter = String(req.query.farmId || '').trim();
    const { getCapacitySummary } = require('../../../services/planting-cycle-service');
    const { holderScope } = require('../../../services/holder-access');
    const result = await getCapacitySummary(userId, farmIdFilter || null, { holderScope: await holderScope(req) });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Error fetching planting capacity summary:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch capacity summary' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { farmId, status } = req.query;
    const userId = getAuthenticatedUserId(req);

    if (!farmId) {
      return res.status(400).json({ success: false, message: 'farmId is required' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const ownedFarm = await verifyOwnedFarm(farmId, userId);
    if (!ownedFarm) {
      return res.status(404).json({ success: false, error: 'Farm not found' });
    }

    const cycles = await plantingService.listByFarm(String(farmId), status);

    return res.json({
      success: true,
      count: cycles.length,
      data: cycles,
    });
  } catch (error) {
    logger.error('Error fetching farm planting cycles:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch planting cycles' });
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const payload = req.body || {};
    const {
      farmId,
      plantSpeciesId,
      cycleName,
      startDate,
      plotAssignments,
      plotId,
    } = payload;

    if (!farmId || !plantSpeciesId || !cycleName || !startDate) {
      return res.status(400).json({
        success: false,
        message: 'farmId, plantSpeciesId, cycleName, and startDate are required',
      });
    }

    const hasPlotAssignments = Array.isArray(plotAssignments) && plotAssignments.length > 0;
    const hasLegacyPlot = Boolean(String(plotId || '').trim());

    if (!hasPlotAssignments && !hasLegacyPlot) {
      return res.status(400).json({
        success: false,
        message: 'plotAssignments must contain at least one plot',
      });
    }

    // Wave B fix M2 — READ-shaped reachability: the CYCLE_CREATE engine gate
    // below is the sole mutation authority (a VIEWER holding a GRANT must
    // not be 404'd before the engine runs; an un-granted VIEWER is denied
    // by the gate — same net posture as the old floor).
    const ownedFarm = await verifyOwnedFarm(farmId, userId);
    if (!ownedFarm) {
      return res.status(404).json({ success: false, error: 'Farm not found' });
    }

    // Wave B chunk 4 — per-member gate: legacy owner always passes; a
    // workspace co-member must hold effective CYCLE_CREATE.
    try {
      await assertFarmPermission({ farmId: ownedFarm.id, userId, permission: 'CYCLE_CREATE', req });
    } catch (permError) {
      if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
        return res.status(403).json({
          success: false,
          code: 'ENTITY_PERMISSION_DENIED',
          permission: permError.permission || 'CYCLE_CREATE',
          error: 'คุณไม่มีสิทธิ์สร้างรอบปลูกในพื้นที่ทำงานนี้',
        });
      }
      throw permError;
    }

    const created = await plantingService.createCycle(payload);

    // Creating a cycle used to mint one PlantUnit row per planned plant (a
    // single press produced 500 of them, which the harvest then linked into its
    // evidence chain). Spec R8 retired per-plant tracking: the only automation a
    // new cycle now performs is the per-PLOT QR, so `automation` reports that
    // alone — there is no plantUnits key to report a zero for, because per-plant
    // generation is not a thing the platform does any more.
    const warnings = [];
    const automation = {
      plotQr: {
        status: 'failed',
        generatedCount: 0,
        missingCount: 0,
      },
    };

    try {
      const cycleWithPlots = await loadOwnedCycleWithPlots(created.id, userId);
      if (!cycleWithPlots) {
        automation.plotQr.status = 'failed';
        warnings.push('ไม่สามารถสร้าง QR รายแปลงอัตโนมัติได้');
      } else {
        const qrResult = await generatePlotCycleQrsForCycle(cycleWithPlots);
        automation.plotQr.status = qrResult.status;
        automation.plotQr.generatedCount = qrResult.generated.length;
        automation.plotQr.missingCount = qrResult.missingCount;
        if (qrResult.status === 'failed' && qrResult.error) {
          warnings.push(qrResult.error);
        } else if (qrResult.status === 'partial') {
          // Bug 8.4 (adversarial-verify): the service now emits a REAL 'partial'
          // status. Surface it as a warning — pre-fix a per-plot failure threw
          // and produced a yellow warning toast; without this branch the same
          // failure would show a green success toast while some plots have no QR.
          warnings.push(`สร้าง QR รายแปลงได้ ${qrResult.generated.length} แปลง ล้มเหลว ${qrResult.missingCount} แปลง (ลองสร้างใหม่ได้จากหน้ารอบปลูก)`);
        }
      }
    } catch (qrError) {
      automation.plotQr.status = 'failed';
      warnings.push(qrError.message || 'Plot QR was not generated automatically');
    }

    return res.status(201).json({
      success: true,
      message: 'Planting cycle created successfully',
      data: {
        ...created,
        automation,
        warnings,
      },
      warnings,
    });
  } catch (error) {
    // R15 conflict (services/planting-service.js:95) is a client-fixable state, not a server
    // fault: the farmer must close the round already standing on that plot. It is surfaced
    // verbatim because the service authored the message for the farmer — safeErrorMessage
    // exists to stop ORM/stack internals leaking, and would replace this one with a generic
    // 500 fallback that tells them nothing about which plot or which cycle is in the way.
    if (error?.code === 'PLOT_ALREADY_HAS_OPEN_CYCLE') {
      return res.status(409).json({
        success: false,
        code: error.code,
        error: error.message,
        plotId: error.plotId,
        conflictingCycleId: error.conflictingCycleId,
      });
    }
    // ยังไม่มีใบรับรอง = สถานะที่ผู้ยื่นแก้ได้เอง (ยื่นคำขอก่อน) ไม่ใช่ความผิดพลาดของเซิร์ฟเวอร์
    // ส่งข้อความไทยที่บริการเขียนไว้ออกไปตรง ๆ เพราะมันถูกเขียนมาให้เกษตรกรอ่าน
    if (error?.code === 'PLANTING_REQUIRES_CERTIFICATE') {
      return res.status(409).json({
        success: false,
        code: error.code,
        error: error.message,
        messageTh: error.messageTh,
      });
    }
    // ด่านตามกฎของ planting-service โยน Error ธรรมดา ประตูจึงเคยตอบ 500 ให้ทุกกรณี —
    // เกษตรกรที่ระบุพื้นที่เกินขนาดแปลงได้แค่คำว่า "ล้มเหลว" เป็นภาษาอังกฤษ ทั้งที่ระบบรู้เหตุผล
    const refusal = classifyCycleValidationError(error);
    if (refusal) {
      logger.info(`[PlantingCycle] refused: ${refusal.code} — ${refusal.error}`);
      return res.status(refusal.status).json({
        success: false,
        code: refusal.code,
        error: refusal.error,
        messageTh: refusal.messageTh,
      });
    }
    logger.error('Error creating planting cycle:', error);
    return res.status(500).json({ success: false, error: safeErrorMessage(error, 'Failed to create planting cycle') });
  }
});

router.get('/:id', ensureCycleOwned, async (req, res) => {
  try {
    const cycle = await plantingService.getById(req.params.id);

    if (!cycle) {
      return res.status(404).json({ success: false, message: 'Planting cycle not found' });
    }

    return res.json({ success: true, data: cycle });
  } catch (error) {
    logger.error('Error fetching planting cycle detail:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch planting cycle' });
  }
});

router.patch('/:id', ensureCycleOwned, async (req, res) => {
  try {
    const cycle = await plantingService.updateCycle(req.params.id, req.body || {});

    return res.json({
      success: true,
      message: 'Planting cycle updated successfully',
      data: cycle,
    });
  } catch (error) {
    // Same R15 conflict as POST — re-plotting a cycle onto occupied ground. 409 rather than
    // the generic 400 so a client can tell "your request was malformed" from "that plot is taken".
    if (error?.code === 'PLOT_ALREADY_HAS_OPEN_CYCLE') {
      return res.status(409).json({
        success: false,
        code: error.code,
        error: error.message,
        plotId: error.plotId,
        conflictingCycleId: error.conflictingCycleId,
      });
    }
    // การปฏิเสธที่บริการเขียนไว้ครบรูปแล้ว ต้องออกไปทั้งรูป — CYCLE_FROZEN ตั้ง statusCode 409
    // (ชนกับสถานะของข้อมูล) ไม่ใช่ 400 (คำขอผิดรูป) และหน้าจอควรเลือกคำอธิบายจาก `code`
    // ไม่ใช่จากการจับคู่ข้อความ · กิ่งนี้เคยยุบทุกอย่างเหลือ 400 โดยทิ้ง code และ fields
    if (error?.statusCode || error?.code === 'CYCLE_FROZEN') {
      return res.status(error.statusCode || 409).json({
        success: false,
        ...(error.code ? { code: error.code } : {}),
        error: error.message,
        ...(Array.isArray(error.fields) ? { fields: error.fields } : {}),
      });
    }
    logger.error('Error updating planting cycle:', error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to update planting cycle' });
  }
});

registerPlotRoutes(router, {
  ensureCycleOwned,
  ensureCycleReachable,
  requireCycleFarmPermission,
  getAuthenticatedUserId,
  prisma,
  logger,
  loadOwnedCycleWithPlots,
  generatePlotCycleQrsForCycle,
  buildPlotCycleEntityId,
});

registerActivityAndHarvestRoutes(router, {
  ensureCycleOwned,
  ensureCycleReachable,
  requireCycleFarmPermission,
  resolveActivityPermission,
  HARVEST_LEGACY_SUNSET,
  getAuthenticatedUserId,
  prisma,
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
});

module.exports = router;
