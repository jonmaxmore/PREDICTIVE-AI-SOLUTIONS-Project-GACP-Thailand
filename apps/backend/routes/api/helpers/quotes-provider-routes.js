/**
 * Provider/Admin quote routes — register-time module.
 *
 * Batch 11 (Finance cluster) — all direct `prisma.quote.*` /
 * `prisma.invoice.*` calls migrated into `services/quote-service.js`. The
 * `prisma` parameter on the legacy signature is now optional and unused;
 * we keep it in the destructured args so existing callers that pass it
 * still work, but we no longer reach into the client here.
 *
 * Tax-Invoice canonical totals (Tier 8/9 — anti-regression):
 *   The manual quote-to-invoice path copies {subtotal, vat, totalAmount}
 *   verbatim from the source quote. We do not recompute the triple here.
 */
const quoteService = require('../../../services/quote-service');

function registerQuoteProviderAdminRoutes({
    router,
    // `prisma` is accepted but unused — kept for back-compat with callers
    // that still pass it in. All DB access now goes through quoteService.
    prisma: _prisma,
    authenticateProvider,
    financeOnly,
    logger,
}) {
    // Create Invoice from Quote (provider Manual Override) — finance role only.
    // SEC-FIN-001/SEC-APP-001: minting a tax invoice must be gated to accountants/admins.
    router.post('/:id/invoice', authenticateProvider, financeOnly, async (req, res) => {
        try {
            const { id } = req.params;

            const quote = await quoteService.findByIdWithApplicationSlim(id);

            if (!quote) {
                return res.status(404).json({ success: false, message: 'Quote not found' });
            }

            if (quote.status !== 'accepted') {
                return res.status(400).json({ success: false, message: 'Quote must be accepted before creating invoice' });
            }

            // Tax-Invoice canonical totals: copy subtotal/vat/totalAmount
            // verbatim. The manual path does NOT add per-line items (the
            // legacy behaviour) — keep includeLineItems=false to preserve
            // the previous response shape exactly.
            const invoiceNumber = await quoteService.generateInvoiceNumberSequential();
            const invoice = await quoteService.createInvoiceFromQuote({
                quote,
                invoiceNumber,
                healthId: quote.application.healthId,
                serviceType: 'certification_fee',
                includeLineItems: false,
            });

            await quoteService.updateStatus(quote.id, 'invoiced');

            return res.status(201).json({
                success: true,
                message: 'สร้างใบวางบิลจากใบเสนอราคาสำเร็จ',
                data: invoice,
            });
        } catch (error) {
            logger.error('[Quotes] createInvoiceFromQuote error:', error);
            return res.status(500).json({ success: false, message: 'Failed to create invoice' });
        }
    });

    // Update Document Number (Accountant Only) — enforce the documented role gate.
    // SEC-FIN-001: renumbering a tax document affects the sequential-number trail.
    router.put('/:id/number', authenticateProvider, financeOnly, async (req, res) => {
        try {
            const { id } = req.params;
            const { newNumber, type } = req.body;

            if (type === 'quote') {
                const existing = await quoteService.findQuoteByNumber(newNumber);
                if (existing && existing.id !== id) {
                    return res.status(409).json({ success: false, message: 'Number already exists' });
                }

                const updated = await quoteService.updateQuoteNumber(id, newNumber);
                return res.json({ success: true, message: 'Updated', data: updated });
            }

            if (type === 'invoice') {
                const existing = await quoteService.findInvoiceByNumber(newNumber);
                if (existing && existing.id !== id) {
                    return res.status(409).json({ success: false, message: 'Number already exists' });
                }

                const updated = await quoteService.updateInvoiceNumber(id, newNumber);
                return res.json({ success: true, message: 'Updated', data: updated });
            }

            return res.status(400).json({ success: false, message: 'Invalid type' });
        } catch (error) {
            logger.error('[Quotes] updateNumber error:', error);
            return res.status(500).json({ success: false, message: 'Failed to update number' });
        }
    });
}

module.exports = {
    registerQuoteProviderAdminRoutes,
};
