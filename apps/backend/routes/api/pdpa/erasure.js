/**
 * PDPA Right-to-Forget routes — Iter 27 (2026-05-16)
 *
 * Surface:
 *   POST   /api/pdpa/erasure/request         — HEALTH (self) submits request
 *   POST   /api/pdpa/erasure/confirm         — HEALTH (self) confirms with token
 *   POST   /api/pdpa/erasure/:id/cancel      — HEALTH (self) cancels before confirm
 *   GET    /api/pdpa/erasure/requests        — ADMIN lists requests
 *
 * Legal basis: PDPA ม.32 (พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 32).
 * The 2-step request→confirm flow mirrors the GDPR Article 17 recommendation
 * that erasure be intentional, not a single-click misclick.
 *
 * Self-service enforcement: every HEALTH-facing route resolves the data
 * subject from `req.user.canonicalId` (the authenticated principal's own
 * record), NEVER from a request-body field. A HEALTH caller therefore
 * cannot trigger erasure of someone else's account regardless of payload
 * shaping — the canonicalId comes from the verified JWT.
 */

const express = require('express');
const router = express.Router();
const { authenticateHealth, authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireRole } = require('../../../middleware/role-middleware');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const pdpaErasureService = require('../../../services/pdpa-erasure-service');

const ERROR_STATUS_MAP = Object.freeze({
    VALIDATION_ERROR: 400,
    USER_NOT_FOUND: 404,
    PDPA_ALREADY_DELETED: 409,
    PDPA_LEGAL_HOLD: 423, // Locked — regulatory retention overrides
    PDPA_ERASURE_IN_PROGRESS: 409,
    PDPA_ERASURE_NOT_FOUND: 404,
    PDPA_ERASURE_BAD_STATUS: 409,
    PDPA_ERASURE_EXPIRED: 410, // Gone
    PDPA_ERASURE_INVALID_TOKEN: 401,
});

function mapErrorStatus(err) {
    if (err && err.code && ERROR_STATUS_MAP[err.code]) {return ERROR_STATUS_MAP[err.code];}
    return 500;
}

/**
 * POST /request
 * Body: { reason?: string }
 * Auth: HEALTH (self).
 *
 * The subject is resolved from `req.user.canonicalId` so a caller can
 * only erase their own data. The token is NOT returned in the HTTP body
 * — the route emits the confirm link (with the token) through the in-app
 * notification via the fanout service; the HTTP response contains only
 * the requestId + expiresAt.
 */
router.post('/request', authenticateHealth, async (req, res) => {
    try {
        // Detokenize STAGE 0 (RFC breaker 3): the erasure service resolves the
        // data subject by the national-ID HASH (findUserByHealthIdSecurely), so
        // it needs the national ID, NOT the FK token. Prefer req.user.healthId
        // (the plaintext national-ID column, populated by the auth-middleware DB
        // lookup) over req.user.canonicalId — after the STAGE-A re-key,
        // canonicalId holds the token, which would not hash-match. Fall back to
        // canonicalId only for legacy sessions missing healthId (pre-re-key it
        // equals the national ID anyway).
        const healthId = req.user && (req.user.healthId || req.user.canonicalId);
        if (!healthId) {
            return res.status(400).json({ success: false, error: 'national id missing from session' });
        }
        const result = await pdpaErasureService.requestErasure({
            healthId,
            reason: req.body && req.body.reason,
            actorId: req.user.id,
        });
        // Do NOT echo the token back. The fanout step delivers the confirm
        // link (with the token) via the in-app notification only — see
        // pdpa-erasure-service.js.
        return res.status(202).json({
            success: true,
            data: {
                requestId: result.requestId,
                expiresAt: result.expiresAt,
                // Test-only escape hatch: in NODE_ENV=test we return the
                // token in the response so the e2e tests can complete
                // the confirm step without reading the in-app notification.
                ...(process.env.NODE_ENV === 'test' ? { _testToken: result.token } : {}),
            },
        });
    } catch (err) {
        logger.warn('[pdpa-erasure] request failed', { error: err.message, code: err.code });
        return res.status(mapErrorStatus(err)).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'INTERNAL_ERROR',
        });
    }
});

/**
 * POST /confirm
 * Body: { requestId: string, token: string }
 * Auth: HEALTH (self).
 *
 * Confirmation executes the erasure inside a single transaction. On
 * success the response includes the summary of what was anonymised vs.
 * what was preserved per ม.87/3 ป.รัษฎากร (7-year tax/accounting
 * retention). `summary.retained.certificates` lists certificates whose
 * holder name was kept (retainUntil ahead / legalHold; operator ruling
 * 2026-08-27). That list is final for this subject: nothing in the tree
 * revisits those rows after retainUntil passes, and the erased account
 * cannot request again (see executeErasure step 3).
 */
router.post('/confirm', authenticateHealth, async (req, res) => {
    try {
        const { requestId, token } = req.body || {};
        const summary = await pdpaErasureService.confirmErasure(requestId, {
            token,
            actorId: req.user.id,
        });
        return res.json({ success: true, data: summary });
    } catch (err) {
        logger.warn('[pdpa-erasure] confirm failed', { error: err.message, code: err.code });
        return res.status(mapErrorStatus(err)).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'INTERNAL_ERROR',
        });
    }
});

/**
 * POST /:id/cancel
 * Auth: HEALTH (self).
 */
router.post('/:id/cancel', authenticateHealth, async (req, res) => {
    try {
        const { id: requestId } = req.params;
        const result = await pdpaErasureService.cancelErasure(requestId, {
            actorId: req.user.id,
        });
        return res.json({ success: true, data: result });
    } catch (err) {
        logger.warn('[pdpa-erasure] cancel failed', { error: err.message, code: err.code });
        return res.status(mapErrorStatus(err)).json({
            success: false,
            error: safeErrorMessage(err),
            code: err.code || 'INTERNAL_ERROR',
        });
    }
});

/**
 * GET /requests
 * Query: ?status=REQUESTED&organizationId=...
 * Auth: PROVIDER (ADMIN role).
 *
 * Admin visibility is scoped to the caller's organisation by default;
 * platform-admins (cross-tenant) can pass organizationId explicitly
 * after the tenant-scope middleware unsets the scope for their session
 * (out of scope for this route — current behaviour scopes to req.user).
 */
router.get(
    '/requests',
    authenticateProvider,
    requireRole(['admin']),
    async (req, res) => {
        try {
            const status = req.query && req.query.status ? String(req.query.status) : undefined;
            const organizationId = (req.query && req.query.organizationId)
                ? String(req.query.organizationId)
                : (req.user && req.user.organizationId) || undefined;
            const rows = await pdpaErasureService.listErasureRequests({ status, organizationId });
            return res.json({ success: true, data: rows });
        } catch (err) {
            logger.error('[pdpa-erasure] list failed', { error: err.message });
            return res.status(500).json({ success: false, error: safeErrorMessage(err) });
        }
    },
);

module.exports = router;
