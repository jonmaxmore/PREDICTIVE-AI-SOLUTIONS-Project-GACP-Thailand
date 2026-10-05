const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const cacheService = require('../../../services/cache-service');
// provider-UAT-round2 2026-07-09 (MED): config PATCH hardcoded updatedBy='ADMIN'
// (no real actor) and wrote no immutable AuditLog — a forensic-attribution gap on
// a mutation that changes system behavior. Stamp the real actor + audit it.
const { auditLogger, AuditCategory, AuditSeverity } = require('../../../middleware/audit-logger');
const { getRequestIp } = require('../../../utils/client-ip');

const CACHE_KEY_CONFIGS = 'master:systemConfigs';
const CACHE_TTL_CONFIGS = 300; // 5 minutes

// GET /api/admin/config - Get all system configs (cached)
router.get('/', async (req, res) => {
    try {
        const configs = await cacheService.getOrSet(
            CACHE_KEY_CONFIGS,
            () => prisma.systemConfig.findMany({ orderBy: { key: 'asc' } }),
            CACHE_TTL_CONFIGS,
        );

        res.json({ success: true, data: configs });
    } catch (error) {
        logger.error('Failed to fetch configs:', error);
        return respondError(res, req, error, { message: 'Failed to fetch configurations' });
    }
});

// PATCH /api/admin/config/:key - Update config
router.patch('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value, type, description } = req.body;

        const actorId = req.user?.id || 'SYSTEM';
        // Upsert allows creating new configs on the fly
        const config = await prisma.systemConfig.upsert({
            where: { key },
            update: {
                value: String(value),
                updatedBy: actorId,
            },
            create: {
                key,
                value: String(value),
                type: type || 'STRING',
                description: description || '',
                updatedBy: actorId,
            },
        });

        // Invalidate config cache on update
        await cacheService.del(CACHE_KEY_CONFIGS);

        // Immutable audit — a config change alters system behavior; record who/when.
        try {
            await auditLogger.log({
                category: AuditCategory.ADMIN,
                action: 'SYSTEM_CONFIG_UPDATED',
                severity: AuditSeverity.WARNING,
                actorId,
                actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
                actorType: 'ADMIN',
                resourceType: 'SYSTEM_CONFIG',
                resourceId: key,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: { key, type: type || undefined },
            });
        } catch (_e) { /* best-effort audit */ }

        logger.info(`Config updated: ${key} by ${actorId}`);
        res.json({ success: true, data: config });
    } catch (error) {
        logger.error('Failed to update config:', error);
        return respondError(res, req, error, { message: 'Failed to update configuration' });
    }
});

module.exports = router;
