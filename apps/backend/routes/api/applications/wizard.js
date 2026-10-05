/**
 * Wizard Configuration & Data Routes
 * API-First dynamic step management & Data Persistence
 */
const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const wizardConfigService = require('../../../services/wizard-config-service');
const wizardController = require('../../../controllers/wizard-controller'); // New Controller
const { authenticateHealth, authenticateProvider } = require('../../../middleware/auth-middleware');
const { adminOnly } = require('../../../middleware/role-middleware');

// --- Configuration Routes (Existing) ---

router.get('/config', async (req, res) => {
    try {
        const { plantId } = req.query;
        const config = await wizardConfigService.getStepConfig(plantId);
        res.json({ success: true, data: config });
    } catch (error) {
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// --- Data Routes (New) ---

/**
 * @swagger
 * /api/wizard/draft:
 *   post:
 *     tags: [Applications]
 *     summary: Persist a wizard step payload (auto-save)
 *     description: Saves an arbitrary partial wizard payload onto the authenticated applicant's draft. Idempotent — called repeatedly by the auto-save loop in the frontend.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Wizard step payload — shape is dictated by the active wizard config
 *     responses:
 *       200:
 *         description: Draft saved
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       500:
 *         description: Failed to save draft
 */
router.post('/draft', authenticateHealth, wizardController.saveDraft);

/**
 * @swagger
 * /api/wizard/draft:
 *   get:
 *     tags: [Applications]
 *     summary: Load the applicant's current wizard draft
 *     description: Returns the latest wizard draft snapshot for the authenticated HEALTH user so the wizard can resume mid-step.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current draft snapshot (or null when no draft exists)
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       500:
 *         description: Failed to load draft
 */
router.get('/draft', authenticateHealth, wizardController.getDraft);

// The draft-document upload/list/delete routes that stood here are GONE (กทล.1 v2,
// spec 2026-09-01 §6, Task 4). They were a SECOND upload door into a SECOND store:
// a file posted here landed on an ApplicationDraft row and was merged onto the
// application later, while everything a farmer actually touches — the wizard, the
// mobile app, the planting screens — posts to POST /api/applications/draft-documents.
// One paper needs one slot and one door, or the requirement lens ends up reading a
// different filing cabinet from the one the applicant filled. The content guard, the
// uploader and their two middlewares went with them; the surviving door has its own
// (applications.js, pinned by __tests__/unit/draft-document-upload-content-guard.test.js).

// Submit Final Application
router.post('/submit', authenticateHealth, wizardController.submitApplication);
// Canonical lifecycle step: prepare provisional application before phase-1 payment
router.post('/prepare', authenticateHealth, wizardController.prepareApplication);


// --- Admin Routes (Existing) ---
router.get('/admin/steps', authenticateProvider, adminOnly, async (req, res) => {
    // ... existing implementation
    const steps = await wizardConfigService.getAllSteps();
    res.json({ success: true, data: { steps } });
});

router.patch('/admin/steps/:stepKey', authenticateProvider, adminOnly, async (req, res) => {
    // ... existing implementation
    const { stepKey } = req.params;
    const updates = req.body;
    const step = await wizardConfigService.updateStep(stepKey, updates, req.user?.id);
    res.json({ success: true, data: step });
});

router.post('/admin/steps/:stepKey/toggle', authenticateProvider, adminOnly, async (req, res) => {
    // ... existing implementation
    const { stepKey } = req.params;
    const { isEnabled } = req.body;
    const step = await wizardConfigService.toggleStep(stepKey, isEnabled, req.user?.id);
    res.json({ success: true, data: step });
});

router.post('/admin/seed', authenticateProvider, adminOnly, async (req, res) => {
    // ... existing implementation
    const result = await wizardConfigService.seedDefaultSteps();
    res.json({ success: true, data: result });
});


module.exports = router;
