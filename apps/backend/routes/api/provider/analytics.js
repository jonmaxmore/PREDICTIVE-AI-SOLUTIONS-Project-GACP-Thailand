const express = require('express');
const { providerRouteHandlers } = require('./route-registry');

const router = express.Router();

router.get('/performance', ...providerRouteHandlers.analyticsPerformance);

module.exports = router;
