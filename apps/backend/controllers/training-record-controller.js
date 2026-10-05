const trainingRecordService = require('../services/training-record-service');
const { respondError } = require('../shared/api-response');
const { createLogger } = require('../shared/logger');

const logger = createLogger('training-record-controller');

/**
 * Training Record Controller
 * API endpoints for GACP personnel training (หมวด 6)
 */

/**
 * Resolve a record by ID and verify the authenticated health user owns the
 * record's farm. Returns the record on success, or sends a 404 response and
 * returns null on failure (callers MUST early-return).
 *
 * Closes the IDOR vector on GET /:id, PUT /:id, and DELETE /:id — those
 * routes used `trainingRecordService.getRecordById(id)` directly without
 * verifying that the record's `farm.ownerId` matches `req.user.id`. Per
 * T-014 / canonical contract §5.2 health users must only see their own
 * farm's data.
 */
async function resolveOwnedRecord(req, res) {
    const { id } = req.params;
    const record = await trainingRecordService.getRecordById(id);

    if (!record) {
        res.status(404).json({ success: false, message: 'Training record not found' });
        return null;
    }

    const ownerId = record.farm?.ownerId;
    const userId = req.user?.id;
    if (!ownerId || !userId || ownerId !== userId) {
        // Return 404 (not 403) to avoid leaking the existence of records
        // that belong to other tenants.
        res.status(404).json({ success: false, message: 'Training record not found' });
        return null;
    }

    return record;
}

/**
 * Create a new training record
 * POST /api/training-records
 */
exports.createRecord = async (req, res) => {
    try {
        const { farmId, ...recordData } = req.body;
        const userId = req.user?.id;

        if (!farmId) {
            return res.status(400).json({
                success: false,
                message: 'Farm ID is required',
            });
        }

        if (!recordData.personName || !recordData.trainingTopic) {
            return res.status(400).json({
                success: false,
                message: 'Person name and training topic are required',
            });
        }

        const record = await trainingRecordService.createRecord(farmId, recordData, userId);

        logger.info(`Training record created: ${record.id} for farm ${farmId}`);

        res.status(201).json({
            success: true,
            message: 'Training record created successfully',
            data: record,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[TrainingRecord] create', message: 'Failed to create training record' });
    }
};

/**
 * Get records by farm
 * GET /api/training-records/farm/:farmId
 */
exports.getRecordsByFarm = async (req, res) => {
    try {
        const { farmId } = req.params;
        const { trainingType, personName, limit } = req.query;

        const records = await trainingRecordService.getRecordsByFarm(farmId, {
            trainingType,
            personName,
            limit: limit ? parseInt(limit) : undefined,
        });

        res.json({
            success: true,
            data: records,
            count: records.length,
        });
    } catch (error) {
        logger.error('Get farm records error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch training records' });
    }
};

/**
 * Get record by ID
 * GET /api/training-records/:id
 */
exports.getRecordById = async (req, res) => {
    try {
        const record = await resolveOwnedRecord(req, res);
        if (!record) {return;}

        res.json({
            success: true,
            data: record,
        });
    } catch (error) {
        logger.error('Get record by ID error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch training record' });
    }
};

/**
 * Update a training record
 * PUT /api/training-records/:id
 */
exports.updateRecord = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const existing = await resolveOwnedRecord(req, res);
        if (!existing) {return;}

        const updated = await trainingRecordService.updateRecord(id, updateData);

        logger.info(`Training record updated: ${id}`);

        res.json({
            success: true,
            message: 'Training record updated successfully',
            data: updated,
        });
    } catch (error) {
        logger.error('Update record error:', error);
        return respondError(res, req, error, { message: 'Failed to update training record' });
    }
};

/**
 * Delete a training record
 * DELETE /api/training-records/:id
 */
exports.deleteRecord = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await resolveOwnedRecord(req, res);
        if (!existing) {return;}

        await trainingRecordService.deleteRecord(id);

        logger.info(`Training record deleted: ${id}`);

        res.json({
            success: true,
            message: 'Training record deleted successfully',
        });
    } catch (error) {
        logger.error('Delete record error:', error);
        return respondError(res, req, error, { message: 'Failed to delete training record' });
    }
};

/**
 * Get training summary for a farm
 * GET /api/training-records/farm/:farmId/summary
 */
exports.getFarmSummary = async (req, res) => {
    try {
        const { farmId } = req.params;
        const summary = await trainingRecordService.getFarmTrainingSummary(farmId);

        res.json({
            success: true,
            data: summary,
        });
    } catch (error) {
        logger.error('Get farm summary error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch training summary' });
    }
};

/**
 * Get personnel training status
 * GET /api/training-records/farm/:farmId/personnel
 */
exports.getPersonnelStatus = async (req, res) => {
    try {
        const { farmId } = req.params;
        const personnel = await trainingRecordService.getPersonnelTrainingStatus(farmId);

        res.json({
            success: true,
            data: personnel,
            count: personnel.length,
        });
    } catch (error) {
        logger.error('Get personnel status error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch personnel status' });
    }
};

/**
 * Check training compliance
 * GET /api/training-records/farm/:farmId/compliance
 */
exports.checkCompliance = async (req, res) => {
    try {
        const { farmId } = req.params;
        const compliance = await trainingRecordService.checkTrainingCompliance(farmId);

        res.json({
            success: true,
            data: compliance,
        });
    } catch (error) {
        logger.error('Check compliance error:', error);
        return respondError(res, req, error, { message: 'Failed to check training compliance' });
    }
};

/**
 * Get training type options
 * GET /api/training-records/types
 */
exports.getTrainingTypes = (req, res) => {
    const types = [
        { value: 'GACP_BASIC', label: 'หลักสูตร GACP พื้นฐาน', labelEN: 'GACP Basic Course' },
        { value: 'HYGIENE', label: 'สุขอนามัยและความปลอดภัย', labelEN: 'Hygiene & Safety' },
        { value: 'SAFETY', label: 'ความปลอดภัยในการทำงาน', labelEN: 'Workplace Safety' },
        { value: 'PESTICIDE', label: 'การใช้สารเคมีอย่างปลอดภัย', labelEN: 'Safe Pesticide Use' },
        { value: 'HARVEST', label: 'การเก็บเกี่ยวและหลังเก็บเกี่ยว', labelEN: 'Harvest & Post-harvest' },
        { value: 'QUALITY', label: 'การควบคุมคุณภาพ', labelEN: 'Quality Control' },
        { value: 'OTHER', label: 'อื่น ๆ', labelEN: 'Other' },
    ];

    res.json({
        success: true,
        data: types,
    });
};
