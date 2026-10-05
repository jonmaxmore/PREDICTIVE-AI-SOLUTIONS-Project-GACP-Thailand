'use strict';
/**
 * RED proof 5 (F-G4-64, spec §4): settlement does not touch the quotation.
 *
 * Today the word "quotation" does not appear in checkout-settlement-service at
 * all, so QT-PRD-2026-000001 and -000002 sit at PENDING with acceptedAt null
 * while both their instalments are paid, both applications are CERTIFIED and
 * one certificate is still active (register.md Q2).
 *
 * The close is MILESTONE-QUALIFIED. Under W14 one quotation prices both
 * phases, so stamping INVOICED at M1 would declare the whole document billed
 * while งวดที่ 2 has not been. INVOICED is not inert: payment-slip-service
 * reads it as "the farmer accepted" (QUOTATION_ACCEPTED_STATES).
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

const mockRecordPhaseInvoiced = jest.fn(async () => ({
    quotationId: 'qt-1', phase: 'PHASE_1', closed: false, status: 'ACCEPTED',
}));
jest.mock('../../services/quotation-service', () => ({
    recordPhaseInvoiced: (...a) => mockRecordPhaseInvoiced(...a),
}));
const mockAuditLog = jest.fn(async () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
}));

const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'ord_1', status: 'PENDING_PAYMENT' }]),
    checkoutOrder: { update: jest.fn() }, invoice: { update: jest.fn() },
    paymentTransaction: { update: jest.fn() }, checkoutDocument: { create: jest.fn() },
};
const mockDb = {
    checkoutOrder: { findFirst: jest.fn() },
    stripeWebhookEvent: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (cb, opts) => { mockDb.__txOpts = opts; return cb(tx); }),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));
jest.mock('../../services/journal-entry-service', () => ({ recordPaymentEntry: jest.fn() }));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../services/receipt-numbering-service', () => ({
    allocateReceiptNumber: jest.fn(async () => ({ number: 'TAX-PRD-2026-000009' })),
    ISSUER: { PLATFORM: 'PLATFORM', DTAM: 'DTAM' },
}));

const svc = require('../../services/checkout/checkout-settlement-service');

const order = (over = {}) => ({
    id: 'ord_1', status: 'PENDING_PAYMENT', milestone: 'M1',
    totalPayableAmount: 5885, platformFeeNet: 5500,
    platformFeeVat: 385, platformFeeGross: 5885,
    invoiceId: 'inv_1', applicationId: 'app_1', organizationId: 'org_1',
    quotationId: 'qt-1',
    invoice: { id: 'inv_1', invoiceNumber: 'INV-CO-1' },
    application: { id: 'app_1', status: 'PENDING_DOC_FEE' },
    ...over,
});
const PI = { id: 'pi_1', amount_received: 588500, metadata: { checkoutOrderId: 'ord_1' } };
/** The instant a crashed settle already wrote to the row before it died. */
const SETTLED_AT = new Date('2026-08-28T10:00:00.000Z');

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (cb, opts) => { mockDb.__txOpts = opts; return cb(tx); });
    mockDb.checkoutOrder.findFirst.mockResolvedValue(order());
});

test('a settled M1 stamps the PHASE_1 instalment on the bound quotation', async () => {
    const r = await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    expect(r).toEqual({ settled: true });
    expect(mockRecordPhaseInvoiced).toHaveBeenCalledWith(expect.objectContaining({
        quotationId: 'qt-1',
        milestone: 'M1',
        invoiceNumber: 'TAX-PRD-2026-000009',
        at: expect.any(Date),
    }));
});

test('the close runs AFTER the transaction commits, never inside it', async () => {
    await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    // The tx callback receives `tx`; recordPhaseInvoiced must not have been
    // handed it, or a throw would roll the money writes back.
    const call = mockRecordPhaseInvoiced.mock.calls[0][0];
    expect(call.tx).toBeUndefined();
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
});

test('an order with no quotationId (minted before the binding) falls back to the applicationId', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue(order({ quotationId: null }));
    await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    expect(mockRecordPhaseInvoiced).toHaveBeenCalledWith(expect.objectContaining({
        quotationId: null, applicationId: 'app_1', milestone: 'M1',
    }));
});

test('a close failure never fails the settlement: the money, the receipt and the status stand', async () => {
    mockRecordPhaseInvoiced.mockRejectedValueOnce(new Error('quotation table on fire'));
    const r = await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    expect(r).toEqual({ settled: true });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'QUOTATION_CLOSE_FAILED',
    }));
});

test('a quotation that was never accepted is stamped but NOT flipped, and it is logged loudly', async () => {
    mockRecordPhaseInvoiced.mockResolvedValueOnce({
        quotationId: 'qt-1', phase: 'PHASE_1', closed: false, status: 'PENDING',
    });
    const r = await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    expect(r).toEqual({ settled: true });
    const { createLogger } = require('../../shared/logger');
    expect(createLogger().error).toHaveBeenCalledWith(
        expect.stringContaining('quotation not accepted at settlement'),
        expect.anything(),
    );
});

/**
 * ── The heal path (review r0, finding 2) ─────────────────────────────────────
 *
 * The close is deliberately OUTSIDE the transaction, which buys the money its
 * safety and costs the quotation its atomicity: a process killed between the
 * commit and the close leaves the order SETTLED, the invoice paid, the receipt
 * bound — and phaseXInvoicedAt NULL. Every later attempt on that order used to
 * short-circuit at the `status === 'SETTLED'` fast path before reaching the
 * close, so Stripe redelivery, the settleEvent retry and the reconcile job all
 * answered "already settled" and walked past the gap. quotation-closure then
 * failed on that row forever, and T10's repair script could not clear it either
 * (that script is scoped to rows settled BEFORE the gate, i.e. quotation_id
 * IS NULL — this row has one).
 *
 * So the fast path carries the same best-effort close, using only what is
 * already on the row: the settlement instant it recorded and the receipt number
 * already bound to its invoice. recordPhaseInvoiced keeps the FIRST instant per
 * phase, so a redelivery of an order that WAS closed properly costs one UPDATE
 * and changes nothing.
 */
test('an order already SETTLED still closes its quotation — the heal path for a crash between the commit and the close', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue(order({
        status: 'SETTLED',
        settledAt: SETTLED_AT,
        invoice: { id: 'inv_1', invoiceNumber: 'INV-CO-1', receiptNumber: 'TAX-PRD-2026-000009' },
    }));

    const r = await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_9' });

    expect(r).toEqual({ settled: true, alreadySettled: true });
    // Nothing is re-settled: no second transaction, no second receipt number.
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockRecordPhaseInvoiced).toHaveBeenCalledWith(expect.objectContaining({
        quotationId: 'qt-1',
        applicationId: 'app_1',
        milestone: 'M1',
        // The number already on the row, not a freshly allocated one.
        invoiceNumber: 'TAX-PRD-2026-000009',
        // The instant the settlement actually happened, not "now".
        at: SETTLED_AT,
        chargedAmount: 5885,
    }));
    expect(mockRecordPhaseInvoiced.mock.calls[0][0].tx).toBeUndefined();
});

test('a heal-path close failure still answers alreadySettled and records QUOTATION_CLOSE_FAILED', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue(order({
        status: 'SETTLED', settledAt: SETTLED_AT,
    }));
    mockRecordPhaseInvoiced.mockRejectedValueOnce(new Error('quotation table on fire'));

    const r = await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_9' });

    expect(r).toEqual({ settled: true, alreadySettled: true });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'QUOTATION_CLOSE_FAILED',
    }));
});

/**
 * ── The figures the fallback stamps against (review r0, finding 3) ───────────
 *
 * When the order carries no quotationId the function has to guess the document
 * from the application, and the guess can be wrong: a drain-window order still
 * holding a stale PaymentIntent can be confirmed long after staff re-issued and
 * the applicant accepted a corrected quotation. recordPhaseInvoiced can only
 * refuse that if it is told what was actually collected, so settlement passes
 * the order's own total, and a refusal is logged as loudly as an unaccepted row.
 */
test('settlement tells the close what was actually collected, so the fallback can refuse a document it does not match', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue(order({ quotationId: null }));
    await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    expect(mockRecordPhaseInvoiced).toHaveBeenCalledWith(expect.objectContaining({
        quotationId: null, applicationId: 'app_1', chargedAmount: 5885,
    }));
});

test('a refusal to stamp is logged as loudly as an unaccepted row, and the money still stands', async () => {
    mockRecordPhaseInvoiced.mockResolvedValueOnce({
        quotationId: 'qt-2', phase: 'PHASE_1', closed: false, status: 'ACCEPTED',
        stamped: false, mismatch: { chargedAmount: '5535.00', acceptedAmount: '5885.00' },
    });
    const r = await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' });
    expect(r).toEqual({ settled: true });
    const { createLogger } = require('../../shared/logger');
    expect(createLogger().error).toHaveBeenCalledWith(
        expect.stringContaining('quotation figures do not match the charge'),
        expect.objectContaining({ chargedAmount: '5535.00', acceptedAmount: '5885.00' }),
    );
});
