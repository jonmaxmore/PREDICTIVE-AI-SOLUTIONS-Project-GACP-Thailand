'use strict';

/**
 * I-1 (PR2 Tier C review, 2026-09-29): payment_intent.canceled used to cancel the
 * ORDER only. Its invoice stayed live, and uniq_invoice_app_service_active (one
 * live invoice per application + serviceType) then refused the invoice of every
 * later mint → P2002 → CHECKOUT_ALREADY_IN_PROGRESS for ever. The applicant could
 * never pay again, and the retire guard's recovery path (Stripe cancel succeeded,
 * our retire transaction failed, the webhook lands) ended in the same wall.
 *
 * Rule: the canceled webhook retires exactly what the checkout retire guard does,
 * through ONE shared helper, in ONE transaction — order → CANCELLED, unpaid
 * invoice soft-deleted with deletedBy/deleteReason (M-1), PENDING charge →
 * CANCELLED. No amount column is written. A paid invoice is never touched.
 * The real-Postgres half is __tests__/integration/canceled-webhook-lets-the-applicant-pay-again-real-postgres.test.js.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockDb = {
    checkoutOrder: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    invoice: { updateMany: jest.fn() },
    paymentTransaction: { update: jest.fn(), updateMany: jest.fn() },
    stripeWebhookEvent: { update: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { handleStripeEvent } = require('../../services/checkout/checkout-settlement-service');

const ORDER = {
    id: 'co-1', status: 'PENDING_PAYMENT', stripePaymentIntentId: 'pi_B',
    invoiceId: 'inv-1', paymentTransactionId: 'pt-1',
};
const canceled = (intentId = 'pi_B') => ({
    id: `evt_canceled_${intentId}`,
    type: 'payment_intent.canceled',
    data: { object: { id: intentId, metadata: { checkoutOrderId: 'co-1' } } },
});

beforeEach(() => {
    jest.clearAllMocks();
    [mockDb.checkoutOrder.updateMany, mockDb.invoice.updateMany, mockDb.paymentTransaction.updateMany]
        .forEach((m) => m.mockReset().mockResolvedValue({ count: 1 }));
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...ORDER });
});

test('the current intent canceled → order CANCELLED, unpaid invoice soft-deleted, PENDING charge CANCELLED, one transaction', async () => {
    const result = await handleStripeEvent(canceled());

    expect(result.handled).toBe(true);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'co-1', status: { in: ['PENDING_PAYMENT', 'CANCELLED'] }, stripePaymentIntentId: 'pi_B' },
        data: { status: 'CANCELLED' },
    });
    expect(mockDb.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', isDeleted: false, paidAt: null },
        data: {
            isDeleted: true,
            deletedAt: expect.any(Date),
            deletedBy: 'system:checkout-order-retired',
            deleteReason: 'PAYMENT_INTENT_CANCELED',
            status: 'cancelled',
        },
    });
    expect(mockDb.paymentTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'pt-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
    });
    expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
});

test('an order already CANCELLED (e.g. by the old handler, or the retire guard) still has its invoice retired on redelivery', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...ORDER, status: 'CANCELLED' });

    await handleStripeEvent(canceled());

    expect(mockDb.invoice.updateMany).toHaveBeenCalled();
});

test('a SETTLED order is never retired by a canceled event', async () => {
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...ORDER, status: 'SETTLED' });

    await handleStripeEvent(canceled());

    expect(mockDb.checkoutOrder.updateMany).not.toHaveBeenCalled();
    expect(mockDb.invoice.updateMany).not.toHaveBeenCalled();
    expect(mockDb.paymentTransaction.updateMany).not.toHaveBeenCalled();
});

test('the order moved to another intent under us (compare-and-set matched nothing) → invoice and charge untouched', async () => {
    mockDb.checkoutOrder.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await handleStripeEvent(canceled());

    expect(result.handled).toBe(true);
    expect(mockDb.invoice.updateMany).not.toHaveBeenCalled();
    expect(mockDb.paymentTransaction.updateMany).not.toHaveBeenCalled();
});

test('no write in the retire carries an amount column', async () => {
    await handleStripeEvent(canceled());
    const writes = [
        ...mockDb.checkoutOrder.updateMany.mock.calls,
        ...mockDb.invoice.updateMany.mock.calls,
        ...mockDb.paymentTransaction.updateMany.mock.calls,
    ];
    expect(writes.length).toBe(3);
    for (const [{ data }] of writes) {
        for (const k of Object.keys(data)) {
            expect(k).not.toMatch(/amount|fee|vat|total|subtotal/i);
        }
    }
});
