'use strict';

/**
 * POST /api/applications/:id/prepare-preview — PR 2b.
 *
 * The route scoped its lookup with `where: { status: 'REGISTERED' }`. Nothing
 * writes REGISTERED: the wizard created applications as 'PAYMENT_1_PENDING'
 * (now 'PENDING_DOC_FEE'), and every other writer uses a canonical state. So
 * the findFirst matched nothing and the route answered
 * "Application not found or not in REGISTERED status" for every real
 * application — with the 404 also swallowing the distinction between "not
 * yours" and "wrong state".
 *
 * The sibling GET /prepare route already had the right list. This pins that
 * both routes share ONE list, so the next state added to the previewable set
 * cannot be added to only one of them.
 */

const PREVIEWABLE_STATUSES = require('../../routes/api/preview/previewable-statuses');
const { WORKFLOW_STATES } = require('../../services/workflow-transition-service');

describe('previewable-statuses is a single shared list', () => {
    test('every entry is a canonical workflow state', () => {
        const nonCanonical = [...PREVIEWABLE_STATUSES].filter((s) => !WORKFLOW_STATES.includes(s));
        expect(nonCanonical).toEqual([]);
    });

    test('covers the states an applicant can actually be in before paying', () => {
        // DRAFT is the one the 2026-05-02 bug report was about; PENDING_DOC_FEE
        // is what the wizard now writes on submit.
        expect(PREVIEWABLE_STATUSES.has('DRAFT')).toBe(true);
        expect(PREVIEWABLE_STATUSES.has('SUBMITTED')).toBe(true);
        expect(PREVIEWABLE_STATUSES.has('PENDING_DOC_FEE')).toBe(true);
        expect(PREVIEWABLE_STATUSES.has('DOC_FEE_PAID')).toBe(true);
    });

    test('covers the active revision states an applicant edits before resending (F-PREVIEW-REVISION-CLOSED)', () => {
        // REVISION_REQUESTED / CAR_PENDING are the two EDITABLE_STATUSES
        // (routes/api/applications/applications.js:212) this list used to omit:
        // the auditor sends the file back, the farmer can edit it, but the
        // resubmit button lives ONLY on this preview page
        // (preview/client-view.tsx:425-450) — so the 400 here left the farmer
        // with no way back to the reviewer. Found by the s03 real-DB walk
        // 2026-08-18.
        expect(PREVIEWABLE_STATUSES.has('REVISION_REQUESTED')).toBe(true);
        expect(PREVIEWABLE_STATUSES.has('CAR_PENDING')).toBe(true);
    });

    test('excludes the terminal states, where a preview means nothing', () => {
        for (const terminal of ['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED', 'CERTIFIED']) {
            expect(PREVIEWABLE_STATUSES.has(terminal)).toBe(false);
        }
    });
});

describe('prepare-preview no longer hard-filters on a status nothing writes', () => {
    const source = require('fs').readFileSync(
        require('path').join(__dirname, '../../routes/api/preview/preview.js'),
        'utf8',
    );

    test('the lookup does not scope on a literal status', () => {
        // `status: 'REGISTERED'` inside the findFirst where-clause is the bug.
        expect(source).not.toMatch(/status:\s*'REGISTERED'/);
    });

    test('both preview routes read the shared list rather than inline literals', () => {
        expect(source).toMatch(/PREVIEWABLE_STATUSES/);
        // No inline previewable whitelist left behind.
        expect(source).not.toMatch(/\['DRAFT',\s*'REGISTERED',\s*'SUBMITTED'/);
    });

    test('a state mismatch is reported as 400, not as a 404 "not found"', () => {
        // Conflating them told an applicant their own application did not
        // exist. The GET route already distinguished the two.
        expect(source).not.toMatch(/not found or not in REGISTERED status/);
    });
});

/**
 * F-PREVIEW-REVISION-CLOSED — route-level RED-first regression
 * (Task 2, design notes).
 *
 * The Set-membership tests above catch a future edit to the array; these hit
 * the actual GET /applications/:id/preview handler so a future edit to the
 * gate check itself (not just the Set) is caught too. Harness mirrors
 * preview-ownership-token-scope.test.js.
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

const mockRoutePrisma = {
    application: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
    },
    invoice: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
    },
    quote: {
        update: jest.fn().mockResolvedValue({}),
    },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockRoutePrisma }));

jest.mock('../../shared/api-response', () => ({
    safeErrorMessage: jest.fn((e) => (e && e.message) || 'error'),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../services/fee-service', () => ({
    calculateApplicationFees: jest.fn(() => ({
        scopeCount: 1,
        phase1: { total: 5535, serviceFeeAmount: 5535, phaseTotal: 5535 },
        phase2: { total: 27675, serviceFeeAmount: 27675, phaseTotal: 27675 },
        stateTotal: 30000,
        platformTotal: 3210,
        grandTotal: 33210,
    })),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({
        phasePaid: false,
        phaseReceiptIssued: false,
        state: { status: 'PENDING' },
        platform: { status: 'PENDING' },
    })),
    flattenRequiredInvoices: jest.fn(() => []),
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

jest.mock('../../routes/api/preview/preview-financial-utils', () => ({
    readPhase1FinancialDocuments: jest.fn().mockResolvedValue({}),
    // F-G4-51: the route also reads the checkout-rail summary. This double
    // answers what the real helper answers for the empty invoice list this
    // suite feeds it (prisma.invoice.findMany → []); the helper's own
    // behaviour is proven in preview-checkout-summary.test.js.
    summarizeCheckoutInvoices: jest.fn(() => ({ phase1: null, phase2: null })),
    // B-F1: the route derives phase1Paid/phase2Paid through this helper. The
    // REAL one is used — a double that faked "paid" would make this suite's
    // read-only assertions meaningless — so the route sees the same OR of the
    // two billing rails production sees.
    derivePhasePaymentState: jest.requireActual('../../routes/api/preview/preview-financial-utils').derivePhasePaymentState,
}));

const previewRouter = require('../../routes/api/preview/preview');
const financialUtils = require('../../routes/api/preview/preview-financial-utils');

function makeRouteRow(status, overrides = {}) {
    return {
        id: 'app-revision-1',
        applicantUserId: ROUTE_USER_ID,
        status,
        isDeleted: false,
        formData: {},
        attachments: null,
        phase1Amount: 5535,
        phase1Status: 'PENDING',
        phase2Amount: 27675,
        phase2Status: 'PENDING',
        totalAreaTypes: 1,
        applicant: {
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            phoneNumber: '0812345678',
            email: 'somchai@example.com',
        },
        ...overrides,
    };
}

describe('GET /applications/:id/preview — route gate for the active revision states (F-PREVIEW-REVISION-CLOSED)', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/preview', previewRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRoutePrisma.application.update.mockResolvedValue({});
        mockRoutePrisma.invoice.findMany.mockResolvedValue([]);
    });

    it.each(['REVISION_REQUESTED', 'CAR_PENDING'])(
        'is previewable (200) for a %s application — the resubmit door depends on this',
        async (status) => {
            mockRoutePrisma.application.findFirst.mockResolvedValue(makeRouteRow(status));

            const response = await request(app).get('/api/preview/applications/app-revision-1/preview');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.preview.status).toBe(status);
        },
    );

    it.each(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED', 'CERTIFIED'])(
        'stays blocked (400) for the terminal state %s — the fix must not widen past the 2 active states',
        async (status) => {
            mockRoutePrisma.application.findFirst.mockResolvedValue(makeRouteRow(status));

            const response = await request(app).get('/api/preview/applications/app-revision-1/preview');

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Application is not in previewable state');
        },
    );
});

/**
 * F-PREVIEW-REVISION-WRITE — final-review round (2026-08-18), Item 1.
 *
 * preview.js:120 unconditionally called ensurePhase1FinancialDocuments (which
 * UPDATEs invoices at preview-financial-utils.js:175 + quotes at :87 whenever
 * the phase-1 pair is not PAID) and preview.js:133-138 applied a feePatch that
 * rewrites application.phase1Amount/phase2Amount/totalAreaTypes — the very
 * input the M2 checkout price is computed from. REVISION_REQUESTED/CAR_PENDING
 * are applicant-editable states this branch newly made previewable, so an
 * applicant GET could silently reprice money artifacts with zero audit.
 *
 * The fix then: skip BOTH the ensure call and the feePatch write in those two
 * states. Since P-GET (2026-09-30) the route reads in every state, and since M5
 * (2026-10-02) ensurePhase1FinancialDocuments no longer exists at all.
 */
describe('GET /applications/:id/preview — REVISION_REQUESTED/CAR_PENDING perform ZERO writes (F-PREVIEW-REVISION-WRITE)', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/preview', previewRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRoutePrisma.application.update.mockResolvedValue({});
        mockRoutePrisma.invoice.findMany.mockResolvedValue([]);
        mockRoutePrisma.invoice.update.mockResolvedValue({});
        mockRoutePrisma.quote.update.mockResolvedValue({});
        financialUtils.readPhase1FinancialDocuments.mockResolvedValue({
            quote: null,
            invoice: null,
            phase1: { state: { quote: null, invoice: null }, platform: { quote: null, invoice: null } },
        });
    });

    it.each(['REVISION_REQUESTED', 'CAR_PENDING'])(
        'performs ZERO writes for %s even though stored amounts differ from computed fees (mocked fee-service always returns scopeCount 1 — totalAreaTypes 2 + mismatched phase amounts below force the pre-fix feePatch branch)',
        async (status) => {
            mockRoutePrisma.application.findFirst.mockResolvedValue(makeRouteRow(status, {
                totalAreaTypes: 2, // mocked calculateApplicationFees always returns scopeCount:1
                phase1Amount: 9999,
                phase1Status: 'PENDING',
                phase2Amount: 9999,
                phase2Status: 'PENDING',
            }));

            const response = await request(app).get('/api/preview/applications/app-revision-1/preview');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.preview).toBeDefined();
            expect(financialUtils.readPhase1FinancialDocuments).toHaveBeenCalledTimes(1);
            expect(mockRoutePrisma.invoice.update).not.toHaveBeenCalled();
            expect(mockRoutePrisma.quote.update).not.toHaveBeenCalled();
            expect(mockRoutePrisma.application.update).not.toHaveBeenCalled();
        },
    );

    // P-GET (staging walk 2026-09-30, L3): the read-only branch no longer stops
    // at the two revision states — this used to pin DRAFT's feePatch write
    // (application.update ×1). A GET writes nothing in any previewable state;
    // the real-Postgres proof is preview-get-writes-nothing-real-postgres.test.js.
    it.each(['DRAFT', 'SUBMITTED', 'PENDING_DOC_FEE'])(
        '%s performs ZERO writes too, even though stored amounts differ from computed fees (P-GET)',
        async (status) => {
            mockRoutePrisma.application.findFirst.mockResolvedValue(makeRouteRow(status, {
                totalAreaTypes: 2,
                phase1Amount: 9999,
                phase1Status: 'PENDING',
            }));

            const response = await request(app).get('/api/preview/applications/app-revision-1/preview');

            expect(response.status).toBe(200);
            expect(financialUtils.readPhase1FinancialDocuments).toHaveBeenCalledTimes(1);
            expect(mockRoutePrisma.application.update).not.toHaveBeenCalled();
            expect(mockRoutePrisma.invoice.update).not.toHaveBeenCalled();
            expect(mockRoutePrisma.quote.update).not.toHaveBeenCalled();
            // The computed figures are still returned.
            expect(response.body.preview.payment.phase1Amount).toBe(5535);
        },
    );
});
