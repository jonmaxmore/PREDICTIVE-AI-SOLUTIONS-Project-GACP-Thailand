/**
 * Refund routes — /api/finance/refunds
 *
 * Iter 23 (2026-05-16). Exposes the refund-service over a thin HTTP layer.
 * Authentication via authenticateProvider; authorization (role + tenant)
 * is enforced inside the service layer so the contract stays identical
 * for any future caller (CLI, cron, internal admin tool).
 *
 * Endpoints:
 *   POST /:invoiceId/initiate   — orchestrate full refund flow
 *                                  (ACCOUNT_PLATFORM or ADMIN required)
 *   GET  /:invoiceId/status     — read refund history for one invoice
 *                                  (ACCOUNT_PLATFORM, AUDITOR, or ADMIN)
 *   POST /:refundId/cancel      — soft-cancel an INITIATED refund
 *                                  (ADMIN only — separation of duties)
 *
 * Legal basis (cited in refund-service.js):
 *   - ป.รัษฎากร ม.86/10 — ใบลดหนี้ (Credit Note)
 *   - ป.รัษฎากร ม.86/4  — sequential numbering + 7-year retention
 *   - ป.รัษฎากร ม.86/9  — ใบเพิ่มหนี้ (Debit Note) — referenced in error
 *                          messages when a POSTED CN cannot be cancelled.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { sendServiceError: sendFinanceServiceError } = require('./finance-route-helpers');
const refundService = require('../../../services/refund-service');

function sendServiceError(res, err) {
    return sendFinanceServiceError(res, err, { label: 'refunds', fallback: 'Failed to process refund request' });
}

// POST /:invoiceId/initiate — start refund flow.
// Body: { reason, reasonCode, organizationId? }
// Role: ACCOUNT_PLATFORM or ADMIN (service-layer assertWriteAccess).
router.post('/:invoiceId/initiate', authenticateProvider, async (req, res) => {
    try {
        const { reason, reasonCode, organizationId } = req.body || {};
        const result = await refundService.initiateRefund({
            invoiceId: req.params.invoiceId,
            reason,
            reasonCode,
            actor: req.user,
            actorId: req.user?.id,
            organizationId,
        });
        const status = result.idempotent ? 200 : 201;
        return res.status(status).json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// GET /:invoiceId/status — refund history for one invoice.
router.get('/:invoiceId/status', authenticateProvider, async (req, res) => {
    try {
        const result = await refundService.getRefundStatus(
            req.params.invoiceId,
            { actor: req.user },
        );
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'INVOICE_NOT_FOUND',
                message: 'Invoice not found',
            });
        }
        return res.json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// POST /:refundId/cancel — ADMIN-only cancel.
// Body: { reason? }
//
// refundId === invoiceId for Iter 23 (the refund block lives on
// Invoice.metadata). When a future iteration promotes refunds to their
// own row, this param becomes the new Refund.id without route changes.
router.post('/:refundId/cancel', authenticateProvider, async (req, res) => {
    try {
        const { reason } = req.body || {};
        const result = await refundService.cancelRefund(req.params.refundId, {
            actor: req.user,
            reason,
        });
        return res.json({ success: true, data: result });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

module.exports = router;
