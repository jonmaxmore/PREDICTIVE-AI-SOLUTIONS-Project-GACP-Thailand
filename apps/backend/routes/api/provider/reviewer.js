const express = require('express');
const { providerRouteHandlers } = require('./route-registry');

const router = express.Router();

router.get('/dashboard', ...providerRouteHandlers.reviewerDashboard);
router.patch('/:id/progress', ...providerRouteHandlers.reviewSaveProgress);

module.exports = router;
