'use strict';

/**
 * Dataset routes — สัญญา C05F680149 ภาคผนวก 4 ข้อ 3
 * "ชุดข้อมูลดิบ (API/CSV) + คู่มือการใช้ชุดข้อมูล → Data Lake บพข."
 * Mounted at /api/datasets (routes/api/index.js).
 *
 * RBAC: catalog + dictionary = any provider role (read-only metadata);
 * bulk export = tenant ADMIN only, audit-stamped per export (who took which
 * dataset when — Data Lake handoff needs provenance).
 */

const express = require('express');
const router = express.Router();
const datasetService = require('../../../services/dataset-export-service');
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const { getRequestIp } = require('../../../utils/client-ip');

function requireAdmin(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'Only tenant ADMIN can export datasets',
        });
    }
    next();
}

function sendError(res, error, fallbackMessage) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) {
        logger.error(`[Datasets] ${fallbackMessage}:`, error);
    }
    res.status(statusCode).json({
        success: false,
        error: error.code || 'DATASET_REQUEST_FAILED',
        message: statusCode >= 500 ? fallbackMessage : safeErrorMessage(error),
    });
}

/** GET /api/datasets — catalog of raw-data domains */
router.get('/', authenticateProvider, (req, res) => {
    const domains = datasetService.listDomains();
    res.json({ success: true, count: domains.length, data: domains });
});

/** GET /api/datasets/dictionary — คู่มือการใช้ชุดข้อมูล (markdown) */
router.get('/dictionary', authenticateProvider, (req, res) => {
    const markdown = datasetService.generateDataDictionaryMarkdown();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.status(200).send(markdown);
});

/** GET /api/datasets/:domain/export?format=csv|jsonl — bulk raw-data export (ADMIN) */
router.get('/:domain/export', authenticateProvider, requireAdmin, async (req, res) => {
    const { domain } = req.params;
    const format = String(req.query.format || 'csv').toLowerCase();
    try {
        const payload = await datasetService.exportDomain(domain, format);

        // Non-fatal provenance stamp (mirrors admin-work-config emitAudit)
        try {
            await auditLogger.log({
                category: AuditCategory.ADMIN,
                action: 'DATASET_EXPORTED',
                severity: AuditSeverity.INFO,
                actorId: req.user?.id,
                actorEmail: req.user?.email || null,
                actorRole: normalizeRole(req.user?.canonicalRole || req.user?.role),
                resourceType: ResourceType.SYSTEM,
                resourceId: domain,
                ipAddress: getRequestIp(req),
                userAgent: req.headers['user-agent'],
                metadata: { format },
            });
        } catch (auditError) {
            logger.error('[Datasets] audit stamp failed (non-fatal):', auditError);
        }

        if (format === 'jsonl') {
            res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        } else {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        }
        res.setHeader('Content-Disposition', `attachment; filename="gacp-dataset-${domain}.${format}"`);
        res.status(200).send(payload);
    } catch (error) {
        sendError(res, error, 'Failed to export dataset');
    }
});

module.exports = router;
