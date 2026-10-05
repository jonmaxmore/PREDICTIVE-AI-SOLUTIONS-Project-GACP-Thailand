const express = require('express');
const router = express.Router();
const systemConfigController = require('../../../controllers/system-config-controller');
const { authenticateProvider, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');

const adminOnly = requireRole(ROLE_GROUPS.ADMIN_ONLY);

// Public: Fetch feature flags for UI
router.get('/public', systemConfigController.getPublicConfigs);

// Admin: Manage configurations
router.get('/', authenticateProvider, adminOnly, systemConfigController.getAllConfigs);
router.put('/:key', authenticateProvider, adminOnly, systemConfigController.updateConfig);

module.exports = router;
