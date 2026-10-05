'use strict';
/**
 * The two phase-1 pay doors answer a locked-price read failure with the
 * catalogued refusal, not a generic 400 (fix/fees-from-server round 4,
 * operator 2026-10-03 "fail closed").
 *
 * payment-service-phase-flow.resolveLockedPhaseTotals now throws the quotation
 * gate's QUOTATION_GATE_UNAVAILABLE when the accepted quotation's locked price
 * cannot be read (locked-price-read-fails-closed.test.js). Both routes' catch
 * arms answered every error as `400 { error: safeErrorMessage(error) }`, which
 * hid the code the web maps and the Thai sentence that says what to do next.
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
    mockGate.mockResolvedValue({ quotation: { id: 'qt-1' }, phase: 'PHASE_1', snapshot: null });
    mockFindForPaymentOwnership.mockResolvedValue({
        id: APP_ID, status: 'PENDING_DOC_FEE', healthId: 'health-1',
    });
    mockCreatePhase1.mockRejectedValue(gateRefusal('QUOTATION_GATE_UNAVAILABLE'));
});

describe.each([
    ['POST /api/payments/phase1/:id', () => request(app).post(`/api/payments/phase1/${APP_ID}`).send({})],
    ['POST /api/payments/create', () => request(app).post('/api/payments/create').send({ applicationId: APP_ID, phase: '1' })],
])('%s', (_name, press) => {
    it('answers the locked-price read failure as QUOTATION_GATE_UNAVAILABLE 503 with the catalogued Thai sentence', async () => {
        const res = await press();
        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('QUOTATION_GATE_UNAVAILABLE');
        expect(res.body.message).toBe(ERROR_CODES.QUOTATION_GATE_UNAVAILABLE.messageTh);
    });

    it('an uncoded fault still gets the old generic answer (unchanged)', async () => {
        mockCreatePhase1.mockRejectedValue(new Error('something else broke'));
        const res = await press();
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
