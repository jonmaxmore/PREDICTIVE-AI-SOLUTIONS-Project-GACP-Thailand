/**
 * V2 API Router - Simplified for PostgreSQL
 * Main router for V2 endpoints (Closed-loop Ecosystem)
 */

const express = require('express');
const router = express.Router();
const logger = require('../../shared/logger');

// Import V2 route modules (Prisma-compatible)
const notificationsRouter = require('./notifications');
const ticketsRouter = require('./tickets');
const kycRouter = require('./kyc');
const configRouter = require('./config');
const plantsRouter = require('./plants');
const harvestBatchesRouter = require('./harvest-batches');
const validationRouter = require('./validation');
const auditRouter = require('./audit');

// Mount V2 routes
router.use('/notifications', notificationsRouter);
router.use('/tickets', ticketsRouter);
router.use('/kyc', kycRouter);
router.use('/config', configRouter);
router.use('/plants', plantsRouter);
router.use('/harvest-batches', harvestBatchesRouter);
router.use('/validation', validationRouter);
router.use('/audit', auditRouter);

// Health check with version info
router.get('/health', (req, res) => {
  res.json({
    success: true,
    version: '2.0.0',
    database: 'postgresql',
    message: 'V2 API is running'
  });
});

// Version info endpoint
router.get('/version', (req, res) => {
  res.json({
    success: true,
    version: '2.0.0',
    minClientVersion: '1.0.0',
    features: ['notifications', 'tickets', 'kyc', 'config', 'plants', 'harvest-batches', 'validation']
  });
});

module.exports = router;

