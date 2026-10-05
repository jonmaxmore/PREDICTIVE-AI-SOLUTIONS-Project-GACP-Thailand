/**
 * Seed Source Routes
 * GACP Requirement: แหล่งที่มาพันธุ์พืช + เอกสารรับรอง + ภพ.4
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
 * moved to `cultivation-record-service`. The ownership chain
 * (SeedSource → PlantingCycle → Farm.ownerId) is enforced at the
 * service boundary so a route bug cannot widen the predicate.
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


// Get all seed sources for a planting cycle
router.get('/cycle/:cycleId', authenticateHealth, async (req, res) => {
    try {
        const { cycleId } = req.params;
        const userId = req.user.id;

        // Verify cycle ownership
        const cycle = await cultivationRecordService.findCycleOwnedByUser(cycleId, userId);

        if (!cycle) {
            return res.status(404).json({ success: false, error: 'Planting cycle not found' });
        }

        const seedSources = await cultivationRecordService.listSeedSourcesByCycle(cycleId);

        res.json({ success: true, data: seedSources });
    } catch (error) {
        logger.error('[SeedSource] Get error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Create seed source
router.post('/cycle/:cycleId', authenticateHealth, async (req, res) => {
    try {
        const { cycleId } = req.params;
        const userId = req.user.id;
        const {
            sourceType,
            supplierName,
            supplierAddress,
            supplierPhone,
            supplierLicense,
            hasCertificate,
            certificateNo,
            certificateUrl,
            certificateDate,
            isPorPor4Registered,
            porPor4No,
            porPor4Url,
            varietyName,
            lotNo,
            purchaseDate,
        } = req.body;

        // Verify cycle ownership
        const cycle = await cultivationRecordService.findCycleOwnedByUser(cycleId, userId);

        if (!cycle) {
            return res.status(404).json({ success: false, error: 'Planting cycle not found' });
        }

        // Validation
        if (!sourceType) {
            return res.status(400).json({ success: false, error: 'Source type is required' });
        }

        // S9 — per-member gate on the cycle's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: cycle.farmId, userId }))) {
            return undefined;
        }

        const seedSource = await cultivationRecordService.createSeedSource({
            cycleId,
            sourceType,
            supplierName,
            supplierAddress,
            supplierPhone,
            supplierLicense,
            hasCertificate: hasCertificate || false,
            certificateNo,
            certificateUrl,
            certificateDate: certificateDate ? new Date(certificateDate) : null,
            isPorPor4Registered: isPorPor4Registered || false,
            porPor4No,
            porPor4Url,
            varietyName,
            lotNo,
            purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        });

        res.json({ success: true, data: seedSource });
    } catch (error) {
        logger.error('[SeedSource] Create error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Update seed source
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const updateData = req.body;

        // Verify ownership
        const seedSource = await cultivationRecordService.findSeedSourceOwnedByUser(id, userId);

        if (!seedSource) {
            return res.status(404).json({ success: false, error: 'Seed source not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: seedSource.cycle?.farmId, userId }))) {
            return undefined;
        }

        // Convert date strings
        if (updateData.certificateDate) {
            updateData.certificateDate = new Date(updateData.certificateDate);
        }
        if (updateData.purchaseDate) {
            updateData.purchaseDate = new Date(updateData.purchaseDate);
        }

        const updated = await cultivationRecordService.updateSeedSource(id, updateData);

        res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[SeedSource] Update error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// Delete seed source
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify ownership
        const seedSource = await cultivationRecordService.findSeedSourceOwnedByUser(id, userId);

        if (!seedSource) {
            return res.status(404).json({ success: false, error: 'Seed source not found' });
        }

        // S9 — per-member gate on the record's farm.
        if (!(await assertRecordsManageOrRespond(res, { farmId: seedSource.cycle?.farmId, userId }))) {
            return undefined;
        }

        await cultivationRecordService.deleteSeedSource(id);

        res.json({ success: true, message: 'Seed source deleted' });
    } catch (error) {
        logger.error('[SeedSource] Delete error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
