'use strict';
/**
 * The wizard's own pay door asks the ONE quotation gate too (F-G4-64 R1,
 * whole-branch review C4).
 *
 * Spec R1 binds acceptance as "เงื่อนไขก่อนสร้างรายการชำระเงินทุกงวด บนทุกราง" —
 * a precondition before a payment record exists, on EVERY rail. The gate was
 * wired to exactly two callers: the card rail (stripe-checkout-service) and the
 * slip rail (payment-slip-service). POST /api/payments/create and POST
 * /api/payments/phase1 mint the phase-1 invoices with no gate at all, and their
 * payable set still contained DRAFT — a status the card rail dropped because a
 * DRAFT application has no quotation to accept in the first place.
 *
 * The service is mocked: what is under test is the door's ORDER — refuse before
 * anything is minted — not the minting itself, which has its own suites.
 */

jest.mock('../../middleware/auth-middleware', () => {
    const asApplicant = (req, _res, next) => {
        req.user = {
            id: 'user-1', role: 'health', canonicalRole: 'health', healthId: 'health-1',
        };
        return next();
    };
    return { authenticateHealth: asApplicant, authenticateProvider: asApplicant, authenticateAny: asApplicant };
});

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(async () => undefined) },
    AuditCategory: { PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { PAYMENT: 'PAYMENT', APPLICATION: 'APPLICATION' },
}));

const mockCreatePhase1 = jest.fn(async () => ({ success: true, invoiceId: 'inv-1' }));
jest.mock('../../services/payment-service', () => ({
    createPhase1Payment: (...a) => mockCreatePhase1(...a),
    _syncPhaseStatusesFromInvoices: jest.fn(async () => ({})),
    getInvoiceSettlementsForApplication: jest.fn(async () => ({
        requiredInvoices: { phase1: [], phase2: [] },
        phase1: { phasePaid: false },
        phase2: { phasePaid: false },
    })),
}));

const mockFindForPaymentOwnership = jest.fn();
jest.mock('../../services/application-service', () => ({
    findForPaymentOwnership: (...a) => mockFindForPaymentOwnership(...a),
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'health-1' })),
}));

const mockGate = jest.fn(async () => ({ quotation: { id: 'qt-1' }, phase: 'PHASE_1', snapshot: null }));
jest.mock('../../services/billing/quotation-gate', () => ({
    assertQuotationAcceptedForPayment: (...a) => mockGate(...a),
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const express = require('express');
const request = require('supertest');
const { ERROR_CODES } = require('../../shared/error-codes');
const paymentsRouter = require('../../routes/api/finance/payments');

const APP_ID = '22222222-2222-4222-8222-222222222222';

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/payments', paymentsRouter);
    return app;
}

/** Exactly what services/billing/quotation-gate.js throws, catalogue and all. */
function gateRefusal(code) {
    const row = ERROR_CODES[code];
    return Object.assign(new Error(row.messageTh), {
        code, status: row.httpStatus, statusCode: row.httpStatus,
    });
}

let app;

beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockCreatePhase1.mockResolvedValue({ success: true, invoiceId: 'inv-1' });
    mockGate.mockResolvedValue({ quotation: { id: 'qt-1' }, phase: 'PHASE_1', snapshot: null });
    mockFindForPaymentOwnership.mockResolvedValue({
        id: APP_ID, status: 'PENDING_DOC_FEE', healthId: 'health-1',
    });
});

describe.each([
    ['POST /api/payments/phase1/:id', () => request(app).post(`/api/payments/phase1/${APP_ID}`).send({})],
    ['POST /api/payments/create', () => request(app).post('/api/payments/create').send({ applicationId: APP_ID, phase: '1' })],
])('%s asks the quotation gate before minting', (_name, press) => {
    it('asks the ONE gate, in the phase vocabulary, for this application', async () => {
        await press();

        expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: APP_ID, milestone: 'PHASE_1',
        }));
    });

    it('a refusal answers with the catalogued code and status, and NOTHING is minted', async () => {
        mockGate.mockRejectedValue(gateRefusal('QUOTATION_NOT_ACCEPTED'));

        const res = await press();

        expect(res.status).toBe(ERROR_CODES.QUOTATION_NOT_ACCEPTED.httpStatus);
        expect(res.body.error).toBe('QUOTATION_NOT_ACCEPTED');
        expect(res.body.message).toBe(ERROR_CODES.QUOTATION_NOT_ACCEPTED.messageTh);
        expect(mockCreatePhase1).not.toHaveBeenCalled();
    });

    it('an application with no quotation at all is refused, not billed (application A2`s shape)', async () => {
        mockGate.mockRejectedValue(gateRefusal('QUOTATION_NOT_ISSUED'));

        const res = await press();

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('QUOTATION_NOT_ISSUED');
        expect(mockCreatePhase1).not.toHaveBeenCalled();
    });

    it('a gate lookup failure is a 503, never a pass', async () => {
        mockGate.mockRejectedValue(gateRefusal('QUOTATION_GATE_UNAVAILABLE'));

        const res = await press();

        expect(res.status).toBe(503);
        expect(mockCreatePhase1).not.toHaveBeenCalled();
    });

    it('DRAFT is not phase-1 payable here either, and the gate is not even asked', async () => {
        mockFindForPaymentOwnership.mockResolvedValue({
            id: APP_ID, status: 'DRAFT', healthId: 'health-1',
        });

        const res = await press();

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('PAYMENT_PHASE_UNAVAILABLE');
        expect(mockCreatePhase1).not.toHaveBeenCalled();
        expect(mockGate).not.toHaveBeenCalled();
    });

    it('an accepted quotation still mints exactly as before', async () => {
        const res = await press();

        expect(res.status).toBe(200);
        expect(mockCreatePhase1).toHaveBeenCalledWith(APP_ID, 'health-1');
    });

    it('an application that is not the caller`s is 404, and the gate is not asked', async () => {
        mockFindForPaymentOwnership.mockResolvedValue(null);

        const res = await press();

        expect(res.status).toBe(404);
        expect(mockGate).not.toHaveBeenCalled();
        expect(mockCreatePhase1).not.toHaveBeenCalled();
    });
});
