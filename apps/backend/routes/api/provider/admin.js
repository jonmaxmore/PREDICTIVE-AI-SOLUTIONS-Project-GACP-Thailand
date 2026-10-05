const express = require('express');
const { providerRouteHandlers } = require('./route-registry');

const router = express.Router();

router.post(
    '/revision-reminder-runs',
    ...providerRouteHandlers.adminRevisionReminderRuns,
);
router.post('/batch-actions', ...providerRouteHandlers.adminBatchActions);
router.get('/dashboard', ...providerRouteHandlers.adminMasterDashboard);
router.post('/deadline-extension', ...providerRouteHandlers.adminDeadlineExtension);
router.post('/status-override', ...providerRouteHandlers.adminStatusOverride);
router.post('/broadcast', ...providerRouteHandlers.adminBroadcast);
router.get('/communication-log', ...providerRouteHandlers.adminCommunicationLog);

// Wave B Phase 51 (G5) — audit log viewer
router.get('/audit-log', ...providerRouteHandlers.adminAuditLogList);
router.get('/audit-log/export.csv', ...providerRouteHandlers.adminAuditLogCsv);

module.exports = router;
