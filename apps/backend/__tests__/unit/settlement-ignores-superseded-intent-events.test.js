'use strict';

/**
 * Fix round 2 (feat/promptpay-qr, 2026-09-27) — a canceled or failed event for
 * a SUPERSEDED PaymentIntent must not touch the order.
 *
 * Since fix round 1 an order can hold a replacement intent: when its intent A
 * is canceled, the next checkout press mints B and the order's
 * stripePaymentIntentId moves to B. Stripe's payment_intent.canceled for A can
 * arrive after that (a slow or redelivered webhook). The handler used to find
 * the order by metadata.checkoutOrderId and cancel it — cancelling the order
 * that B, the live intent the payer is about to scan, belongs to.
 *
 * Rule: payment_intent.canceled and payment_intent.payment_failed act on the
 * order ONLY when the event's intent id equals the order's CURRENT
 * stripePaymentIntentId. Anything else is recorded as ignored (reason code on
 * the webhook event row and in the log) and changes nothing.
 * payment_intent.succeeded is deliberately NOT covered here — it is unchanged.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockDb = {
    checkoutOrder: { findFirst: jest.fn(), update: jest.fn(async ({ data }) => data), updateMany: jest.fn(async () => ({ count: 1 })) },
    invoice: { updateMany: jest.fn(async () => ({ count: 1 })) },
    paymentTransaction: { update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
    stripeWebhookEvent: { update: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
// PR2 review I-1: a canceled current intent retires order + invoice + charge
// through services/checkout/retire-checkout-order.js; this is the order write.
const CANCEL_ORDER_WRITE = {
    where: { id: 'co-1', status: { in: ['PENDING_PAYMENT', 'CANCELLED'] }, stripePaymentIntentId: 'pi_B' },
    data: { status: 'CANCELLED' },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const logger = require('../../shared/logger');
const { handleStripeEvent } = require('../../services/checkout/checkout-settlement-service');

/** The order after fix round 1 minted replacement pi_B for canceled pi_A. */
const ORDER = {
    id: 'co-1', status: 'PENDING_PAYMENT', stripePaymentIntentId: 'pi_B', paymentTransactionId: 'pt-1',
};

function event(type, intentId, { withMetadata = true } = {}) {
    return {
        id: `evt_${type}_${intentId}`,
        type,
        data: {
            object: {
                id: intentId,
                ...(withMetadata ? { metadata: { checkoutOrderId: 'co-1' } } : { metadata: {} }),
                last_payment_error: { message: 'declined' },
            },
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...ORDER });
});

describe('payment_intent.canceled', () => {
    test('for the SUPERSEDED intent A → the order holding B is untouched, and the event is recorded as ignored', async () => {
        const result = await handleStripeEvent(event('payment_intent.canceled', 'pi_A'));

        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.updateMany).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ handled: true, ignored: true, reason: 'SUPERSEDED_INTENT' }));
        expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith({
            where: { id: 'evt_payment_intent.canceled_pi_A' },
            data: { error: 'IGNORED:SUPERSEDED_INTENT' },
        });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('superseded'),
            expect.objectContaining({ paymentIntentId: 'pi_A', currentPaymentIntentId: 'pi_B', reason: 'SUPERSEDED_INTENT' }),
        );
    });

    test('for the CURRENT intent B → the order is still cancelled', async () => {
        const result = await handleStripeEvent(event('payment_intent.canceled', 'pi_B'));

        expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith(CANCEL_ORDER_WRITE);
        expect(result.ignored).toBeUndefined();
    });

    test('found by intent id (no metadata) → it is the current intent by construction, still cancels', async () => {
        await handleStripeEvent(event('payment_intent.canceled', 'pi_B', { withMetadata: false }));
        expect(mockDb.checkoutOrder.findFirst).toHaveBeenCalledWith({ where: { stripePaymentIntentId: 'pi_B' } });
        expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith(CANCEL_ORDER_WRITE);
    });

    test('an order that records no intent at all is not cancelled by an event naming one (ONLY on equality)', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...ORDER, stripePaymentIntentId: null });
        const result = await handleStripeEvent(event('payment_intent.canceled', 'pi_A'));
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.updateMany).not.toHaveBeenCalled();
        expect(result.reason).toBe('SUPERSEDED_INTENT');
    });

    test('a failed ignore-stamp does not turn into a handler failure (Stripe must not redeliver for it)', async () => {
        mockDb.stripeWebhookEvent.update.mockRejectedValueOnce(new Error('db blip'));
        await expect(handleStripeEvent(event('payment_intent.canceled', 'pi_A'))).resolves.toEqual(
            expect.objectContaining({ ignored: true }),
        );
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.updateMany).not.toHaveBeenCalled();
    });
});

describe('payment_intent.payment_failed', () => {
    test('for the SUPERSEDED intent A → no failure is written on the order\'s charge row', async () => {
        const result = await handleStripeEvent(event('payment_intent.payment_failed', 'pi_A'));

        expect(mockDb.paymentTransaction.update).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ handled: true, ignored: true, reason: 'SUPERSEDED_INTENT' }));
        expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith({
            where: { id: 'evt_payment_intent.payment_failed_pi_A' },
            data: { error: 'IGNORED:SUPERSEDED_INTENT' },
        });
    });

    test('for the CURRENT intent B → the failure is still recorded', async () => {
        await handleStripeEvent(event('payment_intent.payment_failed', 'pi_B'));
        expect(mockDb.paymentTransaction.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pt-1' } }));
    });
});
