/**
 * Controlled Environment Routes
 * GACP Requirement: อาคารควบคุม (รูปแบบ + อุณหภูมิ)
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
 * moved to `cultivation-record-service`. Ownership chain
 * (ControlledEnvironment → Plot → Farm.ownerId) lives at the
 * service boundary.
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


// Get all controlled environments for a plot
router.get('/plot/:plotId', authenticateHealth, async (req, res) => {
    try {
        const { plotId } = req.params;
        const userId = req.user.id;

        // Verify plot ownership
        const plot = await cultivationRecordService.findPlotOwnedByUser(plotId, userId);

        if (!plot) {
            return res.status(404).json({ success: false, error: 'Plot not found' });
        }

        const environments = await cultivationRecordService.listControlledEnvironmentsByPlot(plotId);

        res.json({ success: true, data: environments });
    } catch (error) {
        logger.error('[ControlledEnvironment] Get error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Create controlled environment
router.post('/plot/:plotId', authenticateHealth, async (req, res) => {
    try {
        const { plotId } = req.params;
        const userId = req.user.id;
        const {
            structureType,
            areaSqm,
            heightM,
            hasTempControl,
            tempControlType,
            tempRangeMin,
            tempRangeMax,
            targetTemp,
            hasHumidityControl,
            humidityRangeMin,
            humidityRangeMax,
            targetHumidity,
            hasLightControl,
            lightControlType,
            lightHoursPerDay,
            hasVentilation,
            ventilationType,
            roofMaterial,
            wallMaterial,
            isGmpCertified,
            gmpCertificateNo,
            gmpCertUrl,
            photos,
            notes,
        } = req.body;

        // Verify plot ownership
        const plot = await cultivationRecordService.findPlotOwnedByUser(plotId, userId);

        if (!plot) {
            return res.status(404).json({ success: false, error: 'Plot not found' });
        }

        // Validation
        if (!structureType) {
            return res.status(400).json({ success: false, error: 'Structure type is required' });
        }

        // S9 — per-member gate on the plot's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: plot.farmId, userId }))) {
            return undefined;
        }

        const environment = await cultivationRecordService.createControlledEnvironment({
            plotId,
            structureType,
            areaSqm: areaSqm ? parseFloat(areaSqm) : null,
            heightM: heightM ? parseFloat(heightM) : null,
            hasTempControl: hasTempControl || false,
            tempControlType,
            tempRangeMin: tempRangeMin ? parseInt(tempRangeMin) : null,
            tempRangeMax: tempRangeMax ? parseInt(tempRangeMax) : null,
            targetTemp: targetTemp ? parseInt(targetTemp) : null,
            hasHumidityControl: hasHumidityControl || false,
            humidityRangeMin: humidityRangeMin ? parseInt(humidityRangeMin) : null,
            humidityRangeMax: humidityRangeMax ? parseInt(humidityRangeMax) : null,
            targetHumidity: targetHumidity ? parseInt(targetHumidity) : null,
            hasLightControl: hasLightControl || false,
            lightControlType,
            lightHoursPerDay: lightHoursPerDay ? parseInt(lightHoursPerDay) : null,
            hasVentilation: hasVentilation || false,
            ventilationType,
            roofMaterial,
            wallMaterial,
            isGmpCertified: isGmpCertified || false,
            gmpCertificateNo,
            gmpCertUrl,
            photos: photos || [],
            notes,
        });

        res.json({ success: true, data: environment });
    } catch (error) {
        logger.error('[ControlledEnvironment] Create error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Update controlled environment
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const updateData = req.body;

        // Verify ownership
        const environment = await cultivationRecordService.findControlledEnvironmentOwnedByUser(id, userId);

        if (!environment) {
            return res.status(404).json({ success: false, error: 'Controlled environment not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: environment.plot?.farmId, userId }))) {
            return undefined;
        }

        const updated = await cultivationRecordService.updateControlledEnvironment(id, updateData);

        res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[ControlledEnvironment] Update error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Delete controlled environment
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify ownership
        const environment = await cultivationRecordService.findControlledEnvironmentOwnedByUser(id, userId);

        if (!environment) {
            return res.status(404).json({ success: false, error: 'Controlled environment not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: environment.plot?.farmId, userId }))) {
            return undefined;
        }

        await cultivationRecordService.deleteControlledEnvironment(id);

        res.json({ success: true, message: 'Controlled environment deleted' });
    } catch (error) {
        logger.error('[ControlledEnvironment] Delete error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
