/**
 * Consent API Routes (V2)
 * PDPA-compliant consent management endpoints
 * Uses Prisma (via consent-manager middleware)
 */

const express = require('express');
const { safeErrorMessage, sendErrorResponse } = require('../../../shared/api-response');
const { lookup } = require('../../../shared/error-codes');
const router = express.Router();
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const { consentManager, ConsentCategory, RequiredConsents } = require('../../../middleware/consent-manager');
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger');

/**
 * Hardening batch 2026-07-09: the 3 mutation catches below all swallowed the
 * coded PAYMENT_TERMS_NOT_WITHDRAWABLE throw (consent-manager.js — a ม.24(3)
 * contract-evidence block with a curated Thai message in the error-codes
 * catalog) into safeErrorMessage's generic English fallback, with no `code`
 * field — the FE could not tell the contractual block from any other 400.
 * Catalogued codes now surface code + messageEn + curated messageTh; every
 * uncatalogued error keeps the exact previous generic behavior. Deliberately
 * NOT respondError(): its explicit-statusCode branch omits messageTh (the
 * misleading-Thai-fallback class fixed for AUTHORIZATION_ERROR).
 */
function respondConsentError(res, req, error, label) {
    logger.error(`[Consent] ${label} error:`, error);
    const row = typeof error?.code === 'string' ? lookup(error.code) : undefined;
    if (row) {
        return sendErrorResponse(res, req, {
            status: Number.isInteger(error.statusCode) ? error.statusCode : row.httpStatus,
            code: row.code,
            message: row.messageEn,
            messageTh: row.messageTh,
        });
    }
    return res.status(400).json({ success: false, error: safeErrorMessage(error) });
}

/**
 * GET /
 * Get current user's consent status
 */
router.get('/', authenticateHealth, async (req, res) => {
    try {
        const consents = await consentManager.getUserConsents(req.user.id);

        res.json({
            success: true,
            data: {
                consents,
                categories: Object.values(ConsentCategory),
                required: RequiredConsents,
            },
        });
    } catch (error) {
        logger.error('[Consent] Get error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

/**
 * POST /
 * Record consent (grant or withdraw)
 */
router.post('/', authenticateHealth, async (req, res) => {
    try {
        const { category, granted } = req.body;

        if (!category || !Object.values(ConsentCategory).includes(category)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid consent category',
            });
        }

        const consent = await consentManager.recordConsent(
            req.user.id,
            category,
            granted,
            getRequestIp(req),
            req.headers['user-agent'],
        );

        res.json({
            success: true,
            data: consent,
        });
    } catch (error) {
        return respondConsentError(res, req, error, 'Record');
    }
});

/**
 * POST /bulk
 * Record multiple consents at once (registration follow-up)
 *
 * Two issues caught in a security/correctness sweep (2026-05-03):
 *
 * 1. The route had no auth middleware — sister routes `POST /` and
 *    `DELETE /:category` both use `authenticateHealth`. Without it, the
 *    tenant-context-middleware (chained inside `authenticateHealth`) didn't
 *    bind, the tenant-prisma-extension was a no-op, and
 *    `prisma.userConsent.create()` failed with "Argument `organization`
 *    is missing" (UserConsent.organizationId is NOT NULL). The wrapping
 *    .catch returned a generic 400 with `safeErrorMessage(error)` —
 *    real failure mode hidden.
 *
 * 2. The handler trusted `userId` from the request body, allowing any
 *    caller to write consent rows for ANY user. Replaced with
 *    `req.user.id` from the authenticated principal — bulk consent now
 *    targets the caller's own account only, matching the rest of this
 *    file.
 */
router.post('/bulk', authenticateHealth, async (req, res) => {
    try {
        const { consents } = req.body;
        const userId = req.user.id;

        if (!Array.isArray(consents)) {
            return res.status(400).json({
                success: false,
                error: 'consents array required',
            });
        }

        const results = await consentManager.recordBulkConsent(
            userId,
            consents,
            getRequestIp(req),
            req.headers['user-agent'],
        );

        res.json({
            success: true,
            data: results,
        });
    } catch (error) {
        return respondConsentError(res, req, error, 'Bulk');
    }
});

/**
 * DELETE /:category
 * Withdraw consent (PDPA right)
 */
router.delete('/:category', authenticateHealth, async (req, res) => {
    try {
        const { category } = req.params;

        // Validate the category (POST / does this; DELETE did not) — an
        // unvalidated param let any string be written into the consent ledger
        // + a CONSENT_WITHDRAWN audit row (self-scoped pollution).
        if (!category || !Object.values(ConsentCategory).includes(category)) {
            return res.status(400).json({ success: false, error: 'Invalid consent category' });
        }

        const consent = await consentManager.withdrawConsent(
            req.user.id,
            category,
            getRequestIp(req),
            req.headers['user-agent'],
        );

        res.json({
            success: true,
            message: 'Consent withdrawn successfully',
            data: consent,
        });
    } catch (error) {
        return respondConsentError(res, req, error, 'Withdraw');
    }
});

/**
 * GET /document/:category
 * Get consent document content
 */
router.get('/document/:category', (req, res) => {
    const { category } = req.params;
    const lang = req.query.lang || 'th';

    const document = consentManager.getConsentDocument(category, lang);

    if (!document) {
        return res.status(404).json({
            success: false,
            error: 'Document not found',
        });
    }

    res.json({
        success: true,
        data: document,
    });
});

module.exports = router;
