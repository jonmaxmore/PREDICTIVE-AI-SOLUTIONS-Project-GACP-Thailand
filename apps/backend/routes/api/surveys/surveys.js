'use strict';

/**
 * Survey routes — สัญญา C05F680149 ต้นแบบที่ 2 "ระบบสำรวจความต้องการ (1 ชุด)"
 * Mounted at /api/surveys (routes/api/index.js).
 *
 * RBAC (ERP separation):
 *   - Template master data + interview records (mutations) = tenant ADMIN only
 *   - Reads (templates/stats/export/interviews)            = any provider role
 *   - Respondent surface (/active, submit response)        = authenticateAny
 *     (HEALTH farmers + provider staff; org scoping via tenant context)
 * Admin mutations are audit-stamped via auditLogger.log (non-fatal, mirrors
 * admin-work-config.js).
 */

const express = require('express');
const router = express.Router();
const surveyService = require('../../../services/survey-service');
const { authenticateAny, authenticateProvider } = require('../../../middleware/auth-middleware');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const { getRequestIp } = require('../../../utils/client-ip');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actorOf(req) {
    return {
        id: req.user?.id,
        role: normalizeRole(req.user?.canonicalRole || req.user?.role),
        canonicalId: req.user?.canonicalId,
    };
}

function requireAdmin(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'Only tenant ADMIN can manage survey master data',
        });
    }
    next();
}

function requireUuidParam(name) {
    return (req, res, next) => {
        if (!UUID_RE.test(req.params[name])) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_ID',
                message: `${name} must be a UUID`,
            });
        }
        next();
    };
}

function sendError(res, error, fallbackMessage) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) {
        logger.error(`[Surveys] ${fallbackMessage}:`, error);
    }
    res.status(statusCode).json({
        success: false,
        error: error.code || 'SURVEY_REQUEST_FAILED',
        message: statusCode >= 500 ? fallbackMessage : safeErrorMessage(error),
    });
}

/** Non-fatal admin-mutation audit stamp (mirrors admin-work-config.js). */
async function emitAudit(req, action, resourceId, metadata) {
    try {
        await auditLogger.log({
            category: AuditCategory.ADMIN,
            action,
            severity: AuditSeverity.INFO,
            actorId: req.user?.id,
            actorEmail: req.user?.email || null,
            actorRole: normalizeRole(req.user?.canonicalRole || req.user?.role),
            resourceType: ResourceType.SYSTEM,
            resourceId,
            ipAddress: getRequestIp(req),
            userAgent: req.headers['user-agent'],
            metadata,
        });
    } catch (error) {
        logger.error('[Surveys] audit stamp failed (non-fatal):', error);
    }
}

// ── Respondent surface (authenticateAny) — declare BEFORE param routes ──

/** GET /api/surveys/active — templates open for responses */
router.get('/active', authenticateAny, async (req, res) => {
    try {
        const templates = await surveyService.listActiveTemplates({
            targetGroup: req.query.targetGroup,
        });
        res.json({ success: true, count: templates.length, data: templates });
    } catch (error) {
        sendError(res, error, 'Failed to list active surveys');
    }
});

/** POST /api/surveys/templates/:templateId/responses — submit (posted document) */
router.post('/templates/:templateId/responses', authenticateAny, requireUuidParam('templateId'), async (req, res) => {
    try {
        const response = await surveyService.submitResponse(
            req.params.templateId, req.body, { actor: actorOf(req) },
        );
        res.status(201).json({ success: true, data: response });
    } catch (error) {
        sendError(res, error, 'Failed to submit survey response');
    }
});

// ── Template master data (provider) ─────────────────────────────────

/** POST /api/surveys/templates — create (ADMIN) */
router.post('/templates', authenticateProvider, requireAdmin, async (req, res) => {
    try {
        const template = await surveyService.createTemplate(req.body, { actor: actorOf(req) });
        await emitAudit(req, 'SURVEY_TEMPLATE_CREATED', template.id, { code: template.code });
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, 'Failed to create survey template');
    }
});

/** POST /api/surveys/templates/:templateId/activate — DRAFT→ACTIVE (ADMIN) */
router.post('/templates/:templateId/activate', authenticateProvider, requireAdmin, requireUuidParam('templateId'), async (req, res) => {
    try {
        const template = await surveyService.activateTemplate(req.params.templateId);
        await emitAudit(req, 'SURVEY_TEMPLATE_ACTIVATED', template.id, { status: template.status });
        res.json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, 'Failed to activate survey template');
    }
});

/** POST /api/surveys/templates/:templateId/close — ACTIVE→CLOSED (ADMIN) */
router.post('/templates/:templateId/close', authenticateProvider, requireAdmin, requireUuidParam('templateId'), async (req, res) => {
    try {
        const template = await surveyService.closeTemplate(req.params.templateId);
        await emitAudit(req, 'SURVEY_TEMPLATE_CLOSED', template.id, { status: template.status });
        res.json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, 'Failed to close survey template');
    }
});

/** GET /api/surveys/templates — list (any provider role) */
router.get('/templates', authenticateProvider, async (req, res) => {
    try {
        const templates = await surveyService.listTemplates({ status: req.query.status });
        res.json({ success: true, count: templates.length, data: templates });
    } catch (error) {
        sendError(res, error, 'Failed to list survey templates');
    }
});

/** GET /api/surveys/templates/:templateId — detail with questions */
router.get('/templates/:templateId', authenticateProvider, requireUuidParam('templateId'), async (req, res) => {
    try {
        const template = await surveyService.getTemplate(req.params.templateId);
        res.json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, 'Failed to fetch survey template');
    }
});

/** GET /api/surveys/templates/:templateId/stats — aggregates + text-mining 3.1 */
router.get('/templates/:templateId/stats', authenticateProvider, requireUuidParam('templateId'), async (req, res) => {
    try {
        const stats = await surveyService.getTemplateStats(req.params.templateId);
        res.json({ success: true, data: stats });
    } catch (error) {
        sendError(res, error, 'Failed to compute survey stats');
    }
});

/** GET /api/surveys/templates/:templateId/export — CSV (formula-guarded, BOM) */
router.get('/templates/:templateId/export', authenticateProvider, requireUuidParam('templateId'), async (req, res) => {
    try {
        const csv = await surveyService.exportResponsesCsv(req.params.templateId);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="survey-${req.params.templateId}.csv"`);
        res.status(200).send(csv);
    } catch (error) {
        sendError(res, error, 'Failed to export survey responses');
    }
});

// ── Expert interviews (ต้นแบบ 2.2) ──────────────────────────────────

/** POST /api/surveys/interviews — record an interview (ADMIN) */
router.post('/interviews', authenticateProvider, requireAdmin, async (req, res) => {
    try {
        const interview = await surveyService.createInterview(req.body, { actor: actorOf(req) });
        await emitAudit(req, 'EXPERT_INTERVIEW_RECORDED', interview.id, { title: req.body?.title });
        res.status(201).json({ success: true, data: interview });
    } catch (error) {
        sendError(res, error, 'Failed to record interview');
    }
});

/** GET /api/surveys/interviews — list (any provider role) */
router.get('/interviews', authenticateProvider, async (req, res) => {
    try {
        const interviews = await surveyService.listInterviews();
        res.json({ success: true, count: interviews.length, data: interviews });
    } catch (error) {
        sendError(res, error, 'Failed to list interviews');
    }
});

module.exports = router;
