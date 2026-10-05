'use strict';

/**
 * Two response helpers the finance routers share (fix round 1, security review
 * 2026-09-27). Each router used to carry its own copy.
 *
 *   requireOrganization(req, res) — a finance read/write is always scoped to the
 *     caller's organization. A caller with none is refused with 400
 *     NO_ORGANIZATION instead of falling through to a cross-tenant query (L3).
 *
 *   sendServiceError(res, err, { label, fallback }) — a 4xx from a service keeps
 *     its own message (the caller needs it: validation, 403 codes). A 5xx is
 *     logged with the full error and answered with a fixed message, never the
 *     raw err.message, which can carry database internals (L2).
 */

const logger = require('../../../shared/logger');

function requireOrganization(req, res) {
    const organizationId = req.user?.organizationId || null;
    if (!organizationId) {
        res.status(400).json({
            success: false,
            error: 'NO_ORGANIZATION',
            code: 'NO_ORGANIZATION',
            message: 'Request user has no organizationId — finance data requires a tenant scope',
        });
        return null;
    }
    return organizationId;
}

function sendServiceError(res, err, { label = 'finance', fallback = 'Failed to process the request' } = {}) {
    const status = err?.statusCode || 500;
    const code = err?.code || 'INTERNAL_ERROR';
    if (status >= 500) {
        logger.error(`[${label}] ${code}: ${err?.message}`, err);
        return res.status(status).json({ success: false, error: code, message: fallback });
    }
    return res.status(status).json({
        success: false,
        error: code,
        message: err?.message || fallback,
    });
}

module.exports = { requireOrganization, sendServiceError };
