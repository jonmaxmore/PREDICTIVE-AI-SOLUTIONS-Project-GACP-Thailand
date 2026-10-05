/**
 * WHT (Withholding Tax 3%) routes — /api/finance/wht
 *
 * Iter 26 (hardening loop, 2026-05-16). Thin HTTP layer over
 * services/wht-service.js. Auth: authenticateProvider. Authorization:
 * delegated to the service via assertReadRole / assertWriteRole so the
 * boundary is identical for any future caller (CLI, cron, internal
 * admin tool).
 *
 * Endpoints:
 *   POST /api/finance/wht/certificate
 *     - Record a ทบ.50 ทวิ that a corporate buyer mailed to platform
 *       finance. Body: { invoiceId, certificateNumber, issuedByTaxId,
 *       issuedByName, certificateDate, whtAmount, attachmentId?,
 *       recordJournal? }. Roles: ACCOUNT_PLATFORM, ADMIN.
 *
 *   GET /api/finance/wht/certificates?startDate=&endDate=&organizationId=
 *     - List captured certificates for the date range. Used for the
 *       (future) monthly ภ.ง.ด.53 prep view + audit evidence. Roles:
 *       ACCOUNT_PLATFORM, AUDITOR, ADMIN.
 *
 *   GET /api/finance/wht/applicable/:invoiceId
 *     - Quick "does WHT apply here?" probe used by the invoice-detail
 *       UI before showing the upload-cert button. Roles: ACCOUNT_PLATFORM,
 *       AUDITOR, ADMIN.
 *
 * Legal anchors (cited in service module):
 *   - ป.รัษฎากร ม.50 — duty of payer to withhold.
 *   - ป.รัษฎากร ม.69 ทวิ — duty of payer to issue ทบ.50 ทวิ certificate.
 *   - ภ.ง.ด.53 — monthly remittance return (out of scope this stub).
 *
 * @module routes/api/finance/wht
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { sendServiceError: sendFinanceServiceError, requireOrganization } = require('./finance-route-helpers');
const whtService = require('../../../services/wht-service');

function sendServiceError(res, err) {
    return sendFinanceServiceError(res, err, { label: 'wht', fallback: 'Failed to process WHT request' });
}

// POST /api/finance/wht/certificate — record a ทบ.50 ทวิ. WRITE.
router.post('/certificate', authenticateProvider, async (req, res) => {
    try {
        whtService.assertWriteRole(req.user);
        const {
            invoiceId,
            certificateNumber,
            issuedByTaxId,
            issuedByName,
            certificateDate,
            whtAmount,
            attachmentId,
            recordJournal,
        } = req.body || {};
        const result = await whtService.recordWhtCertificate({
            invoiceId,
            certificateNumber,
            issuedByTaxId,
            issuedByName,
            certificateDate,
            whtAmount,
            attachmentId: attachmentId || null,
            actorId: req.user?.id || null,
            recordJournal: Boolean(recordJournal),
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// GET /api/finance/wht/certificates — list captured certs in a window. READ.
router.get('/certificates', authenticateProvider, async (req, res) => {
    try {
        whtService.assertReadRole(req.user);
        const { startDate, endDate } = req.query || {};
        // Scoped to the caller's own organization; a caller with none is
        // refused (L3, 2026-09-27). Cross-tenant views are not offered here.
        const organizationId = requireOrganization(req, res);
        if (!organizationId) { return undefined; }
        const certs = await whtService.listWhtCertificates({
            startDate: startDate || null,
            endDate: endDate || null,
            organizationId,
        });
        return res.json({
            success: true,
            data: { count: certs.length, certificates: certs },
        });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// GET /api/finance/wht/applicable/:invoiceId — UI probe. READ.
router.get('/applicable/:invoiceId', authenticateProvider, async (req, res) => {
    try {
        whtService.assertReadRole(req.user);
        // L4 (2026-09-27): the invoice must belong to the caller's organization.
        const organizationId = requireOrganization(req, res);
        if (!organizationId) { return undefined; }
        const result = await whtService.isWhtApplicableForInvoice(req.params.invoiceId, { organizationId });
        return res.json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

module.exports = router;
