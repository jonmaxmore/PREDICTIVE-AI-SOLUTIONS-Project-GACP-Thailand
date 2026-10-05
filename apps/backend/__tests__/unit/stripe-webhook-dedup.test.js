'use strict';

/**
 * Task 4 — thin webhook: retryable dedup + async kick.
 *
 * Behavior under test (docs: design notes
 * task-4-brief.md Step 1, overridden by progress.md Ruling 2 / task-4-brief.md's
 * "RULING that OVERRIDES the brief's Step-3 code"):
 *   - a fresh event is recorded RECEIVED and, if it's payment_intent.succeeded,
 *     ACKs 200 THEN kicks settleEvent (non-blocking);
 *   - a redelivery of an already-PROCESSED event is a true duplicate: 200, no
 *     re-settle, no re-drive;
 *   - a redelivery of an unprocessed (RECEIVED/FAILED) event re-drives;
 *   - a non-succeeded type (e.g. charge.succeeded) never reaches settleEvent —
 *     it is dispatched inline through handleStripeEvent and the event row is
 *     stamped PROCESSED before the 200.
 *
 * Mock wiring note: the brief's sample factories close over plain outer
 * consts (`event`, `settleEvent`) directly inside `jest.mock(...)` — Jest's
 * babel-plugin-jest-hoist statically rejects out-of-scope references in a
 * mock factory unless the identifier is prefixed `mock` (case-insensitive).
 * Verified empirically against this repo's babel-jest transform (jest.config.cjs
 * `transform: { '^.+\\.js$': 'babel-jest' }`) before writing this file the
 * long way. Rewired here with `mock*`-prefixed jest.fn()s so each test can
 * still configure per-call behavior — same assertions, same intent.
 */
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

const mockDb = { stripeWebhookEvent: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const mockSettleEvent = jest.fn(async () => ({ status: 'PROCESSED' }));
const mockHandleStripeEvent = jest.fn(async () => ({ handled: true }));
jest.mock('../../services/checkout/checkout-settlement-service', () => ({
    settleEvent: mockSettleEvent,
    handleStripeEvent: mockHandleStripeEvent,
}));

const mockVerifyWebhookSignature = jest.fn();
jest.mock('../../services/payment/payment-adapter', () => ({
    getPaymentAdapter: () => ({ verifyWebhookSignature: mockVerifyWebhookSignature }),
}));

const request = require('supertest');
const express = require('express');
const logger = require('../../shared/logger');

function app() {
    const a = express();
    a.use((req, _res, next) => { req.rawBody = Buffer.from('{}'); next(); });
    a.use('/webhooks', require('../../routes/api/webhooks/stripe'));
    return a;
}

const succeededEvent = { id: 'evt_9', type: 'payment_intent.succeeded', data: { object: { id: 'pi_9' } } };
const chargeSucceededEvent = { id: 'evt_charge_1', type: 'charge.succeeded', data: { object: { id: 'ch_1' } } };

// The succeeded branch ACKs before kicking settleEvent via `setImmediate`
// (that ordering is the point of Task 4). A plain `await request(...)` can
// race the kick: the HTTP round trip and the kick both go through the event
// loop, and nothing guarantees the response promise settles after the
// check-phase callback runs. Draining one more `setImmediate` turn after the
// request deterministically lets an already-scheduled kick fire (and its
// mocked, synchronously-resolving promise chain fully drain) before any
// assertion on settleEvent runs.
const drain = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyWebhookSignature.mockReturnValue(succeededEvent);
});

test('fresh event → 200, records RECEIVED, kicks settleEvent', async () => {
    mockDb.stripeWebhookEvent.create.mockResolvedValue({});

    const res = await request(app()).post('/webhooks/stripe').set('stripe-signature', 't').send({});
    await drain();

    expect(res.status).toBe(200);
    expect(mockDb.stripeWebhookEvent.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'RECEIVED' }),
    }));
    expect(mockSettleEvent).toHaveBeenCalledWith('evt_9');
});

test('redelivered PROCESSED event → 200 duplicate, no re-settle', async () => {
    mockDb.stripeWebhookEvent.create.mockRejectedValue({ code: 'P2002' });
    mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_9', status: 'PROCESSED' });

    const res = await request(app()).post('/webhooks/stripe').set('stripe-signature', 't').send({});

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockSettleEvent).not.toHaveBeenCalled();
});

test('redelivered unprocessed event → re-drives', async () => {
    mockDb.stripeWebhookEvent.create.mockRejectedValue({ code: 'P2002' });
    mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_9', status: 'FAILED' });

    const res = await request(app()).post('/webhooks/stripe').set('stripe-signature', 't').send({});
    await drain();

    expect(res.status).toBe(200);
    expect(mockSettleEvent).toHaveBeenCalledWith('evt_9');
});

test('charge.succeeded does not call settleEvent — routes inline and stamps PROCESSED', async () => {
    mockVerifyWebhookSignature.mockReturnValue(chargeSucceededEvent);
    mockDb.stripeWebhookEvent.create.mockResolvedValue({});
    mockDb.stripeWebhookEvent.update.mockResolvedValue({});

    const res = await request(app()).post('/webhooks/stripe').set('stripe-signature', 't').send({});

    expect(res.status).toBe(200);
    expect(mockHandleStripeEvent).toHaveBeenCalledWith(chargeSucceededEvent);
    expect(mockSettleEvent).not.toHaveBeenCalled();
    expect(mockDb.stripeWebhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'evt_charge_1' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
    }));
});

// Fix round 1 (review Important #1) — the PROCESSED stamp must be non-fatal.
// handleStripeEvent already committed its effect; a stamp failure (transient
// DB blip, lock contention from a concurrent redelivery of the same row)
// must not 500 — that would make Stripe redeliver and re-run handleStripeEvent
// a second time for an event whose handler already succeeded.
test('inline PROCESSED stamp failing is non-fatal — still 200, error logged, no redelivery', async () => {
    mockVerifyWebhookSignature.mockReturnValue(chargeSucceededEvent);
    mockDb.stripeWebhookEvent.create.mockResolvedValue({});
    mockDb.stripeWebhookEvent.update.mockRejectedValue(new Error('P2028 lock timeout'));

    const res = await request(app()).post('/webhooks/stripe').set('stripe-signature', 't').send({});

    expect(res.status).toBe(200);
    expect(mockHandleStripeEvent).toHaveBeenCalledWith(chargeSucceededEvent);
    expect(logger.error).toHaveBeenCalledWith(
        '[stripe-webhook] processed-stamp failed (non-fatal)',
        expect.objectContaining({ eventId: 'evt_charge_1', error: 'P2028 lock timeout' }),
    );
});
