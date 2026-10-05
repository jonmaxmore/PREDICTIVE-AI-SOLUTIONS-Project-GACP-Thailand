/**
 * Quote Service — canonical home for `Quote` model access.
 *
 * Created for tech-debt batch 11 (Finance cluster) to retire direct
 * `prisma.quote.*` calls from `routes/api/finance/quotes.js` and
 * `routes/api/helpers/quotes-provider-routes.js`.
 *
 * Row-level invariants centralised here so route bugs cannot widen access:
 *   - `isDeleted: false` on every read.
 *   - Ownership scoping via `application.healthId` for applicant-facing reads.
 *   - PDPA: legacy `?healthId=` URL parameter is rejected at the route layer;
 *     this service only accepts already-resolved health identifiers.
 *
 * Tax-Invoice canonical totals (Tier 8/9 — DO NOT regress):
 *   - Subtotal / vat / totalAmount are PASSED THROUGH from the input to the
 *     Quote row, and then PASSED THROUGH to the Invoice row at acceptance.
 *   - GACP certification is currently VAT-exempt (Thai Revenue Department
 *     ม.86 — certification service falls under the exempt list), so `vat = 0`
 *     for these quotes. Service fees (PLATFORM invoices) are NOT created via
 *     this path — they come from payment-service-phase-flow.js which already
 *     uses fee-service.buildPhaseFee().phaseTotal.
 *   - The shape `{ subtotal, vat, totalAmount }` MUST appear unchanged on
 *     the returned Quote and on any Invoice this service creates from it.
 */

const { prisma } = require('./prisma-database');
const { BILLING_APPLICATION_SELECT } = require('./finance/billing-select');
const crypto = require('crypto');
const { getZonedParts } = require('../utils/working-days');

const QUOTE_STATUS = Object.freeze({
    DRAFT: 'draft',
    SENT: 'sent',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    EXPIRED: 'expired',
    INVOICED: 'invoiced',
    PENDING: 'pending',
});

const QUOTE_VALID_STATUSES = Object.freeze([
    QUOTE_STATUS.DRAFT,
    QUOTE_STATUS.SENT,
    QUOTE_STATUS.ACCEPTED,
    QUOTE_STATUS.REJECTED,
    QUOTE_STATUS.EXPIRED,
    QUOTE_STATUS.INVOICED,
    QUOTE_STATUS.PENDING,
]);

const APPLICANT_SELECT = Object.freeze({
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    companyName: true,
});

/**
 * Application columns a quote response may carry: the billing set (S1 /
 * F-SCOPE-01 — services/finance/billing-select.js) plus the narrow applicant.
 * `include: { applicant }` on application returned EVERY Application scalar —
 * formData with decrypted national / tax IDs, workflowHistory, auditNotes.
 */
const QUOTE_APPLICATION_SELECT = Object.freeze({
    select: Object.freeze({
        ...BILLING_APPLICATION_SELECT.select,
        applicant: Object.freeze({ select: APPLICANT_SELECT }),
    }),
});


class QuoteService {
    get STATUS() {
        return QUOTE_STATUS;
    }

    get VALID_STATUSES() {
        return QUOTE_VALID_STATUSES;
    }

    /**
     * Resolve a User UUID to its healthId. Returns null when the UUID does
     * not map to a live user — callers must short-circuit on null to avoid
     * running a broad findMany that could leak rows.
     */
    async resolveApplicantHealthId(applicantId) {
        if (!applicantId) {
            return null;
        }
        const row = await prisma.user.findFirst({
            where: { id: String(applicantId), isDeleted: false },
            select: { healthId: true },
        });
        return row?.healthId || null;
    }

    /**
     * Provider-facing paginated list with applicant display columns. The
     * legacy route called `findMany` twice (once light, once with applicant
     * include); we collapse to a single query with the include and a count.
     */
    async listForProvider({ status, applicantHealthId, page = 1, limit = 20 } = {}) {
        const where = { isDeleted: false };
        if (status) {
            where.status = status;
        }
        if (applicantHealthId) {
            where.application = { healthId: applicantHealthId };
        }

        const p = parseInt(page, 10) || 1;
        const l = parseInt(limit, 10) || 20;
        const skip = (p - 1) * l;

        const [rows, total] = await Promise.all([
            prisma.quote.findMany({
                where,
                include: { application: QUOTE_APPLICATION_SELECT },
                orderBy: { createdAt: 'desc' },
                skip,
                take: l,
            }),
            prisma.quote.count({ where }),
        ]);

        const data = rows.map((row) => ({
            ...row,
            Applicant: row.application?.applicant || null,
        }));

        return {
            data,
            pagination: {
                page: p,
                limit: l,
                total,
                pages: Math.ceil(total / l),
            },
        };
    }

    /**
     * Applicant-facing list within the caller's holder scope (spec 2026-09-30
     * §3.1). R1 (operator ruling C1): the pre-R1 filer pin
     * `{ application: { healthId } }` decides (OR-registered beside the fragment,
     * and AND), exactly the pre-R1 rows. No scope fails closed (no query).
     */
    async listForApplicant(healthId, { status, holderScope } = {}) {
        if (!healthId || !holderScope || !Array.isArray(holderScope.readIds)) {
            return [];
        }
        const { r1HolderOrLegacy, r1LegacyApplicantPin } = require('./holder-access');
        const where = {
            // R1-legacy-pin: removed in Task 12 (→ holderReadWhere); the pre-R1 pin decides
            ...r1HolderOrLegacy(holderScope, 'Quote', { application: { healthId } }),
            ...r1LegacyApplicantPin({ application: { healthId } }),
            isDeleted: false,
        };
        if (status) {
            where.status = status;
        }
        return prisma.quote.findMany({
            where,
            include: {
                application: {
                    select: { applicationNumber: true, serviceType: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Fetch a quote by id with the application + applicant joined in.
     */
    async findByIdWithApplication(id) {
        return prisma.quote.findUnique({
            where: { id },
            // APPLICANT_SELECT, never `applicant: true`: an unbounded include
            // returns every User column — bcrypt hash, TOTP secret, reset token.
            include: { application: QUOTE_APPLICATION_SELECT },
        });
    }

    /**
     * Lighter-weight variant — used where we just need quote + application
     * (e.g. ownership check, status transition, notification dispatch).
     */
    async findByIdWithApplicationSlim(id, { holderScope = null } = {}) {
        return prisma.quote.findUnique({
            where: {
                id,
                // R1-legacy-pin: removed in Task 12 — the applicant accept/reject doors pass
                // their holder scope; the quote id decides the row, and the door's healthId
                // check after it decides ownership, as pre-R1.
                ...require('./holder-access').r1HolderOrLegacyWhenScoped(holderScope, 'Quote', { id }),
            },
            // Internal callers need only these (ownership, status, invoice minting).
            include: {
                application: {
                    select: { id: true, healthId: true, serviceType: true, organizationId: true, status: true },
                },
            },
        });
    }

    /**
     * Find application by ID with applicant — moved off direct prisma in the
     * quote-create route. Returns null when missing; callers send 404.
     */
    async findApplicationForQuote(applicationId) {
        return prisma.application.findUnique({
            where: { id: applicationId },
            include: { applicant: { select: APPLICANT_SELECT } },
        });
    }

    /**
     * Generate the next quote number (date prefix + 0-padded sequence).
     */
    async generateQuoteNumber() {
        const dateStr = getZonedParts(new Date()).isoDate.replace(/-/g, ''); // Bangkok day
        const count = await prisma.quote.count();
        return `QT-${dateStr}${(count + 1).toString().padStart(4, '0')}`;
    }

    /**
     * Create a new quote.
     *
     * Tax-Invoice canonical totals: caller MUST pass `subtotal`, `vat`,
     * `totalAmount` already computed (the route validates the math). This
     * service does not silently recompute — that would let bugs in either
     * side slip through. Persist the exact triple the caller supplied.
     */
    async createQuote({
        applicationId,
        items,
        subtotal,
        vat,
        totalAmount,
        validUntil,
        notes,
        quoteNumber,
        status = QUOTE_STATUS.DRAFT,
    }) {
        return prisma.quote.create({
            data: {
                quoteNumber,
                applicationId,
                items,
                subtotal,
                vat,
                totalAmount,
                validUntil,
                notes,
                status,
            },
        });
    }

    /**
     * Generic status update with optional auxiliary columns
     * (acceptedAt / rejectedAt / notes / applicantNotes / invoiceId).
     */
    async updateQuote(id, data) {
        return prisma.quote.update({
            where: { id },
            data,
            // APPLICANT_SELECT, never `applicant: true`. This route echoes the
            // result back to the caller, and an unbounded include would hand a
            // finance staffer the applicant's bcrypt hash and TOTP secret.
            include: { application: QUOTE_APPLICATION_SELECT },
        });
    }

    /**
     * Status-only update without include. Used by /send and the expiry
     * auto-update path where the caller doesn't need the full include.
     */
    async updateStatus(id, status, extraData = {}) {
        return prisma.quote.update({
            where: { id },
            data: { status, ...extraData },
        });
    }

    /**
     * Mark a quote as accepted + linked to a freshly-created invoice.
     */
    async markAcceptedWithInvoice(id, _invoiceId) {
        // Quote has NO `invoiceId` scalar — the linkage is the reverse relation
        // Invoice.quoteId, already set when the invoice was created. Setting
        // `invoiceId` here threw PrismaClientValidationError → accept-quote 500
        // (leaving an orphaned invoice). The invoiceId param is retained for the
        // caller's signature but not written.
        return prisma.quote.update({
            where: { id },
            data: {
                status: QUOTE_STATUS.INVOICED,
                acceptedAt: new Date(),
            },
        });
    }

    /**
     * Mark a quote as rejected with applicant notes.
     */
    async markRejected(id, applicantNotes) {
        return prisma.quote.update({
            where: { id },
            data: {
                status: QUOTE_STATUS.REJECTED,
                rejectedAt: new Date(),
                // Quote's column is `notes` (not `ApplicantNotes`, which exists
                // only on the separate Quotation model) → reject-quote 500.
                notes: applicantNotes,
            },
        });
    }

    /**
     * Create an invoice from an accepted/sent quote.
     *
     * Tax-Invoice canonical totals (Tier 8/9 — anti-regression):
     *   - Subtotal / vat / totalAmount are copied VERBATIM from the source
     *     quote. We never recompute here; if the quote was wrong the fix is
     *     to fix the quote, not to silently rebuild the math at this stage.
     *   - Returns the full invoice row including the `totalAmount` column.
     *     This matches the route's previous response shape (the finance UI
     *     and the FlowAccount XLSX export depend on the exact field names).
     */
    async createInvoiceFromQuote({
        quote,
        invoiceNumber,
        healthId,
        serviceType,
        includeLineItems = true,
    }) {
        const data = {
            invoiceNumber,
            applicationId: quote.applicationId,
            healthId,
            quoteId: quote.id,
            serviceType: serviceType || quote.application?.serviceType || 'certification',
            items: quote.items,
            subtotal: quote.subtotal,
            vat: quote.vat,
            totalAmount: quote.totalAmount,
            status: 'pending',
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };

        // hardening (quote-accept fix): create the Invoice WITHOUT a nested
        // `lineItems: { create }`. The child InvoiceLineItem rows are a
        // TENANT_SCOPED model (required organizationId), but the
        // tenant-prisma-extension injects organizationId ONLY into the TOP-LEVEL
        // create args — it does not recurse into nested children. So a nested
        // lineItems write threw `Argument \`organization\` is missing` (verified
        // on staging WITH tenant context — not a context artifact), which made
        // the applicant /quotes/:id/accept gate 500 (and the provider
        // quote→invoice path too). Per the ADR-014 pattern (the project rules): write the
        // parent with scalar FKs (org auto-injected on the route), then write the
        // children as SEPARATE top-level creates so each is org-injected — and
        // pass organizationId explicitly too, for context-less callers.
        const invoice = await prisma.invoice.create({ data });

        if (includeLineItems && Array.isArray(quote.items) && quote.items.length > 0) {
            const orgId = invoice.organizationId
                || quote.organizationId
                || quote.application?.organizationId
                || null;
            // One insert for all lines. The tenant extension maps
            // organizationId over createMany row arrays the same way it does
            // for create, so org injection is preserved for context-ful
            // callers; the explicit orgId still covers context-less ones.
            await prisma.invoiceLineItem.createMany({
                data: quote.items.map((item, idx) => ({
                    invoiceId: invoice.id,
                    ...(orgId ? { organizationId: orgId } : {}),
                    lineNumber: idx + 1,
                    code: item.code || `ITEM_${idx + 1}`,
                    description: item.description || item.label || '',
                    quantity: Number(item.quantity) || 1,
                    unitPrice: Number(item.unitPrice) || 0,
                    amount: Number(item.amount) || (Number(item.quantity || 1) * Number(item.unitPrice || 0)),
                    phase: item.phase || null,
                    isTaxable: Boolean(item.isTaxable),
                })),
            });
        }

        return invoice;
    }

    /**
     * Generate the next invoice number for the manual quote→invoice path.
     */
    async generateInvoiceNumberSequential() {
        const dateStr = getZonedParts(new Date()).isoDate.replace(/-/g, ''); // Bangkok day
        const count = await prisma.invoice.count();
        return `INV-${dateStr}${(count + 1).toString().padStart(4, '0')}`;
    }

    /**
     * Generate a random-suffix invoice number for the applicant-accept path.
     * (Random suffix avoids collisions on concurrent accepts.)
     */
    generateInvoiceNumberRandom() {
        const dateStr = getZonedParts(new Date()).isoDate.replace(/-/g, ''); // Bangkok day
        const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
        return `INV-${dateStr}-${randomSuffix}`;
    }

    /**
     * Look up a quote by quoteNumber — used for document-number uniqueness
     * check before renaming.
     */
    async findQuoteByNumber(quoteNumber) {
        return prisma.quote.findUnique({ where: { quoteNumber } });
    }

    /**
     * Look up an invoice by invoiceNumber — used for document-number
     * uniqueness check before renaming.
     */
    async findInvoiceByNumber(invoiceNumber) {
        return prisma.invoice.findUnique({ where: { invoiceNumber } });
    }

    /**
     * Update the quoteNumber on an existing quote (accountant rename).
     */
    async updateQuoteNumber(id, newNumber) {
        return prisma.quote.update({
            where: { id },
            data: { quoteNumber: newNumber },
        });
    }

    /**
     * Update the invoiceNumber on an existing invoice (accountant rename).
     */
    async updateInvoiceNumber(id, newNumber) {
        return prisma.invoice.update({
            where: { id },
            data: { invoiceNumber: newNumber },
        });
    }
}

module.exports = new QuoteService();
module.exports.QUOTE_STATUS = QUOTE_STATUS;
module.exports.QUOTE_VALID_STATUSES = QUOTE_VALID_STATUSES;
