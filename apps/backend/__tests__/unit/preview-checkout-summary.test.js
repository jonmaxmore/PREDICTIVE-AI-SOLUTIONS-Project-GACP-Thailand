'use strict';

/**
 * F-G4-51 — the applicant's pre-submission preview must show the phase-1
 * payment state of the ONE-invoice checkout rail, not the retired per-side
 * quote/invoice pair.
 *
 * Under F-G4-35 the PHASE_1_STATE_FEE / PHASE_1_PLATFORM_FEE pair is retired,
 * so readPhase1FinancialDocuments answers all-null and the preview page's four
 * legacy slots read '-' / 'PENDING' forever. What the applicant actually paid
 * is the CERTIFICATION_CHECKOUT_M1 invoice minted by
 * services/checkout/stripe-checkout-service.js. summarizeCheckoutInvoices is
 * the read-only lens over the invoice rows the preview route already loads.
 *
 * The serviceType is NOT re-typed here as a fresh literal: both this test and
 * the helper ask the producer (checkoutInvoiceServiceType) so the reader can
 * never drift from the minter.
 *
 * No env-driven predicate is on this path: isPhaseSplitInvoicingRetired (the
 * only isStripeCheckoutEnabled reader in phase-billing-service.js:211) governs
 * the WRITER, and the route-level test below mocks the writer out entirely.
 */

const mockPrisma = {
    invoice: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
    },
    quote: {
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
    },
    application: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
    },
};

jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const {
    summarizeCheckoutInvoices,
    derivePhasePaymentState,
} = require('../../routes/api/preview/preview-financial-utils');
const { checkoutInvoiceServiceType } = require('../../services/checkout/stripe-checkout-service');
const { MILESTONES } = require('../../shared/checkout-status');

const M1 = checkoutInvoiceServiceType(MILESTONES[0]);
const M2 = checkoutInvoiceServiceType(MILESTONES[1]);

function invoiceRow(overrides = {}) {
    return {
        id: 'inv-1',
        invoiceNumber: 'INV-CO-59E32623-M1',
        serviceType: M1,
        status: 'pending',
        totalAmount: 17655,
        paidAt: null,
        receiptIssuedAt: null,
        receiptNumber: null,
        createdAt: new Date('2026-08-26T03:00:00.000Z'),
        ...overrides,
    };
}

describe('checkoutInvoiceServiceType — one source for the checkout invoice serviceType', () => {
    it('is the wire value the checkout rail mints and settlement reads', () => {
        expect(M1).toBe('CERTIFICATION_CHECKOUT_M1');
        expect(M2).toBe('CERTIFICATION_CHECKOUT_M2');
    });
});

describe('summarizeCheckoutInvoices (F-G4-51)', () => {
    it('(a) reports a paid M1 checkout invoice with its receipt', () => {
        const rows = [invoiceRow({
            status: 'RECEIPT_ISSUED',
            paidAt: new Date('2026-08-27T04:27:41.396Z'),
            receiptIssuedAt: new Date('2026-08-27T04:27:41.396Z'),
            receiptNumber: 'TAX-PRD-2026-000005',
        })];

        const summary = summarizeCheckoutInvoices(rows);

        expect(summary.phase1).toMatchObject({
            invoiceNumber: 'INV-CO-59E32623-M1',
            status: 'RECEIPT_ISSUED',
            isPaid: true,
            receiptNumber: 'TAX-PRD-2026-000005',
            totalAmount: 17655,
        });
        expect(summary.phase1.paidAt).toEqual(new Date('2026-08-27T04:27:41.396Z'));
        expect(summary.phase1.receiptIssuedAt).toEqual(new Date('2026-08-27T04:27:41.396Z'));
        expect(summary.phase2).toBeNull();
    });

    it('(a2) an unpaid M1 row is reported, but not as paid', () => {
        const summary = summarizeCheckoutInvoices([invoiceRow()]);

        expect(summary.phase1.isPaid).toBe(false);
        expect(summary.phase1.status).toBe('pending');
        expect(summary.phase1.receiptNumber).toBeNull();
    });

    it('(b) with two M1 rows the LATEST by createdAt wins', () => {
        const rows = [
            invoiceRow({
                id: 'inv-old',
                invoiceNumber: 'INV-CO-OLD00001-M1',
                createdAt: new Date('2026-08-20T03:00:00.000Z'),
                status: 'cancelled',
            }),
            invoiceRow({
                id: 'inv-new',
                invoiceNumber: 'INV-CO-NEW00002-M1',
                createdAt: new Date('2026-08-26T03:00:00.000Z'),
                status: 'PAID',
                paidAt: new Date('2026-08-26T04:00:00.000Z'),
            }),
        ];

        // Input order must not decide the answer: the same rows reversed
        // answer the same invoice.
        for (const ordered of [rows, [...rows].reverse()]) {
            const summary = summarizeCheckoutInvoices(ordered);
            expect(summary.phase1.invoiceNumber).toBe('INV-CO-NEW00002-M1');
            expect(summary.phase1.isPaid).toBe(true);
        }
    });

    it('(b2) M1 and M2 are reported in their own slots', () => {
        const summary = summarizeCheckoutInvoices([
            invoiceRow(),
            invoiceRow({
                id: 'inv-2',
                invoiceNumber: 'INV-CO-59E32623-M2',
                serviceType: M2,
                status: 'PAID',
                totalAmount: 27675,
                createdAt: new Date('2026-08-27T03:00:00.000Z'),
            }),
        ]);

        expect(summary.phase1.invoiceNumber).toBe('INV-CO-59E32623-M1');
        expect(summary.phase2).toMatchObject({
            invoiceNumber: 'INV-CO-59E32623-M2',
            isPaid: true,
            totalAmount: 27675,
        });
    });

    /**
     * Fix round 1 (B-F5b) — history tie-break.
     *
     * The live invariant is ONE active row per (application, serviceType)
     * (partial unique index uniq_invoice_app_service_active). A milestone can
     * still show more than one row across history: a cancelled attempt plus
     * the row that was actually paid. "Latest createdAt" alone then answers
     * the cancelled one and tells the applicant they have not paid — after
     * their money moved. Paid beats unpaid; createdAt only breaks the
     * remaining tie.
     */
    it('(b3) a PAID row beats a NEWER cancelled row of the same milestone', () => {
        const rows = [
            invoiceRow({
                id: 'inv-paid',
                invoiceNumber: 'INV-CO-PAID0001-M1',
                createdAt: new Date('2026-08-20T03:00:00.000Z'),
                status: 'PAID',
                paidAt: new Date('2026-08-20T04:00:00.000Z'),
                receiptNumber: 'TAX-PRD-2026-000009',
            }),
            invoiceRow({
                id: 'inv-cancelled',
                invoiceNumber: 'INV-CO-CANC0002-M1',
                createdAt: new Date('2026-08-26T03:00:00.000Z'),
                status: 'CANCELLED',
            }),
        ];

        for (const ordered of [rows, [...rows].reverse()]) {
            const summary = summarizeCheckoutInvoices(ordered);
            expect(summary.phase1.invoiceNumber).toBe('INV-CO-PAID0001-M1');
            expect(summary.phase1.isPaid).toBe(true);
            expect(summary.phase1.receiptNumber).toBe('TAX-PRD-2026-000009');
        }
    });

    /**
     * Fix round 1 (B-F5c) — an amount the row does not carry is not zero.
     * `Number(invoice.totalAmount || 0)` printed "฿0" at the applicant for a
     * row whose amount is simply unknown. A missing value is not rendered.
     */
    it('(b4) a row with no amount reports totalAmount null, never a fabricated 0', () => {
        expect(summarizeCheckoutInvoices([invoiceRow({ totalAmount: null })]).phase1.totalAmount).toBeNull();
        expect(summarizeCheckoutInvoices([invoiceRow({ totalAmount: undefined })]).phase1.totalAmount).toBeNull();
        expect(summarizeCheckoutInvoices([invoiceRow({ totalAmount: 'not-a-number' })]).phase1.totalAmount).toBeNull();
        // A real zero-baht row is still zero — only ABSENCE becomes null.
        expect(summarizeCheckoutInvoices([invoiceRow({ totalAmount: 0 })]).phase1.totalAmount).toBe(0);
    });

    it('(c) the retired per-side rows are not checkout invoices', () => {
        const summary = summarizeCheckoutInvoices([
            invoiceRow({ serviceType: 'PHASE_1_STATE_FEE', invoiceNumber: 'INV-202608260007' }),
            invoiceRow({ id: 'inv-2', serviceType: 'PHASE_1_PLATFORM_FEE', invoiceNumber: 'INV-202608260008' }),
        ]);

        expect(summary.phase1).toBeNull();
        expect(summary.phase2).toBeNull();
    });

    it('(d) no invoices at all: both slots are null, never a fabricated row', () => {
        expect(summarizeCheckoutInvoices([])).toEqual({ phase1: null, phase2: null });
        expect(summarizeCheckoutInvoices(null)).toEqual({ phase1: null, phase2: null });
        expect(summarizeCheckoutInvoices(undefined)).toEqual({ phase1: null, phase2: null });
    });
});

/**
 * Fix round 1 (B-F1) — phase truth under the checkout rail.
 *
 * computePhaseSettlement only sees the retired PHASE_x split service types, so
 * on a checkout-rail application it answers phasePaid=false forever: the
 * preview then told an applicant whose M1 money had already settled that their
 * next required action was still PAY_PHASE_1. The two rails answer the same
 * question, so one helper ORs them.
 */
describe('derivePhasePaymentState (B-F1)', () => {
    it('a settled checkout invoice makes the phase paid even when the split settlement says no', () => {
        const state = derivePhasePaymentState({
            settlement: { phasePaid: false, phaseReceiptIssued: false },
            checkout: { isPaid: true, receiptNumber: null },
        });

        expect(state.paid).toBe(true);
        expect(state.receiptIssued).toBe(false);
    });

    it('neither rail paid: not paid, no receipt', () => {
        expect(derivePhasePaymentState({
            settlement: { phasePaid: false, phaseReceiptIssued: false },
            checkout: { isPaid: false, receiptNumber: null },
        })).toEqual({ paid: false, receiptIssued: false });

        // No checkout row at all is the same answer, not a crash.
        expect(derivePhasePaymentState({
            settlement: { phasePaid: false, phaseReceiptIssued: false },
            checkout: null,
        })).toEqual({ paid: false, receiptIssued: false });
    });

    it('the checkout receipt number is a receipt', () => {
        const state = derivePhasePaymentState({
            settlement: { phasePaid: false, phaseReceiptIssued: false },
            checkout: { isPaid: true, receiptNumber: 'TAX-PRD-2026-000005' },
        });

        expect(state).toEqual({ paid: true, receiptIssued: true });
    });

    it('the split rail still answers on its own for a pre-checkout application', () => {
        expect(derivePhasePaymentState({
            settlement: { phasePaid: true, phaseReceiptIssued: true },
            checkout: null,
        })).toEqual({ paid: true, receiptIssued: true });
    });
});

/**
 * Route level — harness mirrored from
 * __tests__/unit/preview-previewable-states.test.js (which does mock
 * prisma.invoice.findMany). The writer half of preview-financial-utils is
 * mocked out; summarizeCheckoutInvoices stays REAL, so this asserts the route
 * actually carries the summary to the applicant's page.
 */
const express = require('express');
const request = require('supertest');

const ROUTE_USER_ID = 'b3b8a4a0-2222-4222-8333-444455556666';

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'b3b8a4a0-2222-4222-8333-444455556666', role: 'HEALTH_USER', canonicalRole: 'health' };
        next();
    },
}));

jest.mock('../../shared/api-response', () => ({
    safeErrorMessage: jest.fn((e) => (e && e.message) || 'error'),
}));

jest.mock('../../services/fee-service', () => ({
    calculateApplicationFees: jest.fn(() => ({
        scopeCount: 1,
        phase1: { total: 17655, serviceFeeAmount: 16500, phaseTotal: 17655 },
        phase2: { total: 27675, serviceFeeAmount: 27500, phaseTotal: 27675 },
        stateTotal: 40000,
        platformTotal: 4000,
        grandTotal: 45330,
    })),
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
    parseJson: jest.fn((value, fallback) => (value == null ? fallback : value)),
    buildFullFormSnapshot: jest.fn(() => ({})),
    normalizeFarmInfo: jest.fn(() => ({})),
    normalizeSelectionInfo: jest.fn(() => ({})),
    normalizeProductionInfo: jest.fn(() => ({})),
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ completedSteps: 7, isComplete: true, missingFields: [] })),
}));

jest.mock('../../routes/api/preview/preview-financial-utils', () => {
    const actual = jest.requireActual('../../routes/api/preview/preview-financial-utils');
    return {
        ...actual,
        readPhase1FinancialDocuments: jest.fn().mockResolvedValue({}),
    };
});

const previewRouter = require('../../routes/api/preview/preview');

describe('GET /applications/:id/preview carries payment.checkout (F-G4-51)', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/preview', previewRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.application.update.mockResolvedValue({});
        mockPrisma.invoice.findMany.mockResolvedValue([]);
        mockPrisma.application.findFirst.mockResolvedValue({
            id: 'app-checkout-1',
            applicantUserId: ROUTE_USER_ID,
            status: 'SUBMITTED',
            isDeleted: false,
            formData: {},
            attachments: null,
            phase1Amount: 17655,
            phase1Status: 'PAID',
            phase2Amount: 27675,
            phase2Status: 'PENDING',
            totalAreaTypes: 1,
            applicant: {
                firstName: 'สมชาย',
                lastName: 'ใจดี',
                phoneNumber: '0812345678',
                email: 'somchai@example.com',
            },
        });
    });

    it('reports the paid M1 checkout invoice under payment.checkout.phase1', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([invoiceRow({
            status: 'RECEIPT_ISSUED',
            paidAt: new Date('2026-08-27T04:27:41.396Z'),
            receiptIssuedAt: new Date('2026-08-27T04:27:41.396Z'),
            receiptNumber: 'TAX-PRD-2026-000005',
        })]);

        const response = await request(app).get('/api/preview/applications/app-checkout-1/preview');

        expect(response.status).toBe(200);
        expect(response.body.preview.payment.checkout.phase1).toMatchObject({
            invoiceNumber: 'INV-CO-59E32623-M1',
            isPaid: true,
            receiptNumber: 'TAX-PRD-2026-000005',
            totalAmount: 17655,
        });
        expect(response.body.preview.payment.checkout.phase2).toBeNull();
    });

    it('reports both slots null when the application has no checkout invoice yet', async () => {
        const response = await request(app).get('/api/preview/applications/app-checkout-1/preview');

        expect(response.status).toBe(200);
        expect(response.body.preview.payment.checkout).toEqual({ phase1: null, phase2: null });
    });

    /**
     * B-F1 — the phase state the page acts on must read the rail the applicant
     * actually paid on. With only a settled M1 checkout invoice on file (no
     * split rows at all), the route used to answer nextRequiredAction
     * 'PAY_PHASE_1' and breakdown.phase1.isPhasePaid false — asking a farmer to
     * pay money they had already paid.
     */
    it('a settled M1 checkout invoice moves the phase past PAY_PHASE_1', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([invoiceRow({
            status: 'RECEIPT_ISSUED',
            paidAt: new Date('2026-08-27T04:27:41.396Z'),
            receiptIssuedAt: new Date('2026-08-27T04:27:41.396Z'),
            receiptNumber: 'TAX-PRD-2026-000005',
        })]);

        const response = await request(app).get('/api/preview/applications/app-checkout-1/preview');

        expect(response.status).toBe(200);
        expect(response.body.preview.nextRequiredAction).toBe('WAIT_DOC_REVIEW');
        expect(response.body.preview.payment.breakdown.phase1.isPhasePaid).toBe(true);
        expect(response.body.preview.payment.breakdown.phase2.isPhasePaid).toBe(false);
    });

    it('an unpaid M1 checkout invoice still asks for phase-1 payment', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([invoiceRow()]);

        const response = await request(app).get('/api/preview/applications/app-checkout-1/preview');

        expect(response.status).toBe(200);
        expect(response.body.preview.nextRequiredAction).toBe('PAY_PHASE_1');
        expect(response.body.preview.payment.breakdown.phase1.isPhasePaid).toBe(false);
    });

    /**
     * B-F1, second half: once M2 has settled, the applicant is waiting for the
     * audit appointment — but only when the receipt actually exists. The
     * receipt half of the truth comes from the same two rails.
     *
     * Fix round 2 (B2-4) — this case was TITLED "with a receipt lands on
     * WAIT_AUDIT_SCHEDULE" while its fixture carried no receipt and it asserted
     * WAIT_RECEIPT_PHASE_2. A title that names the opposite of what the test
     * proves is a false statement about coverage: it reads as if the
     * receipt-issued branch were covered when nothing exercised it. Renamed to
     * what it proves; the case it claimed follows below.
     */
    it('a settled M2 checkout invoice WITHOUT a receipt lands on WAIT_RECEIPT_PHASE_2', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([
            invoiceRow({
                status: 'RECEIPT_ISSUED',
                paidAt: new Date('2026-08-27T04:27:41.396Z'),
                receiptIssuedAt: new Date('2026-08-27T04:27:41.396Z'),
                receiptNumber: 'TAX-PRD-2026-000005',
            }),
            invoiceRow({
                id: 'inv-m2',
                invoiceNumber: 'INV-CO-59E32623-M2',
                serviceType: M2,
                status: 'PAID',
                totalAmount: 27675,
                paidAt: new Date('2026-08-27T05:00:00.000Z'),
                createdAt: new Date('2026-08-27T04:50:00.000Z'),
            }),
        ]);

        const response = await request(app).get('/api/preview/applications/app-checkout-1/preview');

        expect(response.status).toBe(200);
        // Paid, no receipt number yet → still waiting for the receipt.
        expect(response.body.preview.nextRequiredAction).toBe('WAIT_RECEIPT_PHASE_2');
        expect(response.body.preview.payment.breakdown.phase2.isPhasePaid).toBe(true);
    });

    /**
     * Fix round 2 (B2-4) — the case the test above claimed but never ran.
     *
     * WAIT_RECEIPT_PHASE_2 vs WAIT_AUDIT_SCHEDULE is decided by
     * derivePhasePaymentState's receipt half, and on a checkout-rail
     * application the ONLY thing that can answer "the receipt exists" is the
     * checkout row's own receiptNumber: computePhaseSettlement cannot see the
     * CERTIFICATION_CHECKOUT_M2 serviceType at all, so its phaseReceiptIssued
     * is false forever. Without this assertion nothing distinguishes the
     * two-rail receipt truth from the split-rail one, and an applicant whose M2
     * receipt had been issued would be left waiting for a document they hold.
     */
    it('a settled M2 checkout invoice WITH a receipt lands on WAIT_AUDIT_SCHEDULE', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([
            invoiceRow({
                status: 'RECEIPT_ISSUED',
                paidAt: new Date('2026-08-27T04:27:41.396Z'),
                receiptIssuedAt: new Date('2026-08-27T04:27:41.396Z'),
                receiptNumber: 'TAX-PRD-2026-000005',
            }),
            invoiceRow({
                id: 'inv-m2',
                invoiceNumber: 'INV-CO-59E32623-M2',
                serviceType: M2,
                status: 'RECEIPT_ISSUED',
                totalAmount: 27675,
                paidAt: new Date('2026-08-27T05:00:00.000Z'),
                receiptIssuedAt: new Date('2026-08-27T05:05:00.000Z'),
                receiptNumber: 'TAX-PRD-2026-000006',
                createdAt: new Date('2026-08-27T04:50:00.000Z'),
            }),
        ]);

        const response = await request(app).get('/api/preview/applications/app-checkout-1/preview');

        expect(response.status).toBe(200);
        expect(response.body.preview.nextRequiredAction).toBe('WAIT_AUDIT_SCHEDULE');
        expect(response.body.preview.payment.breakdown.phase2.isPhasePaid).toBe(true);
        expect(response.body.preview.payment.checkout.phase2.receiptNumber).toBe('TAX-PRD-2026-000006');
    });
});
