const express = require('express');
const router = express.Router();
const siteAnalysisController = require('../../../controllers/site-analysis-controller');
const { authenticateAny: authenticateHealth, authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireFarmOwnership } = require('../../../middleware/farm-ownership');
const { providerOnly, auditorOnly } = require('../../../middleware/role-middleware');
const siteAnalysisService = require('../../../services/site-analysis-service');

/**
 * Site Analysis Routes
 * Base path: /api/site-analyses
 */

// Get analysis type options (public)
router.get('/types', siteAnalysisController.getAnalysisTypes);

// Protected routes (require authentication)
router.use(authenticateHealth);

// List all site analyses (provider view).
// Batch 11 Prisma-bypass cleanup: previously hit prisma.siteAnalysis
// directly inside the handler, which bypassed the canonical projection.
// The service method enforces the column whitelist (Thai PDPA Act B.E.
// 2562 s.24 — purpose limitation).
router.get('/', providerOnly, async (req, res) => {
    try {
        const analyses = await siteAnalysisService.listRecentAnalyses({ take: 100 });
        res.json({ success: true, data: analyses, count: analyses.length });
    } catch (_error) {
        res.json({ success: true, data: [], count: 0 });
    }
});

// Create a new analysis (farm access + Wave B per-member RECORDS_MANAGE gate;
// the legacy owner passes unchanged)
router.post('/', requireFarmOwnership({ permission: 'RECORDS_MANAGE' }), siteAnalysisController.createAnalysis);

// Get analyses by farm (with ownership check)
router.get('/farm/:farmId', requireFarmOwnership(), siteAnalysisController.getAnalysesByFarm);

// Get latest analysis for a farm (with ownership check)
router.get('/farm/:farmId/latest', requireFarmOwnership(), siteAnalysisController.getLatestAnalysis);

// Get single analysis by ID
router.get('/:id', siteAnalysisController.getAnalysisById);

// Evaluate soil quality
router.get('/:id/evaluate-soil', siteAnalysisController.evaluateSoil);

// Get compliance score
router.get('/:id/compliance-score', siteAnalysisController.getComplianceScore);

// Update an analysis
router.put('/:id', siteAnalysisController.updateAnalysis);

// Verify analysis (auditor/reviewer/admin decision — SEC-AUDIT-005)
router.post('/:id/verify', authenticateProvider, auditorOnly, siteAnalysisController.verifyAnalysis);

// Delete an analysis
router.delete('/:id', siteAnalysisController.deleteAnalysis);

module.exports = router;
