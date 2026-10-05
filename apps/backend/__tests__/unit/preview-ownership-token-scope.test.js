/**
 * Document preview — ownership scope must survive the STAGE-A FK re-key.
 *
 * RED-first regression test.
 *
 * routes/api/preview/preview.js scoped ownership with
 *   const healthId = String(req.user?.healthId || '').trim();
 *   const healthScope = healthId ? { healthId } : { applicant: { id: userId } };
 *
 * req.user.healthId is the DECRYPTED PLAINTEXT national ID (auth-middleware
 * sources it from the DB column), while Application.healthId is an FK to
 * User.canonicalId which — since detokenize STAGE A (APP_FK_USE_TOKEN=true,
 * LIVE on prod 2026-06-29) — stores the keyed-HMAC TOKEN. The plaintext branch
 * therefore ALWAYS won and NEVER matched:
 *   GET  /preview/applications/:id/preview        → 404 for every applicant
 *   POST /preview/applications/:id/prepare-preview → 404 for every applicant
 * i.e. the applicant-facing document preview viewer was dead.
 *
 * Fix under test (breaker 3c of the detokenize RFC,
 * docs/handoffs/national-id-detokenize-rfc-2026-06-29.md): prefer the
 * `applicant: { id: req.user.id }` relation join — User.id is a UUID that is
 * never re-keyed, so the scope is correct in BOTH data states. The plaintext
 * national ID must never be used as an Application.healthId predicate again.
 *
 * The prisma mock below EMULATES the post-re-key data state instead of
 * asserting an exact where-shape, so any correct fix (relation join or
 * canonicalId token value) passes and any plaintext regression fails.
 */

'use strict';

const express = require('express');
const request = require('supertest');

const USER_UUID = 'b3b8a4a0-1111-4222-8333-444455556666';
const PLAINTEXT_ID = '1234567890123'; // req.user.healthId — decrypted national ID
const FK_TOKEN = 'f'.repeat(64); // Application.healthId — post-STAGE-A HMAC token

// Mutable so individual tests can flip identity fields.
const mockUser = {
    id: USER_UUID,
    healthId: PLAINTEXT_ID,
    canonicalId: FK_TOKEN,
    role: 'HEALTH_USER',
    canonicalRole: 'health',
};

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { ...mockUser };
        next();
    },
}));

// the project rules rule: mock prisma-database (process.exit(1) without DATABASE_URL).
const mockPrisma = {
    application: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
    },
    invoice: {
        findMany: jest.fn().mockResolvedValue([]),
    },
    // holder-access (spec 2026-09-30 §3.1): the owner is an ACTIVE member of
    // the entity that holds the filing; the read carries that holder fragment.
    entityMembership: {
        findMany: jest.fn(async ({ where }) => (
            where.userId === USER_UUID ? [{ entityId: 'ent-owner', role: 'OWNER' }] : []
        )),
    },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

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
    validateFormData: jest.fn(() => ({ valid: true, missingFields: [] })),
    buildPreviewData: jest.fn(() => ({})),
}));

jest.mock('../../routes/api/preview/preview-financial-utils', () => ({
    // P-GET (2026-09-30): the route reads through this in every state now.
    readPhase1FinancialDocuments: jest.fn().mockResolvedValue({}),
    // F-G4-51: the route also reads the checkout-rail summary. This double
    // answers what the real helper answers for the empty invoice list this
    // suite feeds it (prisma.invoice.findMany → []); the helper's own
    // behaviour is proven in preview-checkout-summary.test.js.
    summarizeCheckoutInvoices: jest.fn(() => ({ phase1: null, phase2: null })),
    // B-F1: the route derives phase1Paid/phase2Paid through this helper; the
    // REAL one is used so the route sees the same OR of the two billing rails
    // production sees (its own cases live in preview-checkout-summary.test.js).
    derivePhasePaymentState: jest.requireActual('../../routes/api/preview/preview-financial-utils').derivePhasePaymentState,
}));

const previewRouter = require('../../routes/api/preview/preview');

/**
 * Post-STAGE-A application row: the FK column holds the TOKEN, the applicant
 * relation joins on the (never re-keyed) User.id UUID.
 */
function makeRow(overrides = {}) {
    return {
        id: 'app-1',
        healthId: FK_TOKEN,
        applicantUserId: USER_UUID,
        entityId: 'ent-owner',
        status: 'DRAFT',
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

/**
 * Behaves like the real DB in the post-re-key state: a plaintext national ID
 * in `where.healthId` never matches the token FK; the applicant relation
 * matches on User.id.
 */
function rowMatchesWhere(row, where = {}) {
    if (where.id !== undefined && where.id !== row.id) { return false; }
    if (where.isDeleted !== undefined && where.isDeleted !== row.isDeleted) { return false; }
    if (where.status !== undefined && where.status !== row.status) { return false; }
    if (where.healthId !== undefined && where.healthId !== row.healthId) { return false; }
    if (where.entityId !== undefined) {
        const cond = where.entityId;
        const ok = cond && Array.isArray(cond.in) ? cond.in.includes(row.entityId) : cond === row.entityId;
        if (!ok) { return false; }
    }
    if (where.applicant !== undefined) {
        const applicantWhere = where.applicant || {};
        if (applicantWhere.id !== undefined && applicantWhere.id !== row.applicantUserId) { return false; }
    }
    // R1 (final review C1): the read is { OR: [holder fragment, pin], AND: [pin] }.
    if (Array.isArray(where.AND) && !where.AND.every((w) => rowMatchesWhere(row, w))) { return false; }
    if (Array.isArray(where.OR) && !where.OR.some((w) => rowMatchesWhere(row, w))) { return false; }
    return true;
}

function armFindFirstWith(row) {
    mockPrisma.application.findFirst.mockImplementation(async ({ where }) =>
        (rowMatchesWhere(row, where) ? row : null));
}

function allFindFirstWheres() {
    return mockPrisma.application.findFirst.mock.calls.map(([args]) => args && args.where);
}

describe('preview routes — ownership scope survives the STAGE-A healthId re-key', () => {
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
        mockUser.id = USER_UUID;
        mockUser.healthId = PLAINTEXT_ID;
        mockUser.canonicalId = FK_TOKEN;
    });

    describe('GET /applications/:id/preview', () => {
        it('returns 200 for the owner when Application.healthId stores the FK token', async () => {
            armFindFirstWith(makeRow());

            const response = await request(app).get('/api/preview/applications/app-1/preview');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.preview.applicationId).toBe('app-1');
        });

        it('never uses the plaintext national ID as an Application.healthId predicate', async () => {
            armFindFirstWith(makeRow());

            await request(app).get('/api/preview/applications/app-1/preview');

            for (const where of allFindFirstWheres()) {
                expect(JSON.stringify(where)).not.toContain(PLAINTEXT_ID);
            }
        });

        it('still 404s for an application owned by someone else (no over-broadening)', async () => {
            armFindFirstWith(makeRow({
                applicantUserId: 'c4c9b5b1-9999-4888-8777-666655554444',
                healthId: 'e'.repeat(64),
                entityId: 'ent-other',
            }));

            const response = await request(app).get('/api/preview/applications/app-1/preview');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });
    });

});
