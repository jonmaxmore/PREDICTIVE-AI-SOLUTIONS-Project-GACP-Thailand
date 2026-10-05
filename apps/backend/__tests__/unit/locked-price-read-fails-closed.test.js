/**
 * A read error on the accepted quotation's locked price STOPS the payment
 * (operator ruling 2026-10-03: "fail closed"; fix/fees-from-server round 4).
 *
 * payment-service-phase-flow.resolveLockedPhaseTotals used to catch a failure
 * of getFrozenPhaseFees, log it, and return the RECOMPUTED totals, so
 * /api/payments/create and /api/payments/phase1/:id went on to write the
 * application's phase amounts and a PaymentTransaction at a price the applicant
 * never accepted.
 *
 * Two cases that must not be confused:
 *   - the read THROWS (database or quotation-service fault) → refuse with the
 *     quotation gate's QUOTATION_GATE_UNAVAILABLE (503, Thai cause + next
 *     action), writing nothing;
 *   - the read ANSWERS null (no platform quotation row, or a row with no
 *     installments) → unchanged: the recomputed price is used. That is not an
 *     error. In practice both routes run assertQuotationAcceptedForPayment
 *     first (routes/api/finance/payments.js refusalForPhase1Mint), which already
 *     refuses an application with no quotation as QUOTATION_NOT_ISSUED.
 *
 * Stubbed prisma, so the counts below are the writes this flow attempted.
 */

'use strict';

const { createPhaseFlow } = require('../../services/payment-service-phase-flow');
const feeService = require('../../services/fee-service');

const APP_ID = '11111111-1111-4111-8111-111111111111';
const HEALTH_ID = 'health-1';

function harness({ frozen }) {
    const writes = { applicationUpdate: 0, transaction: 0, paymentTransactionCreate: 0 };
    const application = {
        id: APP_ID,
        healthId: HEALTH_ID,
        status: 'PENDING_DOC_FEE',
        phase1Status: 'PENDING',
        phase2Status: 'PENDING',
        phase1Amount: 1,
        phase2Amount: 1,
        cultivationScopeCount: 1,
        formData: { farmData: { areaTypes: ['INDOOR'] } },
        workflowHistory: [],
    };
    const prisma = {
        application: {
            findFirst: jest.fn(async () => application),
            update: jest.fn(async () => { writes.applicationUpdate += 1; return application; }),
        },
        paymentTransaction: {
            create: jest.fn(async () => { writes.paymentTransactionCreate += 1; return {}; }),
        },
        $transaction: jest.fn(async (fn) => {
            writes.transaction += 1;
            return fn({
                application: { update: async () => application, updateMany: async () => ({ count: 1 }), findUnique: async () => application, findFirst: async () => application },
                paymentTransaction: { create: async () => { writes.paymentTransactionCreate += 1; return {}; } },
                applicationStatusHistory: { create: async () => ({}) },
                auditLog: { create: async () => ({}) },
            });
        }),
    };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    const flow = createPhaseFlow({
        prisma,
        feeService,
        CONFIG: { invoiceExpiryMinutes: 60 },
        generateSecureIdFragment: () => 'ABCDEFGHI',
        asArray: (v) => (Array.isArray(v) ? v : []),
        buildWorkflowEvent: (type) => ({ type }),
        syncPhaseStatusesFromInvoices: jest.fn(async () => ({ phase1Paid: false, settlements: { requiredInvoices: { phase1: [] } } })),
        getInvoiceSettlementsForApplication: jest.fn(async () => ({ phase1: { phasePaid: false }, requiredInvoices: { phase1: [] } })),
        logger,
        getFrozenPhaseFees: frozen,
    });
    return { flow, writes, logger };
}

describe('the locked price read fails closed', () => {
    test('a throwing quotation read refuses the payment and writes nothing', async () => {
        const { flow, writes } = harness({
            frozen: jest.fn(async () => { throw new Error('connection terminated unexpectedly'); }),
        });
        let refusal = null;
        let result = null;
        try {
            result = await flow.createPhase1Payment(APP_ID, HEALTH_ID);
        } catch (err) {
            refusal = err;
        }
        expect({ proceededAtPrice: result?.amount ?? null }).toEqual({ proceededAtPrice: null });
        expect(refusal).not.toBeNull();
        expect(refusal.code).toBe('QUOTATION_GATE_UNAVAILABLE');
        expect(refusal.statusCode).toBe(503);
        expect(refusal.message).toMatch(/[฀-๿]/);
        expect(refusal.message).toMatch(/ลองใหม่/);
        expect(refusal.message).not.toContain('connection terminated');
        expect(writes).toEqual({ applicationUpdate: 0, transaction: 0, paymentTransactionCreate: 0 });
    });

    test('no quotation of record (the read answers null) is not an error: the recomputed price is used, unchanged', async () => {
        const { flow, writes } = harness({ frozen: jest.fn(async () => null) });
        const result = await flow.createPhase1Payment(APP_ID, HEALTH_ID);
        const recomputed = feeService.calculateApplicationFees({ farmData: { areaTypes: ['INDOOR'] } }).phase1.phaseTotal;
        expect(result.success).toBe(true);
        expect(result.amount).toBe(recomputed);
        expect(writes.transaction).toBe(1);
    });

    test('a frozen price that reads cleanly still wins over the recompute, unchanged', async () => {
        const frozenFees = { scopeCount: 1, phase1: { phaseTotal: 7777 }, phase2: { phaseTotal: 8888 } };
        const { flow } = harness({ frozen: jest.fn(async () => frozenFees) });
        const result = await flow.createPhase1Payment(APP_ID, HEALTH_ID);
        expect(result.amount).toBe(7777);
    });
});
