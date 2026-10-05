/**
 * Purchase Invoice routes — /api/finance/purchase-invoices
 *
 * Iter 26 (hardening loop, 2026-05-16). Exposes the purchase-invoice-service
 * operations over a thin HTTP layer. Authentication is via
 * authenticateProvider; authorization (role + tenant scope) is enforced
 * inside the service layer so the contract stays identical for any
 * caller (CLI, cron, internal admin tool).
 *
 * Endpoints:
 *   POST   /                    create PENDING_REVIEW row (ACCOUNT_PLATFORM + ADMIN)
 *   GET    /                    list with filters (ACCOUNT_PLATFORM + ADMIN + AUDITOR)
 *   GET    /:id                 detail
 *   POST   /:id/approve         PENDING_REVIEW → APPROVED (writes Input VAT JE)
 *   POST   /:id/reject          PENDING_REVIEW → REJECTED (terminal)
 *   POST   /:id/mark-paid       record settlement date (status unchanged)
 *
 * Compliance:
 *   - All mutating endpoints audit-log via purchase-invoice-service.safeAudit.
 *   - Errors carry { code, statusCode } from makeError() so the HTTP
 *     status matches the cause (404 not-found, 409 invalid transition,
 *     422 invalid totals, etc.).
 *   - Reads protected per ม.86/4 + Thai PDPA — only ACCOUNT_PLATFORM /
 *     ADMIN / AUDITOR can see purchase-invoice rows.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { sendServiceError: sendFinanceServiceError } = require('./finance-route-helpers');
const purchaseInvoiceService = require('../../../services/purchase-invoice-service');

function sendServiceError(res, err) {
    return sendFinanceServiceError(res, err, { label: 'purchase-invoices', fallback: 'Failed to process purchase invoice request' });
}

// POST / — create a new purchase invoice in PENDING_REVIEW status.
router.post('/', authenticateProvider, async (req, res) => {
    try {
        const {
            invoiceNumber, supplierName, supplierTaxId, supplierAddress,
            invoiceDate, subtotal, vat, totalAmount, category,
            description, notes, attachmentId, organizationId,
        } = req.body || {};
        const created = await purchaseInvoiceService.createPurchaseInvoice({
            invoiceNumber,
            supplierName,
            supplierTaxId,
            supplierAddress,
            invoiceDate,
            subtotal,
            vat,
            totalAmount,
            category,
            description,
            notes,
            attachmentId,
            organizationId: organizationId || req.user?.organizationId || null,
            createdBy: req.user?.id || req.user?.canonicalId || 'SYSTEM',
            actor: req.user,
        });
        return res.status(201).json({ success: true, data: created });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// GET / — list with filters
router.get('/', authenticateProvider, async (req, res) => {
    try {
        const { status, from, to, organizationId } = req.query || {};
        const dateRange = (from || to) ? { from, to } : null;
        const list = await purchaseInvoiceService.listPurchaseInvoices({
            status,
            dateRange,
            organizationId: organizationId || req.user?.organizationId || null,
            actor: req.user,
        });
        return res.json({ success: true, data: list });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// GET /:id — detail
router.get('/:id', authenticateProvider, async (req, res) => {
    try {
        const row = await purchaseInvoiceService.findPurchaseInvoiceById(req.params.id, {
            actor: req.user,
        });
        if (!row) {
            return res.status(404).json({
                success: false,
                error: 'PURCHASE_INVOICE_NOT_FOUND',
                message: 'Purchase invoice not found',
            });
        }
        return res.json({ success: true, data: row });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// POST /:id/approve — PENDING_REVIEW → APPROVED + journal entry write.
router.post('/:id/approve', authenticateProvider, async (req, res) => {
    try {
        const updated = await purchaseInvoiceService.approvePurchaseInvoice(req.params.id, {
            actor: req.user,
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// POST /:id/reject — PENDING_REVIEW → REJECTED (terminal).
router.post('/:id/reject', authenticateProvider, async (req, res) => {
    try {
        const { reason } = req.body || {};
        const updated = await purchaseInvoiceService.rejectPurchaseInvoice(req.params.id, {
            reason,
            actor: req.user,
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

// POST /:id/mark-paid — record settlement date.
router.post('/:id/mark-paid', authenticateProvider, async (req, res) => {
    try {
        const { paidAt } = req.body || {};
        const updated = await purchaseInvoiceService.markAsPaid(req.params.id, {
            paidAt,
            actor: req.user,
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

module.exports = router;
