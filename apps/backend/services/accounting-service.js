/**
 * Accounting Service — canonical home for the finance dashboard aggregates.
 *
 * Created for tech-debt batch 11 (Finance cluster) to retire direct
 * `prisma.invoice.*` / `prisma.quote.*` calls from
 * `routes/api/finance/accounting.js`.
 *
 * These aggregates feed two surfaces:
 *   1. The accounting dashboard (counts + paid totals).
 *   2. The FlowAccount XLSX export the accountant runs at month-end.
 *
 * Row-level invariants centralised here:
 *   - `isDeleted: false` on every read (otherwise soft-deleted invoices
 *     would inflate revenue numbers — a regulator-visible defect).
 *   - Status filters use the same casing as the rest of the canonical
 *     pipeline (lowercase here for back-compat; invoice-service exposes
 *     the canonical mixed-case set via canonicalPaidStatuses()).
 *
 * Tax-Invoice canonical totals (Tier 8/9 — anti-regression):
 *   - The "revenue" figure is `_sum.totalAmount` over invoices in PAID
 *     state. `totalAmount` already INCLUDES VAT for PLATFORM invoices —
 *     the column is the customer-facing amount the gateway captured, so
 *     summing it is correct for revenue reporting. Do NOT switch this to
 *     `subtotal`: that would silently exclude collected VAT and break the
 *     match against the bank statement.
 *   - When the accountant runs the FlowAccount export, the per-row VAT
 *     comes from invoice-service.listAll() which DOES return the canonical
 *     `subtotal / vat / totalAmount` triple per row. This service only
 *     produces the headline totals.
 */

const { prisma } = require('./prisma-database');
const { PAYMENT_FEES } = require('../config/payment-fees');
const { classifyRevenueType } = require('./split-payment-calculator');
const { getInvoiceIssuer } = require('../config/invoice-issuers');
const { getZonedParts, startOfLocalDay } = require('../utils/working-days');

// Canonical "paid invoice" status set. The real terminal paid state in
// production is RECEIPT_ISSUED (a paid invoice becomes PAID_PENDING_RECEIPT then
// RECEIPT_ISSUED once the receipt is generated) — the bare literal 'paid' never
// matches it, so every dashboard aggregate that filtered on `status: 'paid'`
// reported ฿0 revenue (UAT A1). Kept in sync with
// invoice-service.canonicalPaidStatuses() (single-source there; duplicated here
// as a module const to keep accounting-service dependency-free — importing
// invoice-service would pull its heavy PDF/receipt/tenant chain into this
// module and its unit tests).
const CANONICAL_PAID_STATUSES = Object.freeze([
    'paid',
    'PAID',
    'PAID_PENDING_RECEIPT',
    'RECEIPT_ISSUED',
]);

// FlowAccount XLSX/CSV expects this exact column order. Keep stable —
// the accountant's downstream automation maps by column index.
// Reference: FlowAccount "Sales Invoice Import" spreadsheet template.
const FLOWACCOUNT_COLUMNS = Object.freeze([
    'Date',
    'Document No',
    'Customer Name',
    'Customer Tax ID',
    'Description',
    'Subtotal',
    'VAT (7%)',
    'Total',
]);

class AccountingService {
    /**
     * Lightweight summary used for `/api/finance/accounting` (root).
     * Returns invoices (total/paid), quotes (total), and total revenue.
     */
    async getRootSummary(orgId = null) {
        // count/aggregate are NOT auto-scoped by the tenant extension (it hooks
        // findMany/findFirst/count only under the flag, never aggregate) — scope
        // per-call-site. The route refuses a caller with no organization (L3).
        const orgFilter = orgId ? { organizationId: orgId } : {};
        const [invoicesTotal, invoicesPaid, quotesTotal, revenueResult] = await Promise.all([
            prisma.invoice.count({ where: { isDeleted: false, ...orgFilter } }),
            prisma.invoice.count({ where: { status: { in: CANONICAL_PAID_STATUSES }, isDeleted: false, ...orgFilter } }),
            prisma.quote.count({ where: { isDeleted: false, ...orgFilter } }),
            prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: { status: { in: CANONICAL_PAID_STATUSES }, isDeleted: false, ...orgFilter },
            }),
        ]);

        return {
            invoices: { total: invoicesTotal, paid: invoicesPaid },
            quotes: { total: quotesTotal },
            revenue: { total: revenueResult._sum.totalAmount || 0, currency: 'THB' },
        };
    }

    /**
     * Full dashboard stats used for `/api/finance/accounting/dashboard`.
     *
     * Status buckets:
     *   - Quotes pending = pending | draft | sent (matches the legacy UI).
     *   - Quotes accepted = accepted (excludes invoiced — already moved on).
     *   - Invoices pending = pending state.
     *   - Invoices paid = paid state (revenue source).
     *
     * `today` starts at 00:00 in Bangkok (operator 2026-09-26: "today" windows
     * are Bangkok days, whatever the process clock's zone).
     */
    async getDashboardStats(orgId = null) {
        // Per-call-site org scope (count/aggregate not auto-scoped). The route
        // refuses a caller with no organization (L3).
        const orgFilter = orgId ? { organizationId: orgId } : {};
        const today = startOfLocalDay(new Date()); // 00:00 today in Bangkok

        const [
            quotesTotal,
            quotesPending,
            quotesAccepted,
            invoicesTotal,
            invoicesPending,
            invoicesPaid,
            quotesToday,
            invoicesToday,
            revenueResult,
        ] = await Promise.all([
            prisma.quote.count({ where: { isDeleted: false, ...orgFilter } }),
            prisma.quote.count({ where: { status: { in: ['pending', 'draft', 'sent'] }, isDeleted: false, ...orgFilter } }),
            prisma.quote.count({ where: { status: 'accepted', isDeleted: false, ...orgFilter } }),

            prisma.invoice.count({ where: { isDeleted: false, ...orgFilter } }),
            prisma.invoice.count({ where: { status: 'pending', isDeleted: false, ...orgFilter } }),
            prisma.invoice.count({ where: { status: { in: CANONICAL_PAID_STATUSES }, isDeleted: false, ...orgFilter } }),

            prisma.quote.count({ where: { createdAt: { gte: today }, isDeleted: false, ...orgFilter } }),
            prisma.invoice.count({ where: { createdAt: { gte: today }, isDeleted: false, ...orgFilter } }),

            prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: { status: { in: CANONICAL_PAID_STATUSES }, isDeleted: false, ...orgFilter },
            }),
        ]);

        return {
            quotes: {
                total: quotesTotal,
                pending: quotesPending,
                accepted: quotesAccepted,
                today: quotesToday,
            },
            invoices: {
                total: invoicesTotal,
                pending: invoicesPending,
                paid: invoicesPaid,
                today: invoicesToday,
            },
            revenue: {
                total: revenueResult._sum.totalAmount || 0,
                currency: 'THB',
            },
        };
    }

    /**
     * FlowAccount-compatible row preparation.
     *
     * Produces the data SHAPE the accountant pastes into FlowAccount's
     * "Sales Invoice Import" spreadsheet. Actual XLSX file generation is
     * deferred to the next batch (financial-export-service already has
     * the BOM-prefixed UTF-8 CSV path — wiring an XLSX writer is a
     * follow-up — see `accountant FlowAccount export.xlsx` task).
     *
     * Splits each invoice into one row PER FlowAccount document:
     *   - STATE_FEE invoice → one row with Total = stateFee, VAT = 0
     *     (FlowAccount tolerates VAT=0 rows; the accountant tags these
     *     as "non-VAT" on the import wizard)
     *   - PLATFORM_FEE invoice → one row with Subtotal/VAT/Total split
     *
     * @param {object} [filters]
     * @param {Date}   [filters.startDate]
     * @param {Date}   [filters.endDate]
     * @param {string} [filters.organizationId]
     * @returns {Promise<{ columns: string[], rows: object[], summary: object }>}
     */
    async exportFlowAccount({ startDate, endDate, organizationId } = {}) {
        const where = {
            isDeleted: false,
            status: { in: CANONICAL_PAID_STATUSES },
        };
        if (startDate || endDate) {
            where.paidAt = {};
            if (startDate) { where.paidAt.gte = startDate; }
            if (endDate) { where.paidAt.lte = endDate; }
        }
        if (organizationId) { where.organizationId = organizationId; }

        const invoices = await prisma.invoice.findMany({
            where,
            include: {
                applicant: {
                    select: {
                        firstName: true,
                        lastName: true,
                        companyName: true,
                        taxId: true,
                    },
                },
            },
            orderBy: { paidAt: 'asc' },
        });

        const rows = [];
        let totalSubtotal = 0;
        let totalVat = 0;
        let totalGross = 0;

        for (const inv of invoices) {
            const amount = Number(inv.totalAmount || 0);
            const revenueType = classifyRevenueType(inv.serviceType);
            const isPlatform = revenueType === 'PLATFORM';

            // FlowAccount wants the customer's display name; companyName
            // wins for juristic, otherwise firstName + lastName.
            const customerName = inv.applicant?.companyName
                || `${inv.applicant?.firstName || ''} ${inv.applicant?.lastName || ''}`.trim()
                || '-';
            // PDPA — only show the 13-digit tax ID for juristic customers.
            // Individuals' national IDs must never appear on an export
            // destined for an external bookkeeping tool.
            const customerTaxId = (inv.applicant?.taxId
                && /^\d{13}$/.test(String(inv.applicant.taxId)))
                ? inv.applicant.taxId
                : '';

            let subtotal = 0;
            let vat = 0;
            if (isPlatform) {
                // VAT extracted from VAT-inclusive totalAmount
                const rate = PAYMENT_FEES.VAT_RATE;
                vat = Math.round(amount * (rate / (1 + rate)) * 100) / 100;
                subtotal = Math.round((amount - vat) * 100) / 100;
            } else {
                subtotal = amount; // VAT-exempt government revenue
            }

            // Use the canonical issuer name as a row hint so the
            // accountant can verify the row is attributed to the right
            // legal entity on import.
            let issuerHint = '';
            try {
                const issuer = getInvoiceIssuer(inv.serviceType);
                issuerHint = issuer.legalNameTH;
            } catch (_e) { /* unknown serviceType — leave blank */ }

            rows.push({
                Date: inv.paidAt ? getZonedParts(new Date(inv.paidAt)).isoDate : '', // Bangkok day
                'Document No': inv.receiptNumber || inv.invoiceNumber || '',
                'Customer Name': customerName,
                'Customer Tax ID': customerTaxId,
                Description: `${inv.serviceType || ''} — issued by ${issuerHint}`.trim(),
                Subtotal: subtotal,
                'VAT (7%)': vat,
                Total: amount,
            });

            totalSubtotal += subtotal;
            totalVat += vat;
            totalGross += amount;
        }

        return {
            columns: [...FLOWACCOUNT_COLUMNS],
            rows,
            summary: {
                count: rows.length,
                totalSubtotal: Math.round(totalSubtotal * 100) / 100,
                totalVat: Math.round(totalVat * 100) / 100,
                totalGross: Math.round(totalGross * 100) / 100,
                currency: 'THB',
                period: {
                    startDate: startDate ? new Date(startDate).toISOString() : null,
                    endDate: endDate ? new Date(endDate).toISOString() : null,
                },
            },
        };
    }
}

module.exports = new AccountingService();
module.exports.FLOWACCOUNT_COLUMNS = FLOWACCOUNT_COLUMNS;
