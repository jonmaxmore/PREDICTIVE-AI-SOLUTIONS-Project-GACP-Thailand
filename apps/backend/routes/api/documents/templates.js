/**
 * Document Template Registry Routes
 * Manages versioned HTML templates for official documents (certificates, invoices, etc.)
 *
 * GET  /api/templates        - List all active templates
 * GET  /api/templates/:code  - Get latest active template by code
 * POST /api/templates        - Create new template version (admin only)
 * PUT  /api/templates/:id    - Update template (admin only)
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
 * moved to `document-service`. Template is a global config table, so
 * there is no ownership predicate; the service does enforce the
 * "single ACTIVE row per code" rule when creating a new version via
 * deprecateActiveTemplatesForCode.
 */

const express = require('express');
const router = express.Router();
const documentService = require('../../../services/document-service');
const authModule = require('../../../middleware/auth-middleware');
const { adminOnly } = require('../../../middleware/role-middleware');
const logger = require('../../../shared/logger');
const { respondError } = require('../../../shared/api-response');

// Declared in prisma/schema/system.prisma:110 —
//   status String @default("DRAFT") // DRAFT, ACTIVE, DEPRECATED
// Kept next to the only handler that writes it so the two cannot drift.
const TEMPLATE_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'DEPRECATED']);

// Auth middleware wrappers
const authenticateHealth = (req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
};

const authenticatePROVIDER = (req, res, next) => {
    if (typeof authModule.authenticateProvider === 'function') {
        return authModule.authenticateProvider(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
};

/**
 * GET /api/templates
 * List all active document templates (grouped by code, latest version only)
 */
router.get('/', authenticateHealth, async (req, res) => {
    try {
        const templates = await documentService.listActiveTemplates();

        // Group by code, keep latest version
        const grouped = {};
        for (const t of templates) {
            if (!grouped[t.code]) {
                grouped[t.code] = t;
            }
        }

        res.json({
            success: true,
            count: Object.keys(grouped).length,
            data: Object.values(grouped),
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[Templates] list', message: 'Failed to fetch templates' });
    }
});

/**
 * GET /api/templates/:code
 * Get the latest active template by code (e.g., GACP_CERTIFICATE)
 */
router.get('/:code', authenticateHealth, async (req, res) => {
    try {
        const { code } = req.params;
        const { version } = req.query;

        const template = await documentService.findActiveTemplateByCode(code, version);

        if (!template) {
            return res.status(404).json({
                success: false,
                error: `Template '${code}' not found`,
            });
        }

        res.json({ success: true, data: template });
    } catch (error) {
        return respondError(res, req, error, { label: '[Templates] get', message: 'Failed to fetch template' });
    }
});

/**
 * GET /api/templates/:code/versions
 * List all versions of a template
 */
router.get('/:code/versions', authenticatePROVIDER, async (req, res) => {
    try {
        const { code } = req.params;

        const versions = await documentService.listTemplateVersions(code);

        res.json({ success: true, count: versions.length, data: versions });
    } catch (error) {
        return respondError(res, req, error, { label: '[Templates] versions', message: 'Failed to fetch template versions' });
    }
});

/**
 * POST /api/templates
 * Create a new template or new version of existing template (admin only)
 */
router.post('/', authenticatePROVIDER, adminOnly, async (req, res) => {
    try {
        const {
            code,
            titleTH,
            titleEN,
            description,
            htmlTemplate,
            cssOverrides,
            payloadSchema,
            paperSize,
            orientation,
        } = req.body;

        if (!code || !titleTH || !htmlTemplate) {
            return res.status(400).json({
                success: false,
                error: 'code, titleTH, and htmlTemplate are required',
            });
        }

        // Find latest version for this code
        const latest = await documentService.findLatestTemplateVersion(code);

        const newVersion = latest ? latest.version + 1 : 1;

        // Deprecate previous active versions
        if (latest && latest.status === 'ACTIVE') {
            await documentService.deprecateActiveTemplatesForCode(code);
        }

        const template = await documentService.createTemplate({
            code,
            version: newVersion,
            titleTH,
            titleEN: titleEN || null,
            description: description || null,
            htmlTemplate,
            cssOverrides: cssOverrides || null,
            payloadSchema: payloadSchema || null,
            paperSize: paperSize || 'A4_LANDSCAPE',
            orientation: orientation || 'landscape',
            status: 'ACTIVE',
            effectiveDate: new Date(),
            createdBy: req.user?.id || 'system',
        });

        logger.info(`[Templates] Created ${code} v${newVersion}`);
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        return respondError(res, req, error, { label: '[Templates] create', message: 'Failed to create template' });
    }
});

/**
 * PUT /api/templates/:id
 * Update template status or metadata (admin only)
 */
router.put('/:id', authenticatePROVIDER, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, titleTH, titleEN, description } = req.body;

        // Template.status is a String column whose legal values the schema
        // declares (system.prisma:110 — DRAFT, ACTIVE, DEPRECATED). A String
        // column gives no database-level protection, so this entrypoint is the
        // only place an unknown value can be caught: writing one would strand
        // the row outside every status filter with no error at write time.
        const updateData = {};
        if (status !== undefined && status !== null && status !== '') {
            if (!TEMPLATE_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'INVALID_STATUS',
                    message: `status must be one of: ${TEMPLATE_STATUSES.join(', ')}`,
                });
            }
            updateData.status = status;
        }
        if (titleTH) {updateData.titleTH = titleTH;}
        if (titleEN !== undefined) {updateData.titleEN = titleEN;}
        if (description !== undefined) {updateData.description = description;}
        updateData.updatedBy = req.user?.id || 'system';

        if (status === 'DEPRECATED') {
            updateData.retiredDate = new Date();
        }

        const template = await documentService.updateTemplate(id, updateData);

        res.json({ success: true, data: template });
    } catch (error) {
        return respondError(res, req, error, { label: '[Templates] update', message: 'Failed to update template' });
    }
});

module.exports = router;
