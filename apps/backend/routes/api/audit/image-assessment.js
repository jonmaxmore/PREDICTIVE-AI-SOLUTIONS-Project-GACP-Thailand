'use strict';

/**
 * Image Assessment routes — สัญญา C05F680149 ต้นแบบที่ 6 "ระบบตรวจสอบและ
 * ประเมิน (3 โมดูล)". Mounted at /api/image-assessment.
 *
 * AUDIT_STAFF tool (authenticateProvider + requireRole). Image bytes are held
 * in memory (sharp reads a Buffer) — no temp file. Advisory only; never
 * decides certification.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const imageAssessment = require('../../../services/image-assessment/image-assessment-service');
const { authenticateProvider, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const { multipartLimits } = require('../../../shared/multipart-limits');

const upload = multer({
    storage: multer.memoryStorage(),
    // 15MB, one image; the page sends herbCode alongside it
    limits: multipartLimits({ fileSize: 15 * 1024 * 1024, files: 1, fields: 10 }),
});

// All endpoints require an authenticated provider in the audit-staff group.
router.use(authenticateProvider, requireRole(ROLE_GROUPS.AUDIT_STAFF));

function sendError(res, error, fallback) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) {
        logger.error(`[ImageAssessment] ${fallback}:`, error);
    }
    res.status(statusCode).json({
        success: false,
        error: error.code || 'IMAGE_ASSESSMENT_FAILED',
        message: statusCode >= 500 ? fallback : safeErrorMessage(error),
    });
}

/** GET /catalog — the 3 modules' catalog (7 diseases, 5 dims, provider, target) */
router.get('/catalog', (req, res) => {
    res.json({ success: true, data: imageAssessment.getCatalog() });
});

/** POST /assess — multipart image → 6.1 inspection + 6.3 disease detection */
router.post('/assess', upload.single('image'), async (req, res) => {
    if (!req.file?.buffer) {
        return res.status(400).json({
            success: false,
            error: 'NO_IMAGE',
            message: 'A file field "image" is required',
        });
    }
    try {
        const result = await imageAssessment.assessImage(req.file.buffer, {
            herbCode: req.body?.herbCode,
        });
        res.json({ success: true, data: result });
    } catch (error) {
        sendError(res, error, 'Failed to assess image');
    }
});

/** POST /quality-score — 6.2 product quality (5 dims) + digital certificate */
router.post('/quality-score', (req, res) => {
    try {
        const result = imageAssessment.scoreProductQuality(req.body?.subScores, {
            herbCode: req.body?.herbCode,
            batchNumber: req.body?.batchNumber,
            issuedAt: new Date().toISOString(),
        });
        res.json({ success: true, data: result });
    } catch (error) {
        sendError(res, error, 'Failed to score product quality');
    }
});

/** POST /evaluate — KPI harness: labelled samples → confusion matrix + ≥85% */
router.post('/evaluate', (req, res) => {
    if (!Array.isArray(req.body?.samples)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_SAMPLES',
            message: 'Body must be { samples: [{actual, predicted}, ...] }',
        });
    }
    try {
        const result = imageAssessment.evaluateModel(req.body.samples);
        res.json({ success: true, data: result });
    } catch (error) {
        sendError(res, error, 'Failed to evaluate classifier');
    }
});

module.exports = router;
