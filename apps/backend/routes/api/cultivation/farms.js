/**
 * @swagger
 * tags:
 *   name: Farms
 *   description: Farm establishment management
 */

const express = require('express');
const router = express.Router();
const farmService = require('../../../services/farm-service');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const upload = require('../../../middleware/upload-middleware');
const rejectBadUpload = require('../../../middleware/reject-bad-upload');
const logger = require('../../../shared/logger');
// Wave B chunk 4 — per-member workspace permission gate (FARM_CREATE).
const { assertEntityActionPermission } = require('../../../services/entity-effective-permissions-service');

/** Map an ENTITY_PERMISSION_DENIED throw to the canonical 403 body; rethrow others. */
function respondPermissionDenied(res, error, fallbackPermission) {
    return res.status(403).json({
        success: false,
        code: 'ENTITY_PERMISSION_DENIED',
        permission: error?.permission || fallbackPermission,
        error: 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน',
    });
}

/**
 * @swagger
 * /api/farms:
 *   get:
 *     summary: Get all farms for authenticated user
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of farms
 */
router.get('/', authenticateHealth, async (req, res) => {
    try {
        const farms = await farmService.getByOwner(req.user.id);
        res.json({
            success: true,
            count: farms.length,
            data: farms,
        });
    } catch (error) {
        logger.error('[Farms] Error fetching farms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farms' });
    }
});

/**
 * @swagger
 * /api/farms/my:
 *   get:
 *     summary: Get all my farms
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of farms
 */
router.get('/my', authenticateHealth, async (req, res) => {
    try {
        const farms = await farmService.getByOwner(req.user.id);
        res.json({
            success: true,
            count: farms.length,
            data: farms,
        });
    } catch (error) {
        logger.error('[Farms] Error fetching farms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farms' });
    }
});

/**
 * @swagger
 * /api/farms/my/eligible-for-planting:
 *   get:
 *     summary: Get farms eligible for planting cycle creation
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of farms with active certificate and at least one plot
 */
router.get('/my/eligible-for-planting', authenticateHealth, async (req, res) => {
    try {
        // Spec 2026-09-30 §3.1 (R1): the certificate read carries the holder scope.
        const { holderScope } = require('../../../services/holder-access');
        const farms = await farmService.getEligibleForPlanting(req.user.id, { holderScope: await holderScope(req) });
        res.json({
            success: true,
            count: farms.length,
            data: farms,
        });
    } catch (error) {
        logger.error('[Farms] Error fetching eligible planting farms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch eligible farms' });
    }
});

/**
 * @swagger
 * /api/farms/{id}:
 *   get:
 *     summary: Get farm details
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        const farm = await farmService.getById(req.params.id, req.user.id);

        if (!farm) {
            return res.status(404).json({ success: false, message: 'Farm not found' });
        }

        res.json({ success: true, data: farm });
    } catch (error) {
        logger.error('[Farms] Error fetching farm:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm' });
    }
});

/**
 * @swagger
 * /api/farms:
 *   post:
 *     summary: Create new farm
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               farmName:
 *                 type: string
 *               address:
 *                 type: string
 *               evidence_photo:
 *                 type: string
 *                 format: binary
 */
router.post('/', authenticateHealth, upload.single('evidence_photo'), rejectBadUpload, async (req, res) => {
    try {
        const { farmName, address, province, district, subDistrict } = req.body;

        if (!farmName || !address || !province || !district || !subDistrict) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields',
            });
        }

        // Wave B chunk 4 — FARM_CREATE gate, WORKSPACE context only. Rule (b):
        // personal context (solo farmer / owner under their own personal
        // INDIVIDUAL entity) and no-context callers stay byte-identical —
        // only an explicit workspace (personal:false) is permission-gated.
        if (req.activeEntity?.entityId && req.activeEntity.personal !== true) {
            try {
                await assertEntityActionPermission({
                    entityId: req.activeEntity.entityId,
                    userId: req.user.id,
                    permission: 'FARM_CREATE',
                });
            } catch (permError) {
                if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
                    return respondPermissionDenied(res, permError, 'FARM_CREATE');
                }
                throw permError;
            }
        }

        // Wave A chunk 2 — thread the active workspace so the farm joins the
        // entity dimension (default = personal INDIVIDUAL entity, resolved by
        // active-entity-middleware when no x-active-entity-id header is sent).
        const farm = await farmService.createFarm(req.user.id, req.body, req.file, {
            entityId: req.activeEntity?.entityId || null,
        });

        logger.info(`[Farms] Farm created: ${farm.id} by user ${req.user.id}`);

        res.status(201).json({
            success: true,
            message: 'Farm created successfully',
            data: farm,
        });
    } catch (error) {
        logger.error('[Farms] Error creating farm:', error);
        res.status(500).json({ success: false, error: 'Failed to create farm' });
    }
});

/**
 * @swagger
 * /api/farms/{id}:
 *   patch:
 *     summary: Update farm
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 */
router.patch('/:id', authenticateHealth, async (req, res) => {
    try {
        const updated = await farmService.updateFarm(req.params.id, req.user.id, req.body);

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Farm not found or access denied' });
        }

        res.json({
            success: true,
            message: 'Farm updated successfully',
            data: updated,
        });
    } catch (error) {
        // Wave B chunk 4 — farm-service.updateFarm gates on EDIT_FARM and
        // throws ENTITY_PERMISSION_DENIED for a co-member without it.
        if (error?.code === 'ENTITY_PERMISSION_DENIED') {
            return respondPermissionDenied(res, error, 'EDIT_FARM');
        }
        logger.error('[Farms] Error updating farm:', error);
        res.status(500).json({ success: false, error: 'Failed to update farm' });
    }
});

/**
 * @swagger
 * /api/farms/{id}:
 *   delete:
 *     summary: Delete farm
 *     tags: [Farms]
 *     security:
 *       - BearerAuth: []
 */
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const deleted = await farmService.deleteFarm(req.params.id, req.user.id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Farm not found or access denied' });
        }

        res.json({ success: true, message: 'Farm deleted successfully' });
    } catch (error) {
        logger.error('[Farms] Error deleting farm:', error);
        res.status(500).json({ success: false, error: 'Failed to delete farm' });
    }
});

// ── ไม่มีประตู QR ระดับฟาร์ม (ถอดออก 2026-09-05, มติ operator) ─────────────────
// `GET /:id/qrcode` เคยคืนสติกเกอร์ HTML ที่มี QR ชี้ไป /verify/farm/<farm.id>
// ซึ่งไม่มีปลายทางอยู่จริง และฝังกุญแจหลักของฟาร์มลงบนกระดาษที่เรียกคืนไม่ได้
// เหตุผลเต็มอยู่ที่ services/farm-service.js ตรงจุดที่เมธอดเคยอยู่

module.exports = router;
