/**
 * Quote Routes
 * Manages Quotes and conversion to Invoices.
 *
 * Batch 11 (Finance cluster) — all direct `prisma.quote.*` /
 * `prisma.invoice.create` / `prisma.user.findFirst` calls have been moved
 * into `services/quote-service.js`. No direct model reads/writes happen here.
 *
 * WF-F1 fix (2026-05): the send/accept/reject handlers no longer transition
 * Application.status. They previously called writeApplicationStatus with
 * non-canonical target states ('quote_sent' / 'awaiting_payment' /
 * 'pending_team_review') that the canonical state machine rejects, so
 * guardTransition ALWAYS threw InvalidTransitionError → HTTP 500. The quote
 * lifecycle lives on the Quote entity (QUOTE_STATUS); Application.status is
 * owned by the canonical payment/slip-flow.
 *
 * Tax-Invoice canonical totals (Tier 8/9 — anti-regression):
 *   Subtotal / vat / totalAmount are PASSED THROUGH from the items array
 *   to the Quote row to the Invoice row. We do not recompute the triple
 *   silently anywhere on this hot path; if the math is wrong the fix is
 *   at the input side.
 */
const express = require('express');
const router = express.Router();
const { authenticateProvider, authenticateHealth } = require('../../../middleware/auth-middleware');
const { sendNotification, NotifyType } = require('../../../services/notification-service');
const logger = require('../../../shared/logger');
const { respondError } = require('../../../shared/api-response');
const { registerQuoteProviderAdminRoutes } = require('../helpers/quotes-provider-routes');
const { financeOnly, financeReader } = require('../../../middleware/role-middleware');
const applicationService = require('../../../services/application-service');
const quoteService = require('../../../services/quote-service');
// Required lazily: holder-access loads the permission engine, which suites that
// stub entity-service cannot load.
const holderScopeOf = (req) => require('../../../services/holder-access').holderScope(req);
const { resolveUserIdFromHealthIdSecurely } = require('../../../services/user-lookup-service');

const { QUOTE_STATUS, QUOTE_VALID_STATUSES } = quoteService;

// Sprint 6 healthId-audit H8: delegate identity resolution to the canonical
// applicationService.resolveHealthIdentity. The file-local helper preserves
// the legacy signature (user → healthId string) so existing call sites do
// not change, but the lookup itself now goes through the canonical service.
async function resolveApplicantHealthId(user) {
    // Prefer canonicalId (Invoice FK target), fallback to healthId
    const explicit = String(user?.canonicalId || user?.healthId || '').trim();
    if (explicit) {
        return explicit;
    }
    const userId = String(user?.id || '').trim();
    if (!userId) {
        return null;
    }
    try {
        const identity = await applicationService.resolveHealthIdentity(userId, { userId });
        return identity.healthId || null;
    } catch (_error) {
        return null;
    }
}

async function resolveUserIdByHealthId(healthId) {
    return resolveUserIdFromHealthIdSecurely(healthId);
}

// Get all quotes (provider)
router.get('/', authenticateProvider, financeReader, async (req, res) => {
    try {
        // Sprint 6 healthId-audit C3: the legacy `?healthId=<13-digit>` filter
        // is REMOVED. PDPA bans putting plaintext national IDs in URLs (they
        // end up in webserver logs, the browser history, and Referer headers).
        // The replacement is `?applicantId=<user UUID>` — the server then
        // resolves UUID → healthId via the canonical resolveHealthIdentity.
        // Defence-in-depth: reject BEFORE touching the DB so a leaked
        // healthId in a URL never produces a database query at all.
        if (Object.prototype.hasOwnProperty.call(req.query, 'healthId')) {
            return res.status(400).json({
                success: false,
                error: 'PARAM_REMOVED',
                message: 'The ?healthId= query parameter is removed for PDPA compliance. Use ?applicantId=<userId> instead.',
            });
        }
        const { status, applicantId, page = 1, limit = 20 } = req.query;

        let applicantHealthId = null;
        if (applicantId) {
            // Translate UUID → healthId server-side. If the UUID does not
            // resolve to a real user we MUST return an empty list and NOT
            // run a broad findMany — otherwise an attacker could probe the
            // entire quote table by sending random UUIDs.
            applicantHealthId = await quoteService.resolveApplicantHealthId(applicantId);
            if (!applicantHealthId) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: { page: 1, limit: 20, total: 0, pages: 0 },
                });
            }
        }

        const result = await quoteService.listForProvider({
            status,
            applicantHealthId,
            page,
            limit,
        });

        res.json({
            success: true,
            data: result.data,
            pagination: result.pagination,
        });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] getQuotes', message: 'Failed to get quotes' });
    }
});

// Get My Quotes (Applicant) - NEW
router.get('/my', authenticateHealth, async (req, res) => {
    try {
        const healthId = await resolveApplicantHealthId(req.user);
        if (!healthId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const { status } = req.query;
        const quotes = await quoteService.listForApplicant(healthId, {
            status,
            holderScope: await holderScopeOf(req),
        });
        res.json({ success: true, data: quotes });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] getMyQuotes', message: 'Failed to get quotes' });
    }
});

// Create new quote (provider)
router.post('/', authenticateProvider, financeOnly, async (req, res) => {
    try {
        const { applicationId, items, validDays = 30, notes } = req.body;

        const application = await quoteService.findApplicationForQuote(applicationId);
        if (!application) {
            return res.status(404).json({ success: false, message: 'Application not found' });
        }

        // Calculate totals.
        // Tax-Invoice canonical totals: GACP certification is currently
        // VAT-exempt (ม.86), so `vat = 0`. The triple {subtotal, vat,
        // totalAmount} is then persisted verbatim on the Quote row.
        const safeItems = Array.isArray(items) ? items : [];
        const subtotal = safeItems.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unitPrice || 0)), 0);
        const vat = 0; // Thailand GACP exempt
        const totalAmount = subtotal + vat;

        const validUntil = new Date();
        validUntil.setTime(validUntil.getTime() + validDays * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read

        const quoteNumber = await quoteService.generateQuoteNumber();
        const quote = await quoteService.createQuote({
            applicationId,
            items: safeItems,
            subtotal,
            vat,
            totalAmount,
            validUntil,
            notes,
            quoteNumber,
            status: QUOTE_STATUS.DRAFT,
        });

        res.status(201).json({
            success: true,
            message: 'สร้างใบเสนอราคาสำเร็จ',
            data: quote,
        });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] createQuote', message: 'Failed to create quote' });
    }
});

// Update Quote Status (General)
router.put('/:id/status', authenticateProvider, financeOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;

        if (!QUOTE_VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const updateData = { status };
        if (status === QUOTE_STATUS.ACCEPTED) { updateData.acceptedAt = new Date(); }
        if (status === QUOTE_STATUS.REJECTED) { updateData.rejectedAt = new Date(); }
        if (notes) { updateData.notes = notes; }

        const quote = await quoteService.updateQuote(id, updateData);

        res.json({
            success: true,
            message: 'อัพเดทสถานะสำเร็จ',
            data: quote,
        });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] updateStatus', message: 'Failed to update quote status' });
    }
});

// Send Quote to Applicant (provider) - NEW
router.post('/:id/send', authenticateProvider, financeOnly, async (req, res) => {
    try {
        const { id } = req.params;

        const quote = await quoteService.findByIdWithApplicationSlim(id);

        if (!quote) { return res.status(404).json({ success: false, message: 'Quote not found' }); }
        if (quote.status !== QUOTE_STATUS.DRAFT) { return res.status(400).json({ success: false, message: 'Quote already sent or processed' }); }

        // Update Quote status
        const updatedQuote = await quoteService.updateStatus(id, QUOTE_STATUS.SENT);

        // WF-F1: do NOT transition Application.status here. The quote lifecycle is
        // tracked on the Quote entity; Application.status is owned by the canonical
        // payment/slip-flow. (The old 'quote_sent' transition always threw → 500.)

        // Send Notification
        const ApplicantUserId = await resolveUserIdByHealthId(quote.application?.healthId);
        if (ApplicantUserId) {
            await sendNotification(ApplicantUserId, NotifyType.QUOTE_RECEIVED, {
                quoteId: quote.id,
                quoteNumber: quote.quoteNumber,
                amount: quote.totalAmount,
                validUntil: quote.validUntil,
            });
        }

        res.json({ success: true, message: 'Quote sent', data: updatedQuote });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] sendQuote', message: 'Failed to send quote' });
    }
});

// Accept Quote (Applicant) - NEW
router.post('/:id/accept', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const healthId = await resolveApplicantHealthId(req.user);
        const ApplicantUserId = String(req.user?.id || '').trim();
        if (!healthId || !ApplicantUserId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Spec 2026-09-30 §3.1 (R1): the quote read carries the holder scope.
        const quote = await quoteService.findByIdWithApplicationSlim(id, {
            holderScope: await require('../../../services/holder-access').holderScope(req),
        });

        if (!quote) { return res.status(404).json({ success: false, message: 'Quote not found' }); }
        // Check ownership via application
        if (quote.application.healthId !== healthId) { return res.status(403).json({ success: false, message: 'Not authorized' }); }

        if (quote.status !== QUOTE_STATUS.SENT) {
            return res.status(400).json({ success: false, message: 'Quote cannot be accepted' });
        }

        if (new Date() > new Date(quote.validUntil)) {
            await quoteService.updateStatus(id, QUOTE_STATUS.EXPIRED);
            return res.status(400).json({ success: false, message: 'Quote expired' });
        }

        // Tax-Invoice canonical totals (Tier 8/9 — anti-regression):
        //   The invoice copies subtotal/vat/totalAmount VERBATIM from the
        //   accepted quote via createInvoiceFromQuote. The triple is the
        //   canonical structure the FlowAccount XLSX export and the PDF
        //   template depend on. Do NOT recompute totals here — they were
        //   already validated at quote-create time.
        const invoiceNumber = quoteService.generateInvoiceNumberRandom();
        const invoice = await quoteService.createInvoiceFromQuote({
            quote,
            invoiceNumber,
            healthId,
            serviceType: quote.application.serviceType || 'certification',
            includeLineItems: true,
        });

        // Update Quote
        await quoteService.markAcceptedWithInvoice(id, invoice.id);

        // WF-F1: do NOT transition Application.status here. The accepted quote +
        // generated invoice are the source of truth; Application.status is owned by
        // the canonical payment/slip-flow. (The old 'awaiting_payment' transition
        // always threw → 500.)

        // Notify
        await sendNotification(ApplicantUserId, NotifyType.INVOICE_RECEIVED, {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.totalAmount,
            applicationId: quote.applicationId,
        });

        res.json({ success: true, message: 'Quote accepted', data: { quote, invoice } });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] acceptQuote', message: 'Failed to accept quote' });
    }
});

// Reject Quote (Applicant) - NEW
router.post('/:id/reject', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const healthId = await resolveApplicantHealthId(req.user);
        if (!healthId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Spec 2026-09-30 §3.1 (R1): the quote read carries the holder scope.
        const quote = await quoteService.findByIdWithApplicationSlim(id, {
            holderScope: await require('../../../services/holder-access').holderScope(req),
        });

        if (!quote) { return res.status(404).json({ success: false, message: 'Quote not found' }); }
        if (quote.application.healthId !== healthId) { return res.status(403).json({ success: false, message: 'Not authorized' }); }

        await quoteService.markRejected(id, reason);

        // WF-F1: do NOT transition Application.status here — rejecting a quote
        // updates the Quote entity only. Application.status is owned by the canonical
        // flow. (The old 'pending_team_review' transition always threw → 500.)

        res.json({ success: true, message: 'Quote rejected' });

    } catch (error) {
        return respondError(res, req, error, { label: '[Quotes] rejectQuote', message: 'Failed to reject quote' });
    }
});

registerQuoteProviderAdminRoutes({
    router,
    authenticateProvider,
    financeOnly,
    logger,
});
module.exports = router;
