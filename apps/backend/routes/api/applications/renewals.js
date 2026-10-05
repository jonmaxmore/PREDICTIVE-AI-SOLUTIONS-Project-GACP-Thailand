/**
 * Renewal Routes — Iter 26 (2026-05-16).
 *
 * Thin HTTP layer over renewal-service. Authorisation is enforced inside
 * the service: the actor must own the certificate AND hold
 * SUBMIT_APPLICATION on its holder entity (a renewal is a submission,
 * operator ruling 2026-10-03), checked before any row is written.
 *
 * Endpoints (mounted at /api/applications/renewals via routes/api/index.js):
 *   POST /api/applications/renewals
 *        body: { originalCertificateId }
 *        - HEALTH role (applicant) — must own the certificate and hold
 *          SUBMIT_APPLICATION on the certificate's holder (403
 *          ENTITY_PERMISSION_DENIED otherwise; 400 APPLICATION_HOLDER_REQUIRED
 *          when the certificate has no holder).
 *        - Creates the renewal at the site-visit payment gate
 *          (PENDING_AUDIT_FEE) with carry-forward data.
 *
 *   GET  /api/applications/renewals/upcoming-expiry
 *        query: ?days=60&take=200
 *        - Provider / admin view of certificates approaching expiry.
 *
 * Workflow cited:
 *   - W12 (operator ruling 2026-08-22, final — the change log @ 67ef3612):
 *     a renewal is ONE 30,000 charge with NO document review, straight to the
 *     site visit. It enters at PENDING_AUDIT_FEE and walks
 *     PENDING_AUDIT_FEE → AUDIT_FEE_PAID → AUDIT_CONFIRMED → AUDIT_PASSED →
 *     APPROVED → CERTIFIED.
 *   - This block previously read: "Renewal application travels the SAME
 *     canonical workflow as a new application (DRAFT → SUBMITTED → ... →
 *     CERTIFIED). The only difference is the formData.renewalOf marker."
 *     That is no longer true, and neither is the diagram in
 *     docs/audit/renewal-workflow-2026-05-16.md — flagged in the W12 report.
 *   - The skip is recorded on formData and in an APPLICATION audit row
 *     (action RENEWAL_FAST_PATH_ENTRY); see services/renewal-service.js.
 *
 * @module routes/api/applications/renewals
 */

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../../../shared/logger');
const {
    authenticateHealth,
    authenticateProvider,
} = require('../../../middleware/auth-middleware');
const renewalService = require('../../../services/renewal-service');
// R2 Task 8: the caller's holder scope; the renewal service checks the source holder against it.
const { holderScope } = require('../../../services/holder-access');
const { entityPermissionDeniedBody } = require('../../../shared/entity-permission-denied');

// ── Error mapper ───────────────────────────────────────────────────────────

function sendServiceError(res, err) {
    const status = err?.statusCode || 500;
    const code = err?.code || 'INTERNAL_ERROR';
    if (status >= 500) {
        logger.error(`[renewals-route] ${code}: ${err?.message}`, err);
    }
    // One answer for this code at every door (shared/entity-permission-denied.js).
    if (code === 'ENTITY_PERMISSION_DENIED') {
        return res.status(403).json(entityPermissionDeniedBody(err?.permission));
    }
    const body = {
        success: false,
        error: code,
        message: err?.message || 'Renewal request failed',
    };
    if (err?.data) {body.data = err.data;}
    return res.status(status).json(body);
}

// ── POST / — create a renewal DRAFT application ────────────────────────────

router.post('/', authenticateHealth, async (req, res) => {
    try {
        const body = req.body || {};
        const originalCertificateId = body.originalCertificateId || body.certificateId;
        if (!originalCertificateId) {
            return res.status(400).json({
                success: false,
                error: 'VALIDATION_ERROR',
                message: 'originalCertificateId is required',
            });
        }
        const actorId = req.user?.id;
        if (!actorId) {
            return res.status(401).json({
                success: false,
                error: 'UNAUTHENTICATED',
                message: 'Authentication required',
            });
        }

        // The service decides the holder before it writes anything (R2 Task 8 fix
        // round 1): no holder → 400 APPLICATION_HOLDER_REQUIRED; a caller without
        // SUBMIT_APPLICATION on the holder → 403 (operator ruling 2026-10-03: a
        // renewal is a submission). Both write the APPLICATION_SUBMIT_DENIED audit row.
        const result = await renewalService.createRenewalApplication({
            originalCertificateId,
            actorId,
            holderScope: await holderScope(req),
        });

        logger.info('[renewals-route] renewal created', {
            applicationId: result.applicationId,
            originalCertificateId,
            actorId,
        });

        return res.status(201).json({
            success: true,
            data: result,
        });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// ── GET /upcoming-expiry — provider/admin dashboard view ───────────────────

router.get('/upcoming-expiry', authenticateProvider, async (req, res) => {
    try {
        const days = req.query?.days !== undefined
            ? Math.max(1, Math.min(365, Number.parseInt(req.query.days, 10) || 60))
            : 60;
        const take = req.query?.take !== undefined
            ? Math.max(1, Math.min(1000, Number.parseInt(req.query.take, 10) || 200))
            : 200;

        const rows = await renewalService.listUpcomingExpiry({ days, take });

        return res.json({
            success: true,
            data: rows,
            meta: {
                days,
                total: rows.length,
            },
        });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

module.exports = router;
