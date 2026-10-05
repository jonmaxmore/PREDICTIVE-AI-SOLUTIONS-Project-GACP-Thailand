'use strict';

/**
 * PromptPay QR step (feat/promptpay-qr, operator ruling 2026-09-27: PromptPay
 * only for now, shown by Stripe's own component).
 *
 * The browser needs three things the checkout response did not carry before:
 *
 *   publishableKey  — to load Stripe.js. Read from the BACKEND env at runtime
 *                     (STRIPE_PUBLISHABLE_KEY first, then the dev name
 *                     NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY), never baked into the
 *                     web build. Fail closed: no key, a malformed key, or a key
 *                     whose test/live mode differs from STRIPE_SECRET_KEY's mode
 *                     refuses the checkout BEFORE any row is minted and before
 *                     the gateway is asked for anything (L3: a live key is never
 *                     accepted beside a test secret, nor the other way round).
 *   invoiceId       — the one invoice this order settles, so the screen can
 *                     watch /api/invoices/my for the webhook's receipt instead
 *                     of guessing which row is its own.
 *   payerEmail      — Stripe refuses to confirm a PromptPay intent without
 *                     billing_details.email (measured against the live test-mode
 *                     API: evidence/promptpay-qr-2026-09-27/email-required-probe.txt).
 *                     Source order: the paying entity's contact email, then the
 *                     user's own email, else null (the screen then asks). Never
 *                     a placeholder.
 */

// Placeholder credentials, split so secret-literal scanners never match them.
const TEST_SECRET = 'sk_test_' + 'x'.repeat(24);
const LIVE_SECRET = 'sk_live_' + 'x'.repeat(24);
const TEST_PUBLISHABLE = 'pk_test_' + 'y'.repeat(24);
const LIVE_PUBLISHABLE = 'pk_live_' + 'y'.repeat(24);

process.env.STRIPE_SECRET_KEY = TEST_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
process.env.STRIPE_CHECKOUT_ENABLED = 'true';
process.env.CONSENT_VERSION_PAYMENT_TERMS = 'payment-terms-th-v1.2';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockIntentCreate = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
    paymentIntents: { create: (...a) => mockIntentCreate(...a) },
    webhooks: { constructEvent: jest.fn() },
})));

const mockFindQuotations = jest.fn();
jest.mock('../../services/quotation-service', () => {
    const actual = jest.requireActual('../../services/quotation-service');
    return { ...actual, findQuotationsByApplicationId: (...a) => mockFindQuotations(...a) };
});

const mockDb = {
    application: { findFirst: jest.fn() },
    checkoutOrder: {
        findFirst: jest.fn(), create: jest.fn(), update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
    },
    invoice: { create: jest.fn(), update: jest.fn() },
    invoiceLineItem: { createMany: jest.fn(async () => ({ count: 2 })) },
    paymentTransaction: { create: jest.fn(), update: jest.fn() },
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userConsent: { findFirst: jest.fn() },
    entity: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { getStripePublishableKey } = require('../../config/stripe');
const stripeAdapter = require('../../services/payment/stripe-adapter');
const mockAdapter = require('../../services/payment/mock-payment-adapter');
const { createCheckoutForApplication } = require('../../services/checkout/stripe-checkout-service');
const { buildAcceptanceSnapshot } = require('../../services/quotation-service');
const { ConsentVersions } = require('../../middleware/consent-manager');

const APPLICATION = {
    id: 'app-1',
    applicationNumber: 'APP-2026-000001',
    status: 'PENDING_DOC_FEE',
    healthId: 'HID-1',
    organizationId: 'org-1',
    entityId: 'ent-1',
    totalAreaTypes: 1,
    formData: { cultivationMethods: ['outdoor'] },
};

function acceptedQuotation() {
    const row = {
        id: 'qt-1',
        quotationNumber: 'QT-PRD-2026-000001',
        issuerType: 'PLATFORM',
        status: 'ACCEPTED',
        subtotal: '33000.00',
        vat: '2310.00',
        totalAmount: '35310.00',
        validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        installments: [
            { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
            { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
        ],
    };
    return { ...row, acceptedSnapshot: buildAcceptanceSnapshot(row) };
}

/** The env names this feature reads, restored after every case. */
const ENV_NAMES = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'];
let savedEnv;

beforeEach(() => {
    jest.clearAllMocks();
    savedEnv = Object.fromEntries(ENV_NAMES.map((k) => [k, process.env[k]]));
    process.env.STRIPE_SECRET_KEY = TEST_SECRET;
    process.env.STRIPE_PUBLISHABLE_KEY = TEST_PUBLISHABLE;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedQuotation() });
    mockDb.userConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        version: ConsentVersions.PAYMENT_TERMS,
        granted: true,
        grantedAt: new Date('2026-08-28T03:00:00.000Z'),
    });
    mockDb.$transaction.mockImplementation(async (cb) => cb(mockDb));
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
    mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
    mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
    mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-1', ...data }));
    // Prisma's update returns the WHOLE row; a mock that returned only `data`
    // would drop invoiceId on the second update and hide a real regression.
    let row = null;
    mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => { row = { id: 'co-1', ...data }; return row; });
    mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => { row = { ...row, ...data }; return row; });
    mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });
    mockDb.entity.findUnique.mockResolvedValue({ payload: { contact: { email: 'accounts@farm-co.example' } } });
    mockDb.user.findUnique.mockResolvedValue({ email: 'farmer@farm-co.example' });
});

afterEach(() => {
    for (const k of ENV_NAMES) {
        if (savedEnv[k] === undefined) { delete process.env[k]; } else { process.env[k] = savedEnv[k]; }
    }
});

const call = () => createCheckoutForApplication({
    applicationId: 'app-1',
    milestone: 'M1',
    actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1', role: 'health' },
});

function expectNothingMinted() {
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
    expect(mockDb.invoice.create).not.toHaveBeenCalled();
    expect(mockIntentCreate).not.toHaveBeenCalled();
}

describe('config/stripe — getStripePublishableKey reads the backend env at runtime', () => {
    test('STRIPE_PUBLISHABLE_KEY is read first', () => {
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_' + 'z'.repeat(24);
        expect(getStripePublishableKey()).toBe(TEST_PUBLISHABLE);
    });

    test('the dev name NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is the fallback (apps/backend/.env is not renamed)', () => {
        delete process.env.STRIPE_PUBLISHABLE_KEY;
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = TEST_PUBLISHABLE;
        expect(getStripePublishableKey()).toBe(TEST_PUBLISHABLE);
    });

    test('no key at all fails closed with STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED (503)', () => {
        delete process.env.STRIPE_PUBLISHABLE_KEY;
        expect(() => getStripePublishableKey()).toThrow(
            expect.objectContaining({ code: 'STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED', status: 503 }),
        );
    });

    test('a value that is not a publishable key (a secret pasted into the wrong slot) is refused, not passed to the browser', () => {
        process.env.STRIPE_PUBLISHABLE_KEY = TEST_SECRET;
        expect(() => getStripePublishableKey()).toThrow(
            expect.objectContaining({ code: 'STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED' }),
        );
    });
});

describe('adapters — getClientConfig', () => {
    test('stripe adapter: a test publishable key beside a test secret is handed out', () => {
        expect(stripeAdapter.getClientConfig()).toEqual({ publishableKey: TEST_PUBLISHABLE });
    });

    test('stripe adapter: a LIVE publishable key beside a TEST secret is refused (L3)', () => {
        process.env.STRIPE_PUBLISHABLE_KEY = LIVE_PUBLISHABLE;
        expect(() => stripeAdapter.getClientConfig()).toThrow(
            expect.objectContaining({ code: 'STRIPE_KEY_MODE_MISMATCH', status: 503 }),
        );
    });

    test('stripe adapter: a TEST publishable key beside a LIVE secret is refused', () => {
        process.env.STRIPE_SECRET_KEY = LIVE_SECRET;
        expect(() => stripeAdapter.getClientConfig()).toThrow(
            expect.objectContaining({ code: 'STRIPE_KEY_MODE_MISMATCH', status: 503 }),
        );
    });

    test('mock adapter: there is no Stripe account behind a mock intent, so it hands out no key', () => {
        expect(mockAdapter.getClientConfig()).toEqual({ publishableKey: null });
    });
});

describe('createCheckoutForApplication — what the browser receives', () => {
    test('returns the publishable key, the invoice to watch, and the entity contact email', async () => {
        const result = await call();
        expect(result).toEqual(expect.objectContaining({
            clientSecret: 'pi_1_secret',
            publishableKey: TEST_PUBLISHABLE,
            invoiceId: 'inv-1',
            payerEmail: 'accounts@farm-co.example',
        }));
    });

    test('no key: refused with STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED and nothing is minted or asked of Stripe', async () => {
        delete process.env.STRIPE_PUBLISHABLE_KEY;
        await expect(call()).rejects.toMatchObject({ code: 'STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED', status: 503 });
        expectNothingMinted();
    });

    test('mode mismatch: refused with STRIPE_KEY_MODE_MISMATCH and nothing is minted or asked of Stripe', async () => {
        process.env.STRIPE_PUBLISHABLE_KEY = LIVE_PUBLISHABLE;
        await expect(call()).rejects.toMatchObject({ code: 'STRIPE_KEY_MODE_MISMATCH', status: 503 });
        expectNothingMinted();
    });

    test('payerEmail falls back to the user email when the entity has no contact email', async () => {
        mockDb.entity.findUnique.mockResolvedValue({ payload: { contact: { email: null } } });
        const result = await call();
        expect(result.payerEmail).toBe('farmer@farm-co.example');
        expect(mockDb.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    });

    test('payerEmail is null when neither exists — never a placeholder', async () => {
        mockDb.entity.findUnique.mockResolvedValue({ payload: {} });
        mockDb.user.findUnique.mockResolvedValue({ email: null });
        const result = await call();
        expect(result.payerEmail).toBeNull();
    });

    test('a malformed stored email is not handed to Stripe', async () => {
        mockDb.entity.findUnique.mockResolvedValue({ payload: { contact: { email: 'not-an-email' } } });
        mockDb.user.findUnique.mockResolvedValue({ email: '  ' });
        const result = await call();
        expect(result.payerEmail).toBeNull();
    });

    test('a failed contact lookup degrades to null (the screen asks) instead of failing a checkout that already exists', async () => {
        mockDb.entity.findUnique.mockRejectedValue(new Error('db down'));
        mockDb.user.findUnique.mockRejectedValue(new Error('db down'));
        const result = await call();
        expect(result.payerEmail).toBeNull();
        expect(result.publishableKey).toBe(TEST_PUBLISHABLE);
    });
});
