const express = require('express');
const router = express.Router();
const trainingRecordController = require('../../../controllers/training-record-controller');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const { requireFarmOwnership } = require('../../../middleware/farm-ownership');

/**
 * Training Records Routes
 * Base path: /api/training-records
 */

// Get training type options (public)
router.get('/types', trainingRecordController.getTrainingTypes);

// Protected routes (require authentication)
router.use(authenticateHealth);

// Create a new record (farm access + Wave B per-member RECORDS_MANAGE gate;
// the legacy owner passes unchanged)
router.post('/', requireFarmOwnership({ permission: 'RECORDS_MANAGE' }), trainingRecordController.createRecord);

// Get records by farm (with ownership check)
router.get('/farm/:farmId', requireFarmOwnership(), trainingRecordController.getRecordsByFarm);

// Get training summary for a farm (with ownership check)
router.get('/farm/:farmId/summary', requireFarmOwnership(), trainingRecordController.getFarmSummary);

// Get personnel training status (with ownership check)
router.get('/farm/:farmId/personnel', requireFarmOwnership(), trainingRecordController.getPersonnelStatus);

// Check training compliance (with ownership check)
router.get('/farm/:farmId/compliance', requireFarmOwnership(), trainingRecordController.checkCompliance);

// Get single record by ID
router.get('/:id', trainingRecordController.getRecordById);

// Update a record
router.put('/:id', trainingRecordController.updateRecord);

// Delete a record
router.delete('/:id', trainingRecordController.deleteRecord);

module.exports = router;
