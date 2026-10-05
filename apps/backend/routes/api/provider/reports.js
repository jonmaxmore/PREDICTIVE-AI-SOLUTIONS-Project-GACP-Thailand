/**
 * Report Routes
 * /api/provider/reports/...
 */
const express = require('express');
const router = express.Router();
const reportController = require('../../../controllers/report-controller');
const { authenticateProvider, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');

router.use(authenticateProvider);
// provider-E2E carpet 2026-07-09 (LOW): /summary returns combined SUCCESS
// revenue with NO side filter, but the router had no role gate → all 7 provider
// roles (incl. single-side accountants) could read the cross-side aggregate,
// crossing the #533 finance SoD boundary. Gate to ADMIN+SCHEDULER, mirroring the
// sibling manager surfaces (analytics-work-kpis / ledger). Side-scoped revenue
// stays available to accountants via the finance getRevenueSummary endpoint.
router.use(requireRole(ROLE_GROUPS.SCHEDULERS));

// GET /api/provider/reports/summary — Monthly/quarterly summary
router.get('/summary', reportController.summary);

// GET /api/provider/reports/kpi — KPI metrics
router.get('/kpi', reportController.kpi);

module.exports = router;
