/**
 * Fertilizer Record Routes
 * GACP Requirement: ทะเบียนปุ๋ย (เลข อย./ทะเบียน)
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
 * moved to `cultivation-record-service`. Ownership chain
 * (FertilizerRecord → PlantingCycle → Farm.ownerId) is enforced at
 * the service boundary.
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


// Get all fertilizer records for a planting cycle
router.get('/cycle/:cycleId', authenticateHealth, async (req, res) => {
    try {
        const { cycleId } = req.params;
        const userId = req.user.id;

        // Verify cycle ownership
        const cycle = await cultivationRecordService.findCycleOwnedByUser(cycleId, userId);

        if (!cycle) {
            return res.status(404).json({ success: false, error: 'Planting cycle not found' });
        }

        const records = await cultivationRecordService.listFertilizerRecordsByCycle(cycleId);

        res.json({ success: true, data: records });
    } catch (error) {
        logger.error('[FertilizerRecord] Get error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Create fertilizer record
router.post('/cycle/:cycleId', authenticateHealth, async (req, res) => {
    try {
        const { cycleId } = req.params;
        const userId = req.user.id;
        const {
            brandName,
            productName,
            registrationNo,
            type,
            usageDate,
            amount,
            unit,
            applicationMethod,
            npkN,
            npkP,
            npkK,
            purchasedFrom,
            batchNo,
            withholdingDays,
            productLabelUrl,
            msdsUrl,
            notes,
        } = req.body;

        // Verify cycle ownership
        const cycle = await cultivationRecordService.findCycleOwnedByUser(cycleId, userId);

        if (!cycle) {
            return res.status(404).json({ success: false, error: 'Planting cycle not found' });
        }

        // Validation
        if (!brandName || !registrationNo) {
            return res.status(400).json({
                success: false,
                error: 'Brand name and registration number are required',
            });
        }

        // S9 — per-member gate on the cycle's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: cycle.farmId, userId }))) {
            return undefined;
        }

        const record = await cultivationRecordService.createFertilizerRecord({
            cycleId,
            brandName,
            productName,
            registrationNo,
            type: type || 'CHEMICAL',
            usageDate: new Date(usageDate),
            amount: parseFloat(amount),
            unit: unit || 'kg',
            applicationMethod,
            npkN: npkN ? parseFloat(npkN) : null,
            npkP: npkP ? parseFloat(npkP) : null,
            npkK: npkK ? parseFloat(npkK) : null,
            purchasedFrom,
            batchNo,
            withholdingDays: withholdingDays ? parseInt(withholdingDays) : null,
            productLabelUrl,
            msdsUrl,
            recordedBy: userId,
            notes,
        });

        res.json({ success: true, data: record });
    } catch (error) {
        logger.error('[FertilizerRecord] Create error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Update fertilizer record
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const updateData = req.body;

        // Verify ownership
        const record = await cultivationRecordService.findFertilizerRecordOwnedByUser(id, userId);

        if (!record) {
            return res.status(404).json({ success: false, error: 'Fertilizer record not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: record.cycle?.farmId, userId }))) {
            return undefined;
        }

        // Convert date
        if (updateData.usageDate) {
            updateData.usageDate = new Date(updateData.usageDate);
        }

        const updated = await cultivationRecordService.updateFertilizerRecord(id, updateData);

        res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[FertilizerRecord] Update error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Delete fertilizer record
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify ownership
        const record = await cultivationRecordService.findFertilizerRecordOwnedByUser(id, userId);

        if (!record) {
            return res.status(404).json({ success: false, error: 'Fertilizer record not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: record.cycle?.farmId, userId }))) {
            return undefined;
        }

        await cultivationRecordService.deleteFertilizerRecord(id);

        res.json({ success: true, message: 'Fertilizer record deleted' });
    } catch (error) {
        logger.error('[FertilizerRecord] Delete error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
