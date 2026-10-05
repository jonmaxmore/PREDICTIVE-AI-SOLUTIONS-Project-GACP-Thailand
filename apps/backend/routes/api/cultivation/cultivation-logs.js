const express = require('express');
const router = express.Router();
const cultivationLogController = require('../../../controllers/cultivation-log-controller');
const { authenticateHealth } = require('../../../middleware/auth-middleware');

/**
 * Cultivation Log Routes
 * Base path: /api/cultivation-logs
 */

// Get log type options (public)
router.get('/types', cultivationLogController.getLogTypes);

// Protected routes (require authentication)
router.use(authenticateHealth);

// Create a new log
router.post('/', cultivationLogController.createLog);

// Get logs by planting cycle
router.get('/cycle/:cycleId', cultivationLogController.getLogsByCycle);

// Get summary for a cycle
router.get('/cycle/:cycleId/summary', cultivationLogController.getCycleSummary);

// Get logs by farm
router.get('/farm/:farmId', cultivationLogController.getLogsByFarm);

// Get single log by ID
router.get('/:id', cultivationLogController.getLogById);

// Update a log
router.put('/:id', cultivationLogController.updateLog);

// Delete a log
router.delete('/:id', cultivationLogController.deleteLog);

module.exports = router;
