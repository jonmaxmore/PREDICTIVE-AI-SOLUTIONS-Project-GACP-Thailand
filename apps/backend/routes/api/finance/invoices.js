/**
 * @swagger
 * tags:
 *   name: Invoices
 *   description: Invoice management and payments
 */

/**
 * Invoice Routes (Refactored)
 *
 * This file was split from a 550-line monolith into focused modules:
 *
 * - invoice-helpers.js         — Shared helpers (resolveHealthId, findHealthInvoice)
 * - invoice-payment-handlers.js — Payment, receipt, hold/release/forfeit, export routes
 *
 * All API endpoints remain at their original paths. No breaking changes.
 *
 * @module routes/api/finance/invoices
 */

const express = require('express');
const { safeErrorMessage, respondError } = require('../../../shared/api-response');
const router = express.Router();
const invoiceService = require('../../../services/invoice-service');
const { authenticateProvider, authenticateHealth } = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');
const { normalizeRole, hasPermission, PERMISSIONS } = require('../../../shared/canonical-rbac');

const { resolveHealthId, findHealthInvoice, hasIssuedReceipt, receiptFileName } = require('./invoice-helpers');

// The holder scope of this request (spec 2026-09-30-remove-workspace-mode §3.1).
// Required lazily: holder-access loads farm-access and the permission engine.
function requestHolderScope(req) {
    return require('../../../services/holder-access').holderScope(req);
}

const requirePermission = (permission) => (req, res, next) => {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!canonicalRole || !hasPermission(canonicalRole, permission)) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: `Permission required: ${permission}` });
    }
    req.user.canonicalRole = canonicalRole;
    return next();
};

// ─── List & View Routes ──────────────────────────────────────

/**
 * @swagger
 * /api/invoices:
 *   get:
 *     summary: List all invoices (Provider only)
 *     tags: [Invoices]
 *     security:
 *       - BearerAuth: []
 */
router.get('/', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const filters = {
            status: req.query.status,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        };
        const invoices = await invoiceService.listAll(filters, req.query.limit ? parseInt(req.query.limit) : 50);
        res.json({ success: true, data: { invoices } });
    } catch (error) {
        logger.error('[Invoices] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch invoices' });
    }
});

/**
 * @swagger
 * /api/invoices/my:
 *   get:
 *     summary: Get my invoices (Health Only)
 *     tags: [Invoices]
 */
router.get('/my', authenticateHealth, async (req, res) => {
    try {
        const healthId = await resolveHealthId(req.user);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        // Whose invoices these are is decided by the holder entities the caller is an
        // ACTIVE member of, not by who filed (operator ruling: company co-members see
        // company finance documents; spec 2026-09-30-remove-workspace-mode §3.1).
        const invoices = await invoiceService.listForHolders({
            scope: await requestHolderScope(req),
            status: req.query.status,
        });
        res.json({ success: true, data: invoices });
    } catch (error) {
        logger.error('[Invoices] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch invoices' });
    }
});

/**
 * @swagger
 * /api/invoices/my/{invoiceId}/receipt/pdf:
 *   get:
 *     summary: Download the receipt / tax invoice of my own paid invoice (Health only)
 *     tags: [Invoices]
 */
// The applicant's copy of the receipt the system issued at settlement
// (staging walk 2026-09-29, P1). The staff door GET /:invoiceId/receipt/pdf
// stays behind INVOICE_VIEW_ALL; this one reads by holder (findHealthInvoice —
// the same gate as GET /:invoiceId/pdf). It renders the stored receipt row as
// it is: no number is allocated and nothing is written.
router.get('/my/:invoiceId/receipt/pdf', authenticateHealth, async (req, res) => {
    try {
        const scope = await requestHolderScope(req);
        const invoice = await findHealthInvoice(req.params.invoiceId, scope);
        if (!hasIssuedReceipt(invoice)) {
            return res.status(409).json({
                success: false,
                error: 'Receipt not issued for this invoice',
                code: 'RECEIPT_NOT_ISSUED',
            });
        }
        const pdfBuffer = await invoiceService.generateReceiptPdf(invoice.id, { scope });
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${receiptFileName(invoice)}"`,
            'Content-Length': pdfBuffer.length,
        });
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- binary PDF Buffer served with an explicit Content-Type: application/pdf + attachment disposition (after an ownership check); never interpreted as HTML.
        res.send(pdfBuffer);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: safeErrorMessage(error), ...(error.code ? { code: error.code } : {}) });
        }
        logger.error('[Invoices] Receipt PDF Error:', error);
        return respondError(res, req, error, { label: '[Invoices] myReceiptPdf', message: 'Failed to generate Receipt PDF' });
    }
});

/**
 * @swagger
 * /api/invoices/summary:
 *   get:
 *     summary: Get financial summary (Provider only)
 *     tags: [Invoices]
 */
router.get('/summary', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const summary = await invoiceService.getSummary(req.query.startDate, req.query.endDate);
        res.json({ success: true, data: summary });
    } catch (error) {
        logger.error('[Invoices] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch summary' });
    }
});

// ─── Payment, Receipt & Finance Routes (extracted) ───────────
// MUST be mounted BEFORE the single-segment `/:invoiceId` route below, or its
// literal routes (/revenue-summary, /split-calculator, /receipts/*, /export)
// are shadowed by `/:invoiceId` and become unreachable (404 "Invoice not
// found"). invoice-payment-handlers has no bare `/:param` route, so mounting
// it first cannot shadow `/:invoiceId` or `/:invoiceId/pdf`.
const paymentHandlers = require('./invoice-payment-handlers');
router.use('/', paymentHandlers);

/**
 * @swagger
 * /api/invoices/{invoiceId}:
 *   get:
 *     summary: Get invoice details
 *     tags: [Invoices]
 */
router.get('/:invoiceId', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const invoice = await invoiceService.getById(req.params.invoiceId);
        if (!invoice) {return res.status(404).json({ success: false, message: 'Invoice not found' });}
        res.json({ success: true, data: invoice });
    } catch (error) {
        logger.error('[Invoices] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch invoice' });
    }
});

/**
 * @swagger
 * /api/invoices/{invoiceId}/pdf:
 *   get:
 *     summary: Download Invoice PDF
 *     tags: [Invoices]
 */
router.get('/:invoiceId/pdf', authenticateHealth, async (req, res) => {
    try {
        const scope = await requestHolderScope(req);
        await findHealthInvoice(req.params.invoiceId, scope);
        const pdfBuffer = await invoiceService.generatePdf(req.params.invoiceId, { scope });
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="invoice-${req.params.invoiceId}.pdf"`,
            'Content-Length': pdfBuffer.length,
        });
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- binary PDF Buffer served with an explicit Content-Type: application/pdf + attachment disposition (after an ownership check); never interpreted as HTML.
        res.send(pdfBuffer);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: safeErrorMessage(error) });
        }
        logger.error('[Invoices] PDF Error:', error);
        res.status(500).send('Failed to generate PDF');
    }
});

module.exports = router;
