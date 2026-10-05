'use strict';

/**
 * W2-01 — the payment adapter seam (the work brief §3.1).
 *
 * The contract under test:
 *   - business logic reaches the gateway ONLY through the PaymentAdapter
 *     interface; the stripe SDK import lives in ONE file (probe pin below);
 *   - PAYMENT_ADAPTER=mock|stripe switches implementations, unknown values
 *     fail closed;
 *   - MockPaymentAdapter is deterministic (same idempotency key → same
 *     intent) and can be ordered to fail — so E2E/QA runs are reproducible
 *     while the Stripe keys are BLOCKED(operator:stripe-keys);
 *   - webhook verification demands RAW bytes: a JSON.parse-d body is
 *     rejected by BOTH adapters (PROMPT §3.2 pin);
 *   - parseEvent normalizes BOTH Stripe event families
 *     (payment_intent.* and checkout.session.*) to one domain vocabulary.
 */

const fs = require('fs');
const path = require('path');

// Placeholder credentials, split so secret-literal scanners never match them.
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockIntentCreate = jest.fn();
const mockIntentRetrieve = jest.fn();
const mockConstructEvent = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
    paymentIntents: {
        create: (...a) => mockIntentCreate(...a),
        retrieve: (...a) => mockIntentRetrieve(...a),
    },
    webhooks: { constructEvent: (...a) => mockConstructEvent(...a) },
})));

afterEach(() => {
    delete process.env.PAYMENT_ADAPTER;
    jest.clearAllMocks();
});

describe('probe pin: stripe SDK isolation (§3.1)', () => {
    test('the stripe SDK is imported ONLY by services/payment/stripe-adapter.js', () => {
        const backendRoot = path.join(__dirname, '..', '..');
        const scanDirs = ['services', 'routes', 'config', 'jobs', 'middleware', 'modules', 'shared', 'utils'];
        const importers = [];
        const visit = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '__tests__') { continue; }
                    visit(full);
                } else if (entry.name.endsWith('.js')) {
                    const src = fs.readFileSync(full, 'utf8');
                    if (/require\(['"]stripe['"]\)|from ['"]stripe['"]/.test(src)) {
                        importers.push(path.relative(backendRoot, full));
                    }
                }
            }
        };
        for (const d of scanDirs) {
            const full = path.join(backendRoot, d);
            if (fs.existsSync(full)) { visit(full); }
        }
        expect(importers.sort()).toEqual([path.join('services', 'payment', 'stripe-adapter.js')]);
    });
});

describe('getPaymentAdapter factory', () => {
    test('PAYMENT_ADAPTER=mock returns the mock adapter', () => {
        process.env.PAYMENT_ADAPTER = 'mock';
        const { getPaymentAdapter } = require('../../services/payment/payment-adapter');
        expect(getPaymentAdapter().name).toBe('mock');
    });

    test('the default (unset) adapter is stripe', () => {
        const { getPaymentAdapter } = require('../../services/payment/payment-adapter');
        expect(getPaymentAdapter().name).toBe('stripe');
    });

    test('an unknown adapter value fails closed', () => {
        process.env.PAYMENT_ADAPTER = 'paypal';
        const { getPaymentAdapter } = require('../../services/payment/payment-adapter');
        expect(() => getPaymentAdapter()).toThrow(/PAYMENT_ADAPTER/);
    });
});

describe('MockPaymentAdapter — deterministic, orderable, key-free', () => {
    const params = () => ({
        amountSatang: 553500,
        currency: 'thb',
        paymentMethodTypes: ['promptpay', 'card'],
        statementDescriptor: 'PREDICTIVE AI - GACP',
        description: 'GACP M1',
        metadata: { checkoutOrderId: 'co-1' },
        idempotencyKey: 'checkout:co-1',
    });

    test('createCheckoutSession is deterministic on the idempotency key', async () => {
        const mock = require('../../services/payment/mock-payment-adapter');
        mock.__reset();
        const a = await mock.createCheckoutSession(params());
        const b = await mock.createCheckoutSession(params());
        expect(a.id).toBe(b.id);
        expect(a.clientSecret).toContain(a.id);
        const other = await mock.createCheckoutSession({ ...params(), idempotencyKey: 'checkout:co-2' });
        expect(other.id).not.toBe(a.id);
    });

    test('__setNextCreateFailure makes exactly the next create fail', async () => {
        const mock = require('../../services/payment/mock-payment-adapter');
        mock.__reset();
        mock.__setNextCreateFailure(Object.assign(new Error('ordered failure'), { code: 'MOCK_FAILURE' }));
        await expect(mock.createCheckoutSession(params())).rejects.toMatchObject({ code: 'MOCK_FAILURE' });
        await expect(mock.createCheckoutSession(params())).resolves.toMatchObject({ clientSecret: expect.any(String) });
    });

    test('a non-integer satang amount is refused', async () => {
        const mock = require('../../services/payment/mock-payment-adapter');
        await expect(mock.createCheckoutSession({ ...params(), amountSatang: 55.35 }))
            .rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    });

    test('verifyWebhookSignature accepts only its deterministic HMAC over the raw bytes', () => {
        const mock = require('../../services/payment/mock-payment-adapter');
        const raw = Buffer.from(JSON.stringify({ id: 'evt_m1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_mock' } } }));
        const event = mock.verifyWebhookSignature({ rawBody: raw, signature: mock.signPayload(raw) });
        expect(event.id).toBe('evt_m1');
        expect(() => mock.verifyWebhookSignature({ rawBody: raw, signature: 'mock-sig=' + 'f'.repeat(64) }))
            .toThrow(/signature/i);
    });

    test('getPaymentIntent returns what createCheckoutSession minted', async () => {
        const mock = require('../../services/payment/mock-payment-adapter');
        mock.__reset();
        const s = await mock.createCheckoutSession(params());
        const intent = await mock.getPaymentIntent(s.id);
        expect(intent).toMatchObject({ id: s.id, amount: 553500 });
    });
});

describe('raw-body mandate (§3.2 pin) — a JSON.parse-d body is rejected by BOTH adapters', () => {
    test('mock adapter rejects an already-parsed object body', () => {
        const mock = require('../../services/payment/mock-payment-adapter');
        expect(() => mock.verifyWebhookSignature({ rawBody: { id: 'evt_1' }, signature: 'mock-sig=x' }))
            .toThrow(/raw/i);
    });

    test('stripe adapter rejects an already-parsed object body without touching constructEvent', () => {
        const stripeAdapter = require('../../services/payment/stripe-adapter');
        expect(() => stripeAdapter.verifyWebhookSignature({ rawBody: { id: 'evt_1' }, signature: 't=1,v1=x' }))
            .toThrow(/raw/i);
        expect(mockConstructEvent).not.toHaveBeenCalled();
    });
});

describe('parseEvent — one domain vocabulary over both Stripe event families', () => {
    test.each([
        ['payment_intent.succeeded', 'SETTLED'],
        ['checkout.session.completed', 'SETTLED'],
        ['payment_intent.payment_failed', 'FAILED'],
        ['checkout.session.async_payment_failed', 'FAILED'],
        ['payment_intent.canceled', 'CANCELLED'],
        ['checkout.session.expired', 'CANCELLED'],
        ['charge.refunded', 'UNKNOWN'],
    ])('%s → %s', (type, kind) => {
        const { parseEvent } = require('../../services/payment/payment-adapter');
        const parsed = parseEvent({ id: 'evt_p', type, data: { object: { id: 'obj-1' } } });
        expect(parsed.kind).toBe(kind);
        expect(parsed.eventId).toBe('evt_p');
        expect(parsed.object).toEqual({ id: 'obj-1' });
    });
});

describe('StripeAdapter — thin delegation, fail-closed', () => {
    test('createCheckoutSession delegates to paymentIntents.create with the idempotency key', async () => {
        mockIntentCreate.mockResolvedValue({ id: 'pi_9', client_secret: 'pi_9_cs', status: 'requires_payment_method' });
        const adapter = require('../../services/payment/stripe-adapter');
        const s = await adapter.createCheckoutSession({
            amountSatang: 553500,
            currency: 'thb',
            paymentMethodTypes: ['promptpay', 'card'],
            statementDescriptor: 'PREDICTIVE AI - GACP',
            description: 'GACP M1 — APP-1',
            metadata: { checkoutOrderId: 'co-1' },
            idempotencyKey: 'checkout:co-1',
        });
        expect(mockIntentCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                amount: 553500,
                currency: 'thb',
                payment_method_types: ['promptpay', 'card'],
                statement_descriptor: 'PREDICTIVE AI - GACP',
                metadata: expect.objectContaining({ checkoutOrderId: 'co-1' }),
            }),
            { idempotencyKey: 'checkout:co-1' },
        );
        expect(s).toMatchObject({ id: 'pi_9', clientSecret: 'pi_9_cs' });
    });

    test('getPaymentIntent delegates to paymentIntents.retrieve', async () => {
        mockIntentRetrieve.mockResolvedValue({ id: 'pi_9', status: 'succeeded' });
        const adapter = require('../../services/payment/stripe-adapter');
        await expect(adapter.getPaymentIntent('pi_9')).resolves.toMatchObject({ status: 'succeeded' });
        expect(mockIntentRetrieve).toHaveBeenCalledWith('pi_9');
    });

    test('the client factory fails closed without STRIPE_SECRET_KEY', () => {
        const saved = process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_SECRET_KEY;
        try {
            const adapter = require('../../services/payment/stripe-adapter');
            expect(() => adapter.getStripeClient()).toThrow(/STRIPE_SECRET_KEY/);
        } finally {
            process.env.STRIPE_SECRET_KEY = saved;
        }
    });
});
