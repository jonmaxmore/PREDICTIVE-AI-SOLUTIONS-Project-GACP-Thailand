const express = require('express');
const router = express.Router();
const SyncController = require('../../../controllers/sync-controller');
const { authenticateHealth, authenticateProvider } = require('../../../middleware/auth-middleware');

/**
 * Sync auth dispatcher.
 * Determines whether to use provider or health auth based on known
 * cookie presence or Authorization header format — without decoding
 * the JWT before verification (audit fix M-014).
 */
function authenticateSyncUser(req, res, next) {
  // Cookie-based dispatch (set by login flow)
  if (req.cookies?.provider_token) {
    return authenticateProvider(req, res, next);
  }

  if (req.cookies?.auth_token) {
    return authenticateHealth(req, res, next);
  }

  // Default: health auth (most sync requests come from Applicant app)
  return authenticateHealth(req, res, next);
}

// POST /api/sync/offline
router.post('/offline', authenticateSyncUser, SyncController.processOfflineSync.bind(SyncController));

module.exports = router;
