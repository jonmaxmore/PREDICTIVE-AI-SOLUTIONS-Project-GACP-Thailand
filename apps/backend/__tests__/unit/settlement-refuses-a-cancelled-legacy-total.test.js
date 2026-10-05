'use strict';

/**
 * PR3 fix round 1 (m4): money that lands for a CANCELLED order whose total still
 * carries its old DTAM part (total_payable_amount <> platform_fee_gross — kept on
 * CANCELLED rows by migration 20260929155037, whose CHECK exempts them) cannot be
 * settled: the order → SETTLED write would break checkout_orders_total_arithmetic_check.
 *
 * Without a refusal up front, settlement draws a TAX-PRD receipt number first and
 * only then hits the CHECK inside the transaction — a number is burnt and the
 * error is a raw constraint violation. The refusal runs BEFORE allocateReceiptNumber
 * with a named code, so settleEvent records FAILED → DEAD_LETTER with that code
 * for an operator (the payment was captured and needs a refund or manual handling).
 * No amount is written.
 */

process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);

const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({ ...mockLog, createLogger: () => mockLog }));
jest.mock('../../services/quotation-service', () => ({ recordPhaseInvoiced: jest.fn(async () => null) }));

const mockDb = {
    checkoutOrder: { findFirst: jest.fn() },
    stripeWebhookEvent: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    $transaction: jest.fn(async () => { throw new Error('transaction must not be opened'); }),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));
jest.mock('../../services/journal-entry-service', () => ({ recordPaymentEntry: jest.fn() }));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../services/receipt-numbering-service', () => ({
    allocateReceiptNumber: jest.fn(async () => ({ number: 'TAX-PRD-2026-000001' })),
    ISSUER: { PLATFORM: 'PLATFORM', DTAM: 'DTAM' },
}));

const svc = require('../../services/checkout/checkout-settlement-service');
const { allocateReceiptNumber } = require('../../services/receipt-numbering-service');
const { SETTLEMENT } = require('../../config/business-rules');
const { ERROR_CODES } = require('../../shared/error-codes');

const CODE = 'CHECKOUT_CANCELLED_ORDER_LEGACY_TOTAL';

/** The demo row after PR2 retired it and PR3 dropped its DTAM column. */
const LEGACY_CANCELLED = {
    id: 'co-old', applicationId: 'app-1', milestone: 'M1', status: 'CANCELLED',
    platformFeeNet: '500.00', platformFeeVat: '385.00',
    platformFeeGross: '885.00', totalPayableAmount: '5885.00',
    invoiceId: 'inv-old', organizationId: 'org-1', quotationId: 'qt-1',
    invoice: { id: 'inv-old', invoiceNumber: 'INV-CO-OLD-M1' },
    application: { id: 'app-1', status: 'PENDING_DOC_FEE' },
};
const PI = { id: 'pi_A', amount: 588500, amount_received: 588500, metadata: { checkoutOrderId: 'co-old', milestone: 'M1' } };

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...LEGACY_CANCELLED });
});

test('refused with a named code BEFORE a receipt number is drawn or a transaction opened', async () => {
    await expect(svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' }))
        .rejects.toMatchObject({ code: CODE, checkoutOrderId: 'co-old' });
    expect(allocateReceiptNumber).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockLog.error).toHaveBeenCalled();
});

test('settleEvent records it FAILED with the code, and the last attempt dead-letters it (never PROCESSED)', async () => {
    mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({
        id: 'evt_1', status: 'RECEIVED', attempts: 0, payload: { data: { object: PI } },
    });
    const first = await svc.settleEvent('evt_1');
    expect(first.status).toBe('FAILED');
    expect(mockDb.stripeWebhookEvent.update.mock.calls[0][0].data.error).toContain(CODE);

    mockDb.stripeWebhookEvent.update.mockClear();
    mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({
        id: 'evt_1', status: 'FAILED', attempts: SETTLEMENT.MAX_ATTEMPTS - 1, payload: { data: { object: PI } },
    });
    const last = await svc.settleEvent('evt_1');
    expect(last.status).toBe('DEAD_LETTER');
    const statuses = mockDb.stripeWebhookEvent.update.mock.calls.map((c) => c[0].data.status);
    expect(statuses).toContain('DEAD_LETTER');
    expect(statuses).not.toContain('PROCESSED');
});

test('the code is catalogued with a Thai message and a source pointer at the throw', () => {
    const row = ERROR_CODES[CODE];
    expect(row).toMatchObject({ code: CODE, httpStatus: 409 });
    expect(row.messageTh).toMatch(/[฀-๿]/);
    expect(row.source).toMatch(/^services\/checkout\/checkout-settlement-service\.js:\d+$/);
});

test('pin: a CANCELLED order whose total equals its gross is not caught by this refusal', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue({
        ...LEGACY_CANCELLED, platformFeeNet: '5500.00', platformFeeGross: '5885.00',
    });
    await svc.settleFromPaymentIntent({ paymentIntent: PI, eventId: 'evt_1' }).catch(() => {});
    expect(allocateReceiptNumber).toHaveBeenCalledTimes(1);
});
