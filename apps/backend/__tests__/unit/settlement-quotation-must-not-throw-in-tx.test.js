'use strict';
/**
 * RED proof 3 (F-G4-64, spec §4; synthesis.md §5(ก).3 and the review note at 445).
 *
 * THIS TEST EXISTS TO FORBID A FIX, NOT TO DESCRIBE ONE.
 *
 * The obvious way to close the quotation is to call markQuotationInvoiced
 * inside the settle $transaction. markQuotationInvoiced throws
 * QUOTATION_NOT_FOUND when there is no row (quotation-service.js:928-943 — the
 * exact shape of application A2) and INVALID_QUOTATION_STATUS from any status
 * that is not ACCEPTED. A throw inside that transaction rolls back ALL of it:
 * no invoice `paid`, no receiptNumber, no CheckoutDocument, no journal entry,
 * no application status change — and then settleEvent retries until the event
 * is DEAD_LETTER. Stripe has taken the money and the system has recorded
 * nothing.
 *
 * Every PENDING_PAYMENT order alive on the day the gate ships is in exactly
 * this position, because its quotation is still PENDING.
 *
 * The test drives that scenario through the REAL settle path with a throwing
 * in-transaction hook and asserts the damage, so the failure mode is written
 * down and a future "tidy-up" that moves the close inside the tx turns red.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../services/quotation-service', () => ({
    recordPhaseInvoiced: jest.fn(async () => ({ quotationId: 'qt-1', phase: 'PHASE_1', closed: false, status: 'ACCEPTED' })),
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(async () => ({})) },
    AuditCategory: { PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { APPLICATION: 'APPLICATION', PAYMENT: 'PAYMENT' },
}));

const writes = [];
const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'ord_1', status: 'PENDING_PAYMENT' }]),
    checkoutOrder: { update: jest.fn(async (a) => { writes.push(['order', a]); return {}; }) },
    invoice: { update: jest.fn(async (a) => { writes.push(['invoice', a]); return {}; }) },
    paymentTransaction: { update: jest.fn(async (a) => { writes.push(['charge', a]); return {}; }) },
    checkoutDocument: { create: jest.fn(async (a) => { writes.push(['document', a]); return {}; }) },
};
const mockDb = {
    checkoutOrder: { findFirst: jest.fn() },
    stripeWebhookEvent: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    // A REAL rollback: when the callback throws, nothing it wrote is kept.
    $transaction: jest.fn(async (cb, opts) => {
        mockDb.__txOpts = opts;
        const mark = writes.length;
        try {
            return await cb(tx);
        } catch (err) {
            writes.length = mark;   // rolled back
            throw err;
        }
    }),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));
jest.mock('../../services/journal-entry-service', () => ({ recordPaymentEntry: jest.fn() }));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async () => { writes.push(['status', {}]); }),
}));
jest.mock('../../services/receipt-numbering-service', () => ({
    allocateReceiptNumber: jest.fn(async () => ({ number: 'TAX-PRD-2026-000009' })),
    ISSUER: { PLATFORM: 'PLATFORM', DTAM: 'DTAM' },
}));

const svc = require('../../services/checkout/checkout-settlement-service');
const { SETTLEMENT } = require('../../config/business-rules');

const ORDER = {
    id: 'ord_1', status: 'PENDING_PAYMENT', milestone: 'M1',
    totalPayableAmount: 5885, platformFeeNet: 5500,
    platformFeeVat: 385, platformFeeGross: 5885,
    invoiceId: 'inv_1', applicationId: 'app_1', organizationId: 'org_1', quotationId: 'qt-1',
    // The charge row is one of the money writes the second test names by hand.
    // settleFromPaymentIntent only writes it when the order carries a
    // paymentTransactionId, so the fixture has to carry one; without it that
    // assertion would demand a write the production path was never asked to
    // make, and would fail for a reason that has nothing to do with the
    // quotation.
    paymentTransactionId: 'ptx_1',
    invoice: { id: 'inv_1', invoiceNumber: 'INV-CO-1' },
    application: { id: 'app_1', status: 'PENDING_DOC_FEE' },
};
const EVENT = {
    id: 'evt_1', status: 'RECEIVED', attempts: SETTLEMENT.MAX_ATTEMPTS - 1,
    payload: { data: { object: { id: 'pi_1', amount_received: 588500, metadata: { checkoutOrderId: 'ord_1' } } } },
};

beforeEach(() => {
    jest.clearAllMocks();
    writes.length = 0;
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...ORDER });
    mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ ...EVENT });
});

test('a throw INSIDE the settle transaction loses every money write and dead-letters the event', async () => {
    // Simulate the wrong fix: a quotation call placed inside the tx that throws
    // the way markQuotationInvoiced throws on a still-PENDING row.
    tx.checkoutDocument.create.mockImplementationOnce(async () => {
        const err = new Error('[quotation-service] Cannot mark INVOICED from status "PENDING"');
        err.code = 'INVALID_QUOTATION_STATUS';
        throw err;
    });

    const r = await svc.settleEvent('evt_1');

    // The damage, named: nothing survived, and the event is terminal.
    expect(writes).toHaveLength(0);
    expect(r.status).toBe('DEAD_LETTER');
    expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'DEAD_LETTER' }),
    }));
});

test('by contrast, the shipped close runs after the commit: the same failure keeps every money write', async () => {
    const { recordPhaseInvoiced } = require('../../services/quotation-service');
    recordPhaseInvoiced.mockRejectedValueOnce(Object.assign(
        new Error('[quotation-service] Cannot mark INVOICED from status "PENDING"'),
        { code: 'INVALID_QUOTATION_STATUS' },
    ));

    const r = await svc.settleEvent('evt_1');

    expect(r.status).toBe('PROCESSED');
    expect(writes.map((w) => w[0])).toEqual(
        expect.arrayContaining(['order', 'invoice', 'charge', 'document', 'status']));
    // The close was actually attempted. Without this the assertion above would
    // also pass on a build that never calls the quotation service at all, which
    // is exactly the state this file was written against.
    expect(recordPhaseInvoiced).toHaveBeenCalledTimes(1);
});

test('grep guard: checkout-settlement-service must not call the quotation service inside its transaction', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.resolve(__dirname, '../../services/checkout/checkout-settlement-service.js'), 'utf8');
    const txStart = src.indexOf('await prisma.$transaction(');
    const txEnd = src.indexOf('if (txOutcome?.raced)');
    expect(txStart).toBeGreaterThan(-1);
    expect(txEnd).toBeGreaterThan(txStart);
    const inside = src.slice(txStart, txEnd);
    // closeQuotationForSettledOrder is named too: the close now has a wrapper
    // with two call sites, and moving THAT into the transaction would do the
    // same damage while leaving the three older names absent from the slice.
    expect(inside).not.toMatch(
        /recordPhaseInvoiced|markQuotationInvoiced|quotationService|closeQuotationForSettledOrder/);
});
