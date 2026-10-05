'use strict';

/**
 * Review I-1 (feat/promptpay-qr, 2026-09-27) — a re-entered order must not get
 * a second PaymentIntent once Stripe has forgotten the idempotency key.
 *
 * Re-entry used to rely ONLY on the idempotency key `checkout:<orderId>`.
 * Stripe prunes keys after roughly 24 h, and a pruned key simply creates a new
 * intent. With the QR step live, that becomes a double charge:
 *   day 1 the payer opens PI_A's QR (and keeps the image), day 3 presses start
 *   again → PI_B is minted and replaces PI_A on the order, PI_B is paid and the
 *   order settles, then PI_A is paid from the kept QR → settlement finds the
 *   order SETTLED and returns alreadySettled with no alert.
 *
 * The rule pinned here, for an order that already names an intent:
 *   - retrieve it; requires_payment_method / requires_action / processing →
 *     reuse it (its own client secret), mint nothing;
 *   - succeeded → mint nothing, hand back the state (no client secret);
 *   - canceled → the only case a replacement is minted, under a key of its own
 *     (`checkout:<orderId>:after:<oldIntentId>`) so a retry stays idempotent
 *     and cannot resurrect the canceled one;
 *   - anything else, or a retrieval that fails → refuse, mint nothing.
 *
 * The adapter is mocked at its boundary; `createCheckoutSession` answers a NEW
 * id, which is exactly what a pruned idempotency key produces.
 */

process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_' + 'x'.repeat(24);
process.env.STRIPE_CHECKOUT_ENABLED = 'true';
process.env.CONSENT_VERSION_PAYMENT_TERMS = 'payment-terms-th-v1.2';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockCreateSession = jest.fn();
const mockGetIntent = jest.fn();
jest.mock('../../services/payment/payment-adapter', () => ({
    getPaymentAdapter: () => ({
        assertReady: () => {},
        getClientConfig: () => ({ publishableKey: 'pk_test_' + 'x'.repeat(24) }),
        createCheckoutSession: (...a) => mockCreateSession(...a),
        getPaymentIntent: (...a) => mockGetIntent(...a),
    }),
    parseEvent: jest.fn(),
    assertRawBody: jest.fn(),
}));

const mockFindQuotations = jest.fn();
jest.mock('../../services/quotation-service', () => {
    const actual = jest.requireActual('../../services/quotation-service');
    return { ...actual, findQuotationsByApplicationId: (...a) => mockFindQuotations(...a) };
});

const mockDb = {
    application: { findFirst: jest.fn() },
    checkoutOrder: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    invoice: { create: jest.fn() },
    invoiceLineItem: { createMany: jest.fn() },
    paymentTransaction: { create: jest.fn() },
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userConsent: { findFirst: jest.fn() },
    entity: { findUnique: jest.fn(async () => null) },
    user: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { createCheckoutForApplication } = require('../../services/checkout/stripe-checkout-service');
const { buildAcceptanceSnapshot } = require('../../services/quotation-service');
const { ConsentVersions } = require('../../middleware/consent-manager');

const APPLICATION = {
    id: 'app-1', applicationNumber: 'APP-2026-000001', status: 'PENDING_DOC_FEE',
    healthId: 'HID-1', organizationId: 'org-1', totalAreaTypes: 1,
    formData: { cultivationMethods: ['outdoor'] },
};

function acceptedQuotation() {
    const row = {
        id: 'qt-1', quotationNumber: 'QT-PRD-2026-000001', issuerType: 'PLATFORM', status: 'ACCEPTED',
        subtotal: '33000.00', vat: '2310.00', totalAmount: '35310.00',
        validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        installments: [
            { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
            { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
        ],
    };
    return { ...row, acceptedSnapshot: buildAcceptanceSnapshot(row) };
}

/** The open order minted three days ago, bound to PI_A. */
const OPEN_ORDER = {
    id: 'co-1', applicationId: 'app-1', milestone: 'M1', status: 'PENDING_PAYMENT',
    platformFeeNet: '5500.00', platformFeeVat: '385.00',
    platformFeeGross: '5885.00', totalPayableAmount: '5885.00',
    stripePaymentIntentId: 'pi_A', invoiceId: 'inv-1', paymentTransactionId: 'pt-1',
    organizationId: 'org-1', quotationId: 'qt-1',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedQuotation() });
    mockDb.userConsent.findFirst.mockResolvedValue({
        id: 'c-1', version: ConsentVersions.PAYMENT_TERMS, granted: true, grantedAt: new Date('2026-08-28T03:00:00Z'),
    });
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...OPEN_ORDER });
    mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ ...OPEN_ORDER, ...data }));
    // What a pruned idempotency key does: a brand-new intent.
    mockCreateSession.mockResolvedValue({ id: 'pi_B', clientSecret: 'pi_B_secret', raw: {} });
});

const call = () => createCheckoutForApplication({
    applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1', role: 'health' },
});

describe('re-entry after the idempotency window: the order keeps ONE live intent', () => {
    test.each(['requires_payment_method', 'requires_action', 'processing'])(
        'PI_A %s → reused, no second intent, order still names PI_A',
        async (status) => {
            mockGetIntent.mockResolvedValue({ id: 'pi_A', status, client_secret: 'pi_A_secret' });

            const result = await call();

            expect(mockGetIntent).toHaveBeenCalledWith('pi_A');
            expect(mockCreateSession).not.toHaveBeenCalled();
            expect(result.paymentIntentId).toBe('pi_A');
            expect(result.clientSecret).toBe('pi_A_secret');
            expect(result.paymentIntentStatus).toBe(status);
            expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        },
    );

    test('PI_A succeeded (webhook not landed yet) → nothing new is minted, the state is handed back without a client secret', async () => {
        mockGetIntent.mockResolvedValue({ id: 'pi_A', status: 'succeeded', client_secret: 'pi_A_secret' });

        const result = await call();

        expect(mockCreateSession).not.toHaveBeenCalled();
        expect(result.paymentIntentId).toBe('pi_A');
        expect(result.paymentIntentStatus).toBe('succeeded');
        expect(result.clientSecret).toBeNull();
    });

    test('PI_A canceled → the only replacement, under its own idempotency key, and the order moves to it', async () => {
        mockGetIntent.mockResolvedValue({ id: 'pi_A', status: 'canceled', client_secret: 'pi_A_secret' });

        const result = await call();

        expect(mockCreateSession).toHaveBeenCalledTimes(1);
        expect(mockCreateSession.mock.calls[0][0].idempotencyKey).toBe('checkout:co-1:after:pi_A');
        expect(result.paymentIntentId).toBe('pi_B');
        // Fix round 3 (N-1): a compare-and-set on the value that was READ, never
        // a blind update by id.
        expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith({
            where: { id: 'co-1', status: 'PENDING_PAYMENT', stripePaymentIntentId: 'pi_A' },
            data: { stripePaymentIntentId: 'pi_B' },
        });
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
    });

    test('an intent state this flow never produces (requires_capture) → refused, nothing minted', async () => {
        mockGetIntent.mockResolvedValue({ id: 'pi_A', status: 'requires_capture', client_secret: 'x' });

        await expect(call()).rejects.toMatchObject({ code: 'CHECKOUT_INTENT_UNUSABLE' });
        expect(mockCreateSession).not.toHaveBeenCalled();
    });

    test('the gateway cannot say what PI_A is → refused (fail closed), never a blind second intent', async () => {
        mockGetIntent.mockRejectedValue(Object.assign(new Error('api down'), { type: 'StripeConnectionError' }));

        await expect(call()).rejects.toThrow();
        expect(mockCreateSession).not.toHaveBeenCalled();
    });

    test('N-1: the order row changed between the read and the write (cancelled meanwhile, or a later replacement) → refused, nothing overwritten, no client secret', async () => {
        mockGetIntent.mockResolvedValue({ id: 'pi_A', status: 'canceled', client_secret: 'pi_A_secret' });
        // The compare-and-set finds no row matching what was read.
        mockDb.checkoutOrder.updateMany.mockResolvedValueOnce({ count: 0 });

        const outcome = await call().then((r) => ({ resolved: r }), (e) => ({ rejected: e }));

        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        expect(outcome.rejected).toMatchObject({ code: 'CHECKOUT_ORDER_CHANGED', status: 409 });
        expect(outcome.resolved).toBeUndefined();
    });

    test('N-1: a first mint writes its intent with the same compare-and-set (read value: none)', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...OPEN_ORDER, stripePaymentIntentId: null });

        await call();

        expect(mockDb.checkoutOrder.updateMany).toHaveBeenCalledWith({
            where: { id: 'co-1', status: 'PENDING_PAYMENT', stripePaymentIntentId: null },
            data: { stripePaymentIntentId: 'pi_B' },
        });
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
    });

    test('a first entry (no intent on the order yet) still mints under the plain key', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue({ ...OPEN_ORDER, stripePaymentIntentId: null });

        const result = await call();

        expect(mockGetIntent).not.toHaveBeenCalled();
        expect(mockCreateSession.mock.calls[0][0].idempotencyKey).toBe('checkout:co-1');
        expect(result.paymentIntentId).toBe('pi_B');
    });
});
