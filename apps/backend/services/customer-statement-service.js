/**
 * Customer Statement Service (สรุปยอดลูกค้า) — B20-D, 2026-05-16.
 *
 * Why this exists:
 *   The applicant has a per-phase two-card UI (B18-B) showing whether
 *   each invoice is paid. Finance staff supporting a ticket need a
 *   CONSOLIDATED view of one applicant's whole billing relationship
 *   with the platform — every Application they own, every Quotation
 *   issued (DTAM + PLATFORM), every Invoice (paid / pending / overdue),
 *   and the per-side totals so a phone-call ticket can be resolved
 *   without digging through three separate screens.
 *
 *   This is the finance team's first stop for "ลูกค้าโทรมาถามว่าเขาจ่ายอะไรไปแล้วบ้าง"
 *   — it is read-only and PDPA-masked by default.
 *
 * Two-money-flow split (B16-C, owner-confirmed 2026-05-16):
 *   The platform never holds state-fee cash. So per applicant we
 *   produce two parallel summaries:
 *     - DTAM side    — state fee (กรมบัญชีกลาง bank channel; VAT-exempt
 *                      under ป.รัษฎากร ม.77/1 (10))
 *     - PLATFORM side — service fee + Output VAT 7% (Predictive AI
 *                       commercial channel under ป.รัษฎากร ม.86/4)
 *
 *   Each side has its own (billed / paid / outstanding) ledger. Per
 *   role:
 *     - ACCOUNT_DTAM     sees DTAM side; PLATFORM side blanked (`null`)
 *     - ACCOUNT_PLATFORM sees PLATFORM side; DTAM side blanked
 *     - ADMIN / AUDITOR  see both
 *
 * PDPA discipline (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562):
 *   Even though the requester is a finance staff member with a
 *   legitimate interest, we still mask applicant PII at the service
 *   boundary unless the caller explicitly opts in:
 *     - firstName/lastName  → keep first 3 chars + ***
 *     - phoneNumber         → keep last 4 digits
 *     - healthId            → return ONLY masked form (first 4 + last 2)
 *                             — full 13-digit Thai ID is never shipped
 *     - email               → keep first char + *** + @ + domain
 *   Mirrors the canonical masking helpers already in pdpa-service.js
 *   but keeps this service standalone so a unit test can verify the
 *   mask without spinning up the full PDPA module.
 *
 * Boundary discipline:
 *   - READ-ONLY. No writes anywhere.
 *   - Uses `findUserByHealthIdSecurely` (B9 canonical hash-first
 *     lookup) so this service survives PDPA Phase 2 column
 *     encryption.
 *   - Org-scoped — callers must pass `organizationId` so a
 *     provider can never look up an applicant from a different
 *     tenant.
 *   - Does NOT touch JournalEntry / JournalLine — the statement
 *     is built from the customer-facing tables (Quotation /
 *     Invoice), not the GL. The GL is the accountant's view; this
 *     is the applicant's view.
 *
 * Source-of-truth column meanings (B16-A schema):
 *   - Invoice.serviceType  ending in `_STATE_FEE`    → DTAM
 *   - Invoice.serviceType  ending in `_PLATFORM_FEE` → PLATFORM
 *   - Invoice.status = 'paid'/'PAID' / paidAt set    → recognised
 *     (Stripe settlement marks the invoice PAID via the webhook)
 *
 * @module services/customer-statement-service
 */

'use strict';

const { findUserByHealthIdSecurely } = require('./user-lookup-service');
// Bug 6.2 — single canonical money-flow side classifier (STATE ↔ DTAM here).
const { classifyInvoiceSide, INVOICE_SIDES } = require('./finance/invoice-side');

// Prisma is resolved lazily so the prisma-database mock used by the
// unit tests flows through correctly — same pattern as
// quotation-service.js and trial-balance-service.js.
let _prismaModule;
// Lazy: holder-access loads farm-access and the permission engine, which the
// staff report paths never need. A health statement passes its holder scope.
function holderScoped(scope, model) {
    return require('./holder-access').holderReadWhereIfScoped(scope, model);
}

function _resolvePrisma() {
    if (!_prismaModule) {
        try {
            _prismaModule = require('./prisma-database');
        } catch (_e) {
            _prismaModule = { prisma: null };
        }
    }
    return _prismaModule.prisma;
}

const BOOK_SIDES = Object.freeze({
    DTAM: 'DTAM',
    PLATFORM: 'PLATFORM',
});

const PAID_STATUSES = new Set([
    'paid',
    'PAID',
    'PAID_PENDING_RECEIPT',
    'RECEIPT_ISSUED',
]);

const PENDING_STATUSES = new Set([
    'pending',
    'PENDING',
    'overdue',
    'OVERDUE',
]);

// ── Classification helpers ───────────────────────────────────────────

/**
 * Map an invoice's serviceType (or a quotation's issuerType) to the
 * canonical book-side label. Delegates to the shared classifyInvoiceSide
 * (Bug 6.2) so the customer statement never disagrees with the
 * split-payment ledger — in particular the legacy APPLICATION_FEE/AUDIT_FEE
 * now classify to DTAM (STATE) here too, not PLATFORM.
 */
function classifyServiceType(serviceType) {
    return classifyInvoiceSide(serviceType) === INVOICE_SIDES.STATE
        ? BOOK_SIDES.DTAM
        : BOOK_SIDES.PLATFORM;
}

function isPaid(invoice) {
    if (!invoice) { return false; }
    if (invoice.paidAt) { return true; }
    return PAID_STATUSES.has(invoice.status);
}

function isPending(invoice) {
    if (!invoice) { return false; }
    if (isPaid(invoice)) { return false; }
    return PENDING_STATUSES.has(invoice.status) || invoice.status === 'pending';
}

function toNumber(value) {
    if (value === null || value === undefined) { return 0; }
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function round2(n) {
    return Math.round(toNumber(n) * 100) / 100;
}

// ── PDPA masking helpers ──────────────────────────────────────────────

/**
 * Mask a Thai-style name: keep first 3 chars (graphemes assumed 1:1
 * with characters for Thai script — acceptable since we only need
 * recognisability, not perfect grapheme handling). Empty input → null.
 */
function maskName(name) {
    if (!name) { return null; }
    const trimmed = String(name).trim();
    if (!trimmed) { return null; }
    if (trimmed.length <= 3) { return `${trimmed}***`; }
    return `${trimmed.slice(0, 3)}***`;
}

/**
 * Mask a phone number: keep last 4 digits.
 *   '0812345678' → '******5678'
 */
function maskPhone(phone) {
    if (!phone) { return null; }
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length <= 4) { return digits ? `****${digits}` : null; }
    return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/**
 * Mask a Thai national ID (healthId): keep first 4 + last 2 digits.
 *   '1234567890123' → '1234*******23'
 * The full 13-digit ID is NEVER returned by this service — PDPA
 * ม.6 + ม.27 data-minimisation. Even ADMIN sees only the masked
 * form; un-masking belongs to a separate identity-service call
 * with its own audit-log path.
 */
function maskHealthId(healthId) {
    if (!healthId) { return null; }
    const digits = String(healthId).replace(/\D/g, '');
    if (digits.length < 6) { return '*'.repeat(digits.length); }
    if (digits.length !== 13) {
        // Non-13-digit input (foreign passport, legacy ID) — still
        // mask conservatively: keep first 4 + last 2.
        const headLen = Math.min(4, Math.max(0, digits.length - 2));
        return digits.slice(0, headLen)
            + '*'.repeat(digits.length - headLen - 2)
            + digits.slice(-2);
    }
    return `${digits.slice(0, 4)}*******${digits.slice(-2)}`;
}

function maskEmail(email) {
    if (!email) { return null; }
    const str = String(email).trim();
    const at = str.indexOf('@');
    if (at < 1) { return '***'; }
    return `${str.charAt(0)}***${str.slice(at)}`;
}

function buildMaskedApplicant(user) {
    if (!user) { return null; }
    return {
        // Stable opaque identifier — the user UUID is internal-only
        // and not PII, so we keep it for joins on the consumer side.
        id: user.id || null,
        name: maskName(
            [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
        ),
        healthIdMasked: maskHealthId(user.healthId || null),
        phoneNumberMasked: maskPhone(user.phoneNumber || null),
        emailMasked: maskEmail(user.email || null),
    };
}

// ── Internal aggregation helpers ──────────────────────────────────────

function freshSideSummary() {
    return { billed: 0, paid: 0, outstanding: 0, invoiceCount: 0 };
}

function accumulateInvoice(sideSummary, invoice) {
    const total = round2(invoice.totalAmount);
    sideSummary.billed = round2(sideSummary.billed + total);
    sideSummary.invoiceCount += 1;
    if (isPaid(invoice)) {
        sideSummary.paid = round2(sideSummary.paid + total);
    } else if (isPending(invoice)) {
        sideSummary.outstanding = round2(sideSummary.outstanding + total);
    }
}

function shapeQuotation(q) {
    if (!q) { return null; }
    return {
        id: q.id,
        quotationNumber: q.quotationNumber || q.quoteNumber || null,
        issuerType: q.issuerType || classifyServiceType(q.serviceType),
        status: q.status || null,
        totalAmount: round2(q.totalAmount),
        subtotal: round2(q.subtotal),
        vat: round2(q.vat),
        issueDate: q.issueDate || q.createdAt || null,
        validUntil: q.validUntil || null,
        acceptedAt: q.acceptedAt || null,
    };
}

function shapeInvoice(invoice) {
    return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: invoice.receiptNumber || null,
        serviceType: invoice.serviceType,
        bookSide: classifyServiceType(invoice.serviceType),
        status: invoice.status,
        isPaid: isPaid(invoice),
        totalAmount: round2(invoice.totalAmount),
        subtotal: round2(invoice.subtotal),
        vat: round2(invoice.vat),
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt || null,
        paymentMethod: invoice.paymentMethod || null,
    };
}

function applyRoleSideFilter(summary, viewerSides) {
    if (!viewerSides) { return summary; }
    const allowed = new Set(viewerSides);
    return {
        dtamSide: allowed.has(BOOK_SIDES.DTAM) ? summary.dtamSide : null,
        platformSide: allowed.has(BOOK_SIDES.PLATFORM) ? summary.platformSide : null,
    };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Generate a consolidated billing statement for one applicant.
 *
 * @param {object} args
 * @param {string} args.applicantHealthId        — 13-digit Thai ID
 * @param {Date|string} [args.asOfDate]          — defaults to now
 * @param {string} args.organizationId           — REQUIRED tenant scope
 * @param {Array<'DTAM'|'PLATFORM'>} [args.viewerSides]
 * @param {object} [args.applicationWhere]         — a health caller's Application where
 *        (holder fragment, spec 2026-09-30 §3.1), used in place of the healthId filter
 *        — Restrict the returned summary + per-application side
 *          breakdown. ACCOUNT_DTAM passes ['DTAM']; ACCOUNT_PLATFORM
 *          passes ['PLATFORM']; ADMIN/AUDITOR pass null (no filter).
 * @param {object} [args.prisma]                  — inject for tests
 * @returns {Promise<object>}
 */
async function generateCustomerStatement(args = {}) {
    const {
        applicantHealthId,
        asOfDate = new Date(),
        organizationId,
        viewerSides = null,
        applicationWhere = null,
        holderScope = null,
        prisma: prismaArg = null,
    } = args;

    if (!applicantHealthId) {
        const err = new Error('generateCustomerStatement: applicantHealthId required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!organizationId) {
        const err = new Error('generateCustomerStatement: organizationId required (tenant scope)');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }

    const prisma = prismaArg || _resolvePrisma();
    const asOf = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);

    // 1) Resolve applicant via the canonical hash-first lookup. The
    //    select pulls the small set of PII columns we need for the
    //    masked applicant block — no formData, no extra joins.
    const applicantUser = await findUserByHealthIdSecurely(applicantHealthId, {
        client: prisma,
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            healthId: true,
            phoneNumber: true,
        },
    });
    if (!applicantUser) {
        return {
            applicant: null,
            asOfDate: asOf,
            organizationId,
            summary: applyRoleSideFilter({
                dtamSide: freshSideSummary(),
                platformSide: freshSideSummary(),
            }, viewerSides),
            applications: [],
            notFound: true,
        };
    }

    // 2) Pull every Application this applicant owns within the tenant.
    //    Org-scope is enforced here — if a malicious caller spoofed
    //    healthId, they would still only see applications inside their
    //    own tenant.
    //    A health caller's statement passes its holder-scoped where
    //    instead (spec 2026-09-30 §3.1); staff reports keep the healthId filter.
    const applications = await prisma.application.findMany({
        where: {
            ...(applicationWhere || { healthId: applicantHealthId }),
            organizationId,
            isDeleted: false,
        },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            applicationNumber: true,
            status: true,
            createdAt: true,
            phase1Status: true,
            phase2Status: true,
            phase1PaidAt: true,
            phase2PaidAt: true,
        },
    });

    const applicationIds = applications.map((a) => a.id);

    // 3) Pull Quotations / Invoices for the set of applications. Each
    //    query is org-scoped via the application join so the result set
    //    cannot leak cross-tenant.
    const [quotations, invoices] = applicationIds.length === 0
        ? [[], []]
        : await Promise.all([
            // Quotation model is optional in some schema states —
            // fall back to empty array if the delegate is unavailable.
            (async () => {
                if (!prisma.quotation || typeof prisma.quotation.findMany !== 'function') {
                    return [];
                }
                return prisma.quotation.findMany({
                    where: {
                        applicationId: { in: applicationIds },
                        isDeleted: false,
                        ...holderScoped(holderScope, 'Quotation'),
                    },
                    orderBy: { createdAt: 'asc' },
                });
            })(),
            prisma.invoice.findMany({
                where: {
                    applicationId: { in: applicationIds },
                    isDeleted: false,
                    // asOfDate filter: only invoices created on/before
                    // the report cutoff. Stops a statement from
                    // pulling in a future-dated invoice issued after
                    // the asOf timestamp.
                    createdAt: { lte: asOf },
                    ...holderScoped(holderScope, 'Invoice'),
                },
                orderBy: { createdAt: 'asc' },
            }),
        ]);

    // 4) Build per-application + summary aggregates.
    const summary = {
        dtamSide: freshSideSummary(),
        platformSide: freshSideSummary(),
    };

    const applicationBlocks = applications.map((app) => {
        const appQuotations = quotations.filter((q) => q.applicationId === app.id);
        const appInvoices = invoices.filter((i) => i.applicationId === app.id);

        const perApp = {
            dtamSide: freshSideSummary(),
            platformSide: freshSideSummary(),
        };

        const shapedInvoices = [];
        for (const inv of appInvoices) {
            const side = classifyServiceType(inv.serviceType);
            const sideSummary = side === BOOK_SIDES.DTAM
                ? perApp.dtamSide
                : perApp.platformSide;
            accumulateInvoice(sideSummary, inv);
            // Mirror into the rollup summary.
            const rollupSide = side === BOOK_SIDES.DTAM
                ? summary.dtamSide
                : summary.platformSide;
            accumulateInvoice(rollupSide, inv);
            shapedInvoices.push(shapeInvoice(inv));
        }

        return {
            id: app.id,
            applicationNumber: app.applicationNumber,
            status: app.status,
            createdAt: app.createdAt,
            phase1Status: app.phase1Status || null,
            phase2Status: app.phase2Status || null,
            phase1PaidAt: app.phase1PaidAt || null,
            phase2PaidAt: app.phase2PaidAt || null,
            quotations: appQuotations.map(shapeQuotation),
            invoices: shapedInvoices,
            summary: applyRoleSideFilter(perApp, viewerSides),
        };
    });

    return {
        applicant: buildMaskedApplicant(applicantUser),
        asOfDate: asOf,
        organizationId,
        summary: applyRoleSideFilter(summary, viewerSides),
        applications: applicationBlocks,
    };
}

/**
 * Single-application statement (applicant-facing). Used by the
 * `/api/applications/:applicationId/statement` endpoint where a
 * HEALTH user views their own statement for ONE application —
 * the org-scoped ownership check happens at the route layer.
 *
 * @param {object} args
 * @param {string} args.applicationId
 * @param {Date|string} [args.asOfDate]
 * @param {string} args.organizationId
 * @param {object} [args.applicationWhere] — the caller's holder fragment
 *        (holderReadWhere(scope, 'Application'), spec 2026-09-30 §3.1), spread unaltered
 * @param {object} [args.prisma]
 * @returns {Promise<object>}
 */
async function generateApplicationStatement(args = {}) {
    const {
        applicationId,
        asOfDate = new Date(),
        organizationId,
        applicationWhere = null,
        holderScope = null,
        prisma: prismaArg = null,
    } = args;
    if (!applicationId) {
        const err = new Error('generateApplicationStatement: applicationId required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!organizationId) {
        const err = new Error('generateApplicationStatement: organizationId required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    const prisma = prismaArg || _resolvePrisma();

    const application = await prisma.application.findFirst({
        where: { id: applicationId, organizationId, ...(applicationWhere || {}), isDeleted: false },
        select: { id: true, healthId: true },
    });
    if (!application) {
        const err = new Error('Application not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    // Delegate to the full statement builder but restrict to one
    // application post-hoc — simpler than maintaining a parallel
    // query path for the single-app case.
    const statement = await generateCustomerStatement({
        applicantHealthId: application.healthId,
        asOfDate,
        organizationId,
        viewerSides: null, // Applicant sees both sides for their own statement
        applicationWhere: applicationWhere ? { id: applicationId, ...applicationWhere } : null,
        holderScope,
        prisma,
    });
    statement.applications = statement.applications.filter(
        (a) => a.id === applicationId,
    );
    // Recompute the summary from the filtered set so the totals
    // match what the applicant actually sees.
    const refreshed = {
        dtamSide: freshSideSummary(),
        platformSide: freshSideSummary(),
    };
    for (const app of statement.applications) {
        for (const inv of app.invoices) {
            const side = inv.bookSide;
            const sideSummary = side === BOOK_SIDES.DTAM
                ? refreshed.dtamSide
                : refreshed.platformSide;
            // shapeInvoice already coerced amounts to numbers.
            sideSummary.billed = round2(sideSummary.billed + (inv.totalAmount || 0));
            sideSummary.invoiceCount += 1;
            if (inv.isPaid) {
                sideSummary.paid = round2(sideSummary.paid + (inv.totalAmount || 0));
            } else {
                sideSummary.outstanding = round2(sideSummary.outstanding + (inv.totalAmount || 0));
            }
        }
    }
    statement.summary = refreshed;
    return statement;
}

module.exports = {
    generateCustomerStatement,
    generateApplicationStatement,
    BOOK_SIDES,
    // Exposed for unit tests + the AR aging service which reuses
    // the same classification + masking rules.
    _internals: {
        classifyServiceType,
        isPaid,
        isPending,
        maskName,
        maskPhone,
        maskHealthId,
        maskEmail,
        buildMaskedApplicant,
        round2,
    },
};
