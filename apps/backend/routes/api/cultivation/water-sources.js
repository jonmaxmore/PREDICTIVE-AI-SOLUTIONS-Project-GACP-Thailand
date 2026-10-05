/**
 * Water Source Routes
 * GACP Requirement: แหล่งน้ำและระบบกรอง
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
 * moved to `cultivation-record-service`. Ownership chain
 * (WaterSource → Plot → Farm.ownerId) lives at the service boundary.
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const cultivationRecordService = require('../../../services/cultivation-record-service');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');
// Wave B fix S9 (2026-07-03): writes gate on RECORDS_MANAGE (per-member
// engine); reads stay plain co-member.
const { assertFarmActionPermission } = require('../../../services/entity-effective-permissions-service');

/** S9 — assert RECORDS_MANAGE; writes the canonical 403 and returns false on denial. */
async function assertRecordsManageOrRespond(res, { farmId, userId }) {
    try {
        await assertFarmActionPermission({ farmId, userId, permission: 'RECORDS_MANAGE' });
        return true;
    } catch (permError) {
        if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
            res.status(403).json({
                success: false,
                code: 'ENTITY_PERMISSION_DENIED',
                permission: permError.permission || 'RECORDS_MANAGE',
                error: 'คุณไม่มีสิทธิ์จัดการบันทึกฟาร์มในพื้นที่ทำงานนี้',
            });
            return false;
        }
        throw permError;
    }
}


// Get all water sources for a plot
router.get('/plot/:plotId', authenticateHealth, async (req, res) => {
    try {
        const { plotId } = req.params;
        const userId = req.user.id;

        // Verify plot ownership
        const plot = await cultivationRecordService.findPlotOwnedByUser(plotId, userId);

        if (!plot) {
            return res.status(404).json({ success: false, error: 'Plot not found' });
        }

        const waterSources = await cultivationRecordService.listWaterSourcesByPlot(plotId);

        res.json({ success: true, data: waterSources });
    } catch (error) {
        logger.error('[WaterSource] Get error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Create water source
router.post('/plot/:plotId', authenticateHealth, async (req, res) => {
    try {
        const { plotId } = req.params;
        const userId = req.user.id;
        const {
            sourceType,
            filtrationTypes,
            irrigationType,
            isTested,
            testDate,
            testResults,
            testDocumentUrl,
            description,
        } = req.body;

        // Verify plot ownership
        const plot = await cultivationRecordService.findPlotOwnedByUser(plotId, userId);

        if (!plot) {
            return res.status(404).json({ success: false, error: 'Plot not found' });
        }

        // Validation
        if (!sourceType) {
            return res.status(400).json({ success: false, error: 'Source type is required' });
        }

        // S9 — per-member gate on the plot's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: plot.farmId, userId }))) {
            return undefined;
        }

        const waterSource = await cultivationRecordService.createWaterSource({
            plotId,
            sourceType,
            filtrationTypes: filtrationTypes || [],
            irrigationType,
            isTested: isTested || false,
            testDate: testDate ? new Date(testDate) : null,
            testResults,
            testDocumentUrl,
            description,
        });

        res.json({ success: true, data: waterSource });
    } catch (error) {
        logger.error('[WaterSource] Create error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Update water source
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const updateData = req.body;

        // Verify ownership
        const waterSource = await cultivationRecordService.findWaterSourceOwnedByUser(id, userId);

        if (!waterSource) {
            return res.status(404).json({ success: false, error: 'Water source not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: waterSource.plot?.farmId, userId }))) {
            return undefined;
        }

        // Convert date strings to Date objects
        if (updateData.testDate) {
            updateData.testDate = new Date(updateData.testDate);
        }

        const updated = await cultivationRecordService.updateWaterSource(id, updateData);

        res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[WaterSource] Update error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Delete water source
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify ownership
        const waterSource = await cultivationRecordService.findWaterSourceOwnedByUser(id, userId);

        if (!waterSource) {
            return res.status(404).json({ success: false, error: 'Water source not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: waterSource.plot?.farmId, userId }))) {
            return undefined;
        }

        await cultivationRecordService.deleteWaterSource(id);

        res.json({ success: true, message: 'Water source deleted' });
    } catch (error) {
        logger.error('[WaterSource] Delete error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
