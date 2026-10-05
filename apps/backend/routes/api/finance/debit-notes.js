/**
 * Debit Note routes — /api/finance/debit-notes
 *
 * Batch B20-A (2026-05-16). Mirror of credit-notes.js — thin HTTP layer
 * over debit-note-service. Role + tenant scoping live in the service.
 *
 * Endpoints:
 *   POST   /                  create DRAFT (ACCOUNT_PLATFORM + ADMIN)
 *   POST   /:id/issue         DRAFT → ISSUED
 *   POST   /:id/post          ISSUED → POSTED (writes additional GL entry)
 *   POST   /:id/cancel        soft-cancel
 *   GET    /                  list with filters
 *   GET    /:id               detail
 *   GET    /:id/pdf           render ใบเพิ่มหนี้ PDF (501 until
 *                             generateDebitNotePdf is wired in
 *                             pdf/invoice-template-service.js — the HTML
 *                             template at debit-note.html is ready)
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const debitNoteService = require('../../../services/debit-note-service');

const { sendServiceError: sendFinanceError } = require('./finance-route-helpers');

// 5xx answers a fixed message and logs the error; 4xx keeps the service's message (L2).
function sendServiceError(res, err) {
    return sendFinanceError(res, err, { label: 'debit-notes', fallback: 'Failed to process debit note request' });
}

router.post('/', authenticateProvider, async (req, res) => {
    try {
        const { originalInvoiceId, reasonCode, reason, subtotal, vat, organizationId } = req.body || {};
        const dn = await debitNoteService.createDebitNote({
            originalInvoiceId,
            reasonCode,
            reason,
            subtotal,
            vat,
            organizationId,
            actor: req.user,
        });
        return res.status(201).json({ success: true, data: dn });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

router.post('/:id/issue', authenticateProvider, async (req, res) => {
    try {
        const updated = await debitNoteService.issueDebitNote(req.params.id, {
            actor: req.user,
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

router.post('/:id/post', authenticateProvider, async (req, res) => {
    try {
        const updated = await debitNoteService.postDebitNote(req.params.id, {
            actor: req.user,
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

router.post('/:id/cancel', authenticateProvider, async (req, res) => {
    try {
        const { reason } = req.body || {};
        const updated = await debitNoteService.cancelDebitNote(req.params.id, {
            actor: req.user,
            reason,
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

router.get('/', authenticateProvider, async (req, res) => {
    try {
        const { originalInvoiceId, status, from, to, organizationId } = req.query || {};
        if (originalInvoiceId) {
            const list = await debitNoteService.listDebitNotesForInvoice(
                originalInvoiceId,
                { actor: req.user },
            );
            return res.json({ success: true, data: list });
        }
        const list = await debitNoteService.listDebitNotes({
            status,
            organizationId: organizationId || req.user?.organizationId,
            from, to,
            actor: req.user,
        });
        return res.json({ success: true, data: list });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

router.get('/:id', authenticateProvider, async (req, res) => {
    try {
        const dn = await debitNoteService.findDebitNoteById(req.params.id, {
            actor: req.user,
        });
        if (!dn) {
            return res.status(404).json({
                success: false, error: 'DEBIT_NOTE_NOT_FOUND',
                message: 'Debit note not found',
            });
        }
        return res.json({ success: true, data: dn });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

router.get('/:id/pdf', authenticateProvider, async (req, res) => {
    try {
        // The document read carries the original invoice's applying entity for
        // the payer block (internal only — never serialised; the JSON detail
        // route above keeps findDebitNoteById).
        const dn = await debitNoteService.findDebitNoteForDocument(req.params.id, {
            actor: req.user,
        });
        if (!dn) {
            return res.status(404).json({
                success: false, error: 'DEBIT_NOTE_NOT_FOUND',
                message: 'Debit note not found',
            });
        }
        let invoiceTemplateService;
        try {
            invoiceTemplateService = require('../../../services/pdf/invoice-template-service');
        } catch (_e) {
            invoiceTemplateService = null;
        }
        if (invoiceTemplateService && typeof invoiceTemplateService.generateDebitNotePdf === 'function') {
            const buf = await invoiceTemplateService.generateDebitNotePdf(dn, { upload: false });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition',
                `inline; filename="${dn.debitNoteNumber || `draft-${dn.id}`}.pdf"`); // a DRAFT has no number yet
            return res.send(buf);
        }
        return res.status(501).json({
            success: false,
            error: 'PDF_RENDER_NOT_WIRED',
            message: 'generateDebitNotePdf is not yet wired in '
                + 'services/pdf/invoice-template-service.js. '
                + 'HTML template lives at services/pdf/templates/debit-note.html — '
                + 'the next batch can wire the buffer renderer there.',
        });
    } catch (err) {
        return sendServiceError(res, err);
    }
});

module.exports = router;
