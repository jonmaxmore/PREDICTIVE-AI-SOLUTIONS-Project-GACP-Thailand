/**
 * Invoice Receipt + Finance Route Handlers
 * Receipt issuance + PDF, hold/release/forfeit, CSV export, revenue summary.
 *
 * Slip-flow (PR #58–#63) replaced PromptPay/Ksher payment-init routes
 * that previously lived in this file.
 *
 * @module routes/api/finance/invoice-payment-handlers
 */

const express = require('express');
const { safeErrorMessage, respondError } = require('../../../shared/api-response');
const router = express.Router();
const invoiceService = require('../../../services/invoice-service');
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');
const { normalizeRole, hasPermission, PERMISSIONS } = require('../../../shared/canonical-rbac');
const { exportCSV } = require('../../../services/financial-export-service');
const { assertInvoiceSideWritable } = require('./invoice-helpers');
const { getZonedParts } = require('../../../utils/working-days');

const requirePermission = (permission) => (req, res, next) => {
    const canonicalRole = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!canonicalRole || !hasPermission(canonicalRole, permission)) {
        return res.status(403).json({ success: false, error: 'Forbidden', message: `Permission required: ${permission}` });
    }
    req.user.canonicalRole = canonicalRole;
    return next();
};

/**
 * POST /api/invoices/:invoiceId/receipt
 * Issue Receipt for paid invoice (Accountant Only)
 */
router.post('/:invoiceId/receipt', authenticateProvider, requirePermission(PERMISSIONS.RECEIPT_ISSUE), async (req, res) => {
    try {
        const { paymentMethod, notes } = req.body;
        const result = await invoiceService.issueReceipt(
            req.params.invoiceId,
            // Invoice.receiptIssuedBy is a plain scalar (NOT in the PDPA encrypt
            // hook). req.user.providerId is a DECRYPTED plaintext 13-digit ID, so
            // stamp the User UUID/token first (matches purchase-invoices.js + the
            // round-2/6 scalar-audit-column fixes).
            req.user?.id || req.user?.canonicalId || 'SYSTEM',
            paymentMethod,
            notes,
        );
        res.json({ success: true, message: 'Receipt issued successfully', data: result });
    } catch (error) {
        // invoiceService throws a plain Error('… not found') for a missing/unpaid
        // invoice — surface that as 404 rather than a blanket 500.
        if (/not found/i.test(error?.message || '')) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        return respondError(res, req, error, { label: '[Invoices] receipt' });
    }
});

/**
 * GET /api/invoices/:invoiceId/receipt/pdf
 * Download Receipt PDF
 */
router.get('/:invoiceId/receipt/pdf', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const pdfBuffer = await invoiceService.generateReceiptPdf(req.params.invoiceId);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="receipt-${req.params.invoiceId}.pdf"`,
            'Content-Length': pdfBuffer.length,
        });
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- binary PDF Buffer served with an explicit Content-Type: application/pdf + attachment disposition; never interpreted as HTML.
        res.send(pdfBuffer);
    } catch (error) {
        // A missing/unfinalised invoice (service throws Error('… not found') or a
        // Prisma not-found) → 404; anything else is a genuine 500. (Error path
        // returns JSON, not a PDF.)
        if (/not found/i.test(error?.message || '')) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }
        return respondError(res, req, error, { label: '[Invoices] receiptPdf', message: 'Failed to generate Receipt PDF' });
    }
});

/**
 * GET /api/invoices/receipts/pending
 * List paid invoices pending receipt issuance (Accountant Only)
 */
router.get('/receipts/pending', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const invoices = await invoiceService.listPendingReceipts({});
        res.json({ success: true, data: { invoices } });
    } catch (error) {
        logger.error('[Invoices] Pending Receipts Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch pending receipts' });
    }
});

/**
 * GET /api/invoices/receipts/exceptions
 * List accounting/payment exceptions from webhook pipeline
 */
router.get('/receipts/exceptions', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
        const exceptions = await invoiceService.listReceiptExceptions(limit);
        res.json({ success: true, data: { exceptions } });
    } catch (error) {
        logger.error('[Invoices] Receipt Exceptions Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch receipt exceptions' });
    }
});

// ─── Finance Department Endpoints ────────────────────────────

/**
 * GET /api/invoices/revenue-summary
 * Revenue summary with Wallet A (Gov) / Wallet B (Company) segregation
 */
router.get('/revenue-summary', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const summary = await invoiceService.getRevenueSummary(req.query.startDate, req.query.endDate);
        res.json({ success: true, data: summary });
    } catch (error) {
        logger.error('[Invoices] Revenue Summary Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch revenue summary' });
    }
});

/**
 * POST /api/invoices/:invoiceId/hold
 * Hold/Suspend an invoice — blocks progression (Finance only)
 */
router.post('/:invoiceId/hold', authenticateProvider, requirePermission(PERMISSIONS.RECEIPT_ISSUE), async (req, res) => {
    try {
        await assertInvoiceSideWritable(req.user, req.params.invoiceId); // write-side SoD
        const { reason } = req.body;
        const result = await invoiceService.holdInvoice(
            req.params.invoiceId,
            reason,
            // heldBy lands in Invoice.metadata, which holdInvoice JSON.stringify's
            // to a STRING → escapes the Mod-11 value-net (the hook only walks
            // object Json). Stamp the UUID/token, not the plaintext providerId.
            req.user?.id || req.user?.canonicalId || 'SYSTEM',
        );
        res.json({ success: true, message: 'Invoice held successfully', data: result });
    } catch (error) {
        logger.error('[Invoices] Hold Error:', error);
        res.status(error.statusCode || (error.message?.includes('not found') ? 404 : 400)).json({
            success: false,
            error: safeErrorMessage(error),
            ...(error.code ? { code: error.code } : {}),
        });
    }
});

/**
 * POST /api/invoices/:invoiceId/release
 * Release hold on an invoice — restores previous status (Finance only)
 */
router.post('/:invoiceId/release', authenticateProvider, requirePermission(PERMISSIONS.RECEIPT_ISSUE), async (req, res) => {
    try {
        await assertInvoiceSideWritable(req.user, req.params.invoiceId); // write-side SoD
        const result = await invoiceService.releaseHold(
            req.params.invoiceId,
            // releasedBy is appended to the unencrypted Invoice.notes String column
            // — stamp the UUID/token, not the plaintext providerId.
            req.user?.id || req.user?.canonicalId || 'SYSTEM',
        );
        res.json({ success: true, message: 'Hold released successfully', data: result });
    } catch (error) {
        logger.error('[Invoices] Release Error:', error);
        res.status(error.statusCode || (error.message?.includes('not found') ? 404 : 400)).json({
            success: false,
            error: safeErrorMessage(error),
            ...(error.code ? { code: error.code } : {}),
        });
    }
});

/**
 * GET /api/invoices/export?format=csv&type=monthly&month=3&year=2026
 * Financial export engine — CSV reports
 */
router.get('/export', authenticateProvider, requirePermission(PERMISSIONS.INVOICE_VIEW_ALL), async (req, res) => {
    try {
        const reportType = req.query.type || 'monthly';
        // Default: the current Bangkok month (the ภ.พ.30 month).
        const nowBkk = getZonedParts(new Date());
        const month = parseInt(req.query.month) || nowBkk.month;
        const year = parseInt(req.query.year) || nowBkk.year;

        // Tenant scope: the export service uses the module prisma client (no
        // request-scoped auto-org-scoping), so thread the org id explicitly.
        const orgId = req.user?.organizationId;
        const extraWhere = {
            ...(orgId ? { organizationId: orgId } : {}),
        };

        const { buffer, filename, contentType } = await exportCSV(reportType, month, year, extraWhere);
        res.set({
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': buffer.length,
        });
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- binary report export (CSV/xlsx) served with the exporter's own Content-Type + attachment disposition; never interpreted as HTML.
        res.send(buffer);
    } catch (error) {
        logger.error('[Invoices] Export Error:', error);
        return respondError(res, req, error, { message: 'Failed to export report' });
    }
});

module.exports = router;
