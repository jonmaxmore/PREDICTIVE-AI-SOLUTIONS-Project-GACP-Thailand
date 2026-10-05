/**
 * Audit Logging Middleware for GACP Platform
 * Tracks all significant actions for compliance and debugging
 * 
 * UPGRADED: Now uses Prisma database for 5-year retention (GACP Thai compliance)
 */

const fs = require('fs');
const { getZonedParts } = require('../../../utils/working-days');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger');

// Import Prisma-based audit service
let auditService;
try {
    auditService = require('../../../services/audit-trail');
} catch (_e) {
    console.warn('[Audit] audit-trail service not available, using file-based fallback');
}

// Audit log storage (fallback for file-based logging)
const auditLogs = [];
const MAX_IN_MEMORY_LOGS = 10000;

// Persistent location for fallback audit logs. Override via env in container
// deployments so logs land on a mounted volume instead of inside the source tree.
const auditLogDir = process.env.AUDIT_LOG_DIR
    || path.join(process.cwd(), 'storage', 'audit-logs');
try {
    fs.mkdirSync(auditLogDir, { recursive: true });
} catch (mkdirErr) {
    logger.warn(`[Audit] Failed to create audit log dir ${auditLogDir}: ${mkdirErr.message}`);
}

// Get current audit log file path
const getAuditLogPath = () => {
    const date = getZonedParts(new Date()).isoDate; // one file per Bangkok day
    return path.join(auditLogDir, `audit-${date}.jsonl`);
};

/**
 * Create an audit log entry (with Prisma + file fallback).
 * File writes are async so a slow disk doesn't block the event loop.
 */
const createAuditLog = async (entry) => {
    const log = {
        id: `audit-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
        timestamp: new Date().toISOString(),
        ...entry,
    };

    // Try Prisma first (for 5-year retention compliance)
    if (auditService) {
        try {
            await auditService.logAction({
                action: entry.action || 'UNKNOWN',
                entityType: entry.entityType || entry.category || 'SYSTEM',
                entityId: entry.target?.id,
                userId: entry.user?.id,
                userEmail: entry.user?.email,
                userRole: entry.user?.role,
                ipAddress: entry.user?.ip,
                description: entry.details || JSON.stringify(entry.metadata),
                metadata: entry,
                severity: entry.severity || 'INFO',
            });
        } catch (err) {
            logger.warn(`[Audit] Prisma audit failed, falling back to file: ${err.message}`);
        }
    }

    // Store in memory (for quick access)
    auditLogs.push(log);
    if (auditLogs.length > MAX_IN_MEMORY_LOGS) {
        auditLogs.shift();
    }

    // Write to file (append mode — non-blocking)
    try {
        await fsp.appendFile(getAuditLogPath(), JSON.stringify(log) + '\n');
    } catch (error) {
        logger.error('Failed to write audit log:', error.message);
    }

    return log;
};

/**
 * Audit categories
 */
const AuditCategory = {
    AUTH: 'AUTH',           // Login, logout, token refresh
    DATA: 'DATA',           // Create, read, update, delete
    FILE: 'FILE',           // File upload, download, delete
    SECURITY: 'SECURITY',   // Security events, violations
    ADMIN: 'ADMIN',         // Admin actions
    SYSTEM: 'SYSTEM',       // System events
};

/**
 * Audit actions
 */
const AuditAction = {
    // Auth
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILURE: 'LOGIN_FAILURE',
    LOGOUT: 'LOGOUT',
    TOKEN_REFRESH: 'TOKEN_REFRESH',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',

    // Data
    CREATE: 'CREATE',
    READ: 'READ',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',

    // File
    FILE_UPLOAD: 'FILE_UPLOAD',
    FILE_DOWNLOAD: 'FILE_DOWNLOAD',
    FILE_DELETE: 'FILE_DELETE',

    // Security
    RATE_LIMIT_HIT: 'RATE_LIMIT_HIT',
    FORBIDDEN_PATTERN: 'FORBIDDEN_PATTERN',
    INVALID_TOKEN: 'INVALID_TOKEN',
    UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',

    // Admin
    USER_CREATE: 'USER_CREATE',
    USER_UPDATE: 'USER_UPDATE',
    USER_DELETE: 'USER_DELETE',
    ROLE_CHANGE: 'ROLE_CHANGE',
    CONFIG_CHANGE: 'CONFIG_CHANGE',
};

/**
 * Audit middleware for Express routes
 */
const auditMiddleware = (category, action, options = {}) => {
    return (req, res, next) => {
        const startTime = Date.now();

        // Capture original end method
        const originalEnd = res.end;

        res.end = function (chunk, encoding) {
            // Restore original end
            res.end = originalEnd;
            res.end(chunk, encoding);

            // Create audit log after response is sent
            const duration = Date.now() - startTime;

            createAuditLog({
                category,
                action,
                user: {
                    id: req.user?.id || 'anonymous',
                    role: req.user?.role || 'PUBLIC',
                    ip: getRequestIp(req),
                },
                request: {
                    method: req.method,
                    path: req.originalUrl,
                    params: options.logParams ? req.params : undefined,
                    query: options.logQuery ? req.query : undefined,
                    body: options.logBody ? sanitizeBody(req.body) : undefined,
                },
                response: {
                    statusCode: res.statusCode,
                    duration,
                },
                metadata: options.metadata || {},
            });
        };

        next();
    };
};

/**
 * Sanitize request body to remove sensitive data
 */
const sanitizeBody = (body) => {
    if (!body) { return undefined; }

    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '[REDACTED]';
        }
    }

    return sanitized;
};

/**
 * Log security event
 */
const logSecurityEvent = (type, details) => {
    return createAuditLog({
        category: AuditCategory.SECURITY,
        action: type,
        severity: 'WARNING',
        details,
    });
};

/**
 * Log admin action
 */
const logAdminAction = (action, actor, target, details) => {
    return createAuditLog({
        category: AuditCategory.ADMIN,
        action,
        user: actor,
        target,
        details,
    });
};

/**
 * Query audit logs
 */
const queryAuditLogs = (filters = {}) => {
    let results = [...auditLogs];

    if (filters.category) {
        results = results.filter(log => log.category === filters.category);
    }

    if (filters.action) {
        results = results.filter(log => log.action === filters.action);
    }

    if (filters.userId) {
        results = results.filter(log => log.user?.id === filters.userId);
    }

    if (filters.startDate) {
        results = results.filter(log => new Date(log.timestamp) >= new Date(filters.startDate));
    }

    if (filters.endDate) {
        results = results.filter(log => new Date(log.timestamp) <= new Date(filters.endDate));
    }

    // Sort by timestamp descending
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply pagination
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    return {
        total: results.length,
        offset,
        limit,
        data: results.slice(offset, offset + limit),
    };
};

// Export API route
const express = require('express');
const router = express.Router();
// SEC-AUDIT-001: audit/security-event reads must be admin-gated, never anonymous.
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { adminOnly } = require('../../../middleware/role-middleware');

/**
 * @route GET /api/audit
 * @desc Query audit logs
 * @access Admin only
 */
router.get('/', authenticateProvider, adminOnly, (req, res) => {
    const { category, action, userId, startDate, endDate, limit, offset } = req.query;

    const results = queryAuditLogs({
        category,
        action,
        userId,
        startDate,
        endDate,
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
    });

    res.json({
        success: true,
        ...results,
    });
});

/**
 * @route GET /api/audit/stats
 * @desc Get audit statistics
 * @access Admin only
 */
router.get('/stats', authenticateProvider, adminOnly, (req, res) => {
    const stats = {
        totalLogs: auditLogs.length,
        byCategory: {},
        byAction: {},
        last24Hours: 0,
        lastHour: 0,
    };

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    for (const log of auditLogs) {
        // Count by category
        stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;

        // Count by action
        stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;

        // Count recent
        const logTime = new Date(log.timestamp).getTime();
        if (logTime >= oneDayAgo) { stats.last24Hours++; }
        if (logTime >= oneHourAgo) { stats.lastHour++; }
    }

    res.json({
        success: true,
        data: stats,
    });
});

module.exports = router;
module.exports.auditMiddleware = auditMiddleware;
module.exports.createAuditLog = createAuditLog;
module.exports.logSecurityEvent = logSecurityEvent;
module.exports.logAdminAction = logAdminAction;
module.exports.AuditCategory = AuditCategory;
module.exports.AuditAction = AuditAction;

