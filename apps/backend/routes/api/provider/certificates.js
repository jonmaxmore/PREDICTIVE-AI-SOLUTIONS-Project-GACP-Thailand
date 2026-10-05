const express = require('express');
const { providerRouteHandlers } = require('./route-registry');

const router = express.Router();

router.get('/dashboard', ...providerRouteHandlers.certificatesDashboard);
router.post('/bulk-notify', ...providerRouteHandlers.certificatesBulkNotify);

module.exports = router;
