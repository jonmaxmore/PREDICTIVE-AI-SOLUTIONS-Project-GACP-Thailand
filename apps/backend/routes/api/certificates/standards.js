const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const certificateService = require('../../../services/certificate-service');
const standardsAnalyzer = require('../../../services/standards-analyzer-service');
const { authenticateAny } = require('../../../middleware/auth-middleware');
const { normalizeRole } = require('../../../shared/canonical-rbac');
const logger = require('../../../shared/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/standards
 * List all active certification standards with their requirements
 */
router.get('/', async (req, res) => {
    try {
        const standards = await certificateService.listActiveStandards();
        res.json({
            success: true,
            count: standards.length,
            data: standards,
        });
    } catch (error) {
        logger.error('Error fetching standards:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch standards',
            error: safeErrorMessage(error),
        });
    }
});

/**
 * GET /api/standards/asean/comparison
 * สัญญา C05F680149 ต้นแบบที่ 1.3 — ตารางเปรียบเทียบมาตรฐาน 10 ประเทศอาเซียน.
 * Static reference content (no PII) — public, same as the standards list above.
 * NOTE: must be declared BEFORE the parameterized /:code route.
 */
router.get('/asean/comparison', (req, res) => {
    const rows = standardsAnalyzer.getAseanComparison();
    res.json({
        success: true,
        count: rows.length,
        data: rows,
        note: 'ข้อมูลอ้างอิงเรียบเรียง ณ ก.ค. 2569 ตรวจทานโดยทีมวิจัยก่อนใช้อ้างอิงภายนอก',
    });
});

/**
 * GET /api/standards/:code/analyze/:applicationId
 * สัญญา C05F680149 ต้นแบบที่ 1.1/1.2 — gap analysis ของคำขอหนึ่งใบเทียบมาตรฐาน
 * (WHO / THAI_GACP / ASEAN / FDA). authenticateAny: provider staff วิเคราะห์ได้
 * ทุกคำขอในองค์กร (tenant scope via runWithTenantContext), HEALTH เฉพาะคำขอ
 * ของตัวเอง (non-owner → 404 anti-probe, enforced in the service).
 */
router.get('/:code/analyze/:applicationId', authenticateAny, async (req, res) => {
    const { code, applicationId } = req.params;

    if (!UUID_RE.test(applicationId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_APPLICATION_ID',
            message: 'applicationId must be a UUID',
        });
    }

    try {
        const actor = {
            role: normalizeRole(req.user?.canonicalRole || req.user?.role),
            canonicalId: req.user?.canonicalId,
        };
        // Spec 2026-09-30 §3.1 (R1): a health caller's read carries its holder scope.
        const holderScope = actor.role === 'health'
            ? await require('../../../services/holder-access').holderScope(req)
            : null;
        const result = await standardsAnalyzer.analyzeApplication(applicationId, code, { actor, holderScope });
        res.json({ success: true, data: result });
    } catch (error) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        if (statusCode >= 500) {
            logger.error('[StandardsAnalyzer] analyze failed:', error);
        }
        res.status(statusCode).json({
            success: false,
            error: error.code || 'STANDARDS_ANALYZE_FAILED',
            message: statusCode >= 500 ? 'Failed to analyze application' : safeErrorMessage(error),
        });
    }
});

module.exports = router;
