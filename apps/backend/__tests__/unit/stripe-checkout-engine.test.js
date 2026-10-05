'use strict';

/**
 * Wave 2 — the Stripe checkout engine
 * (docs/payment-refactor/step2-data-model-design.md v2 §5.5, approved;
 * canonical 7-step / Stripe-only master directive).
 *
 * Four surfaces under test:
 *
 *   config/stripe.js                     fail-closed client factory, the
 *                                        locked statement descriptor, satang
 *                                        conversion.
 *   stripe-checkout-service              one checkout = one order = one
 *                                        invoice = one PaymentIntent, with
 *                                        the idempotency key that makes
 *                                        re-entry charge-safe.
 *   routes/api/webhooks/stripe.js        raw-body signature verification,
 *                                        insert-first dedup, amount
 *                                        cross-check.
 *   checkout-settlement-service          the atomic settle: order SETTLED +
 *                                        collection-agent journal entry +
 *                                        the settlement document + workflow
 *                                        unlock — one transaction, SYSTEM
 *                                        actor.
 *
 * Drain-then-purge (D2): nothing here touches the legacy slip path; the
 * canonical-state mapping (M1 → DOC_FEE_PAID, M2 → AUDIT_FEE_PAID) reuses
 * the existing dispatcher-queue states so Wave 3 can rename without a second
 * integration.
 */

// Placeholder credential, split so secret-literal scanners never match it.
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
// PromptPay QR step: a checkout now also needs a publishable key of the same
// mode (fail-closed otherwise). Placeholder, split like the secret above.
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
process.env.STRIPE_CHECKOUT_ENABLED = 'true';
// F-G4-64: the terms gate compares the grant against this version; pin it
// rather than inherit whatever apps/backend/.env carries.
process.env.CONSENT_VERSION_PAYMENT_TERMS = 'payment-terms-th-v1.2';

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// ── Stripe SDK mock — the client the factory hands out ──────────────────────
const mockIntentCreate = jest.fn();
// Review I-1: re-entry retrieves the order's intent before anything else.
const mockIntentRetrieve = jest.fn(async (id) => ({ id, status: 'requires_action', client_secret: `${id}_secret_live` }));
const mockConstructEvent = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
    paymentIntents: {
        create: (...a) => mockIntentCreate(...a),
        retrieve: (...a) => mockIntentRetrieve(...a),
    },
    webhooks: { constructEvent: (...a) => mockConstructEvent(...a) },
})));

// ── the F-G4-64 gates ───────────────────────────────────────────────────────
// A checkout now runs the quotation-acceptance gate and the payment-terms gate
// before it mints anything. Both are fail-closed and both catch their own
// lookup failures, so a mock that does not carry the model fails in the SHAPE
// of a working policy (synthesis 5.7) — the mocks below are real, and the
// frozen figures match the decomposition every case here asserts.
const mockFindQuotations = jest.fn();
// F-G4-64 — the settle path closes the quotation AFTER its transaction commits.
// The real recordPhaseInvoiced would go looking for a row in this suite's prisma
// mock and fail there, and the settle path swallows that failure into an audit
// write — which is a SECOND $transaction and would break the "everything in ONE
// transaction" assertion for a reason that has nothing to do with the engine.
const mockRecordPhaseInvoiced = jest.fn(async () => ({
    quotationId: 'qt-1', phase: 'PHASE_1', closed: false, status: 'ACCEPTED',
}));
jest.mock('../../services/quotation-service', () => {
    const actual = jest.requireActual('../../services/quotation-service');
    return {
        ...actual,
        findQuotationsByApplicationId: (...a) => mockFindQuotations(...a),
        recordPhaseInvoiced: (...a) => mockRecordPhaseInvoiced(...a),
    };
});

// ── prisma mock ─────────────────────────────────────────────────────────────
const mockDb = {
    application: { findFirst: jest.fn() },
    checkoutOrder: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        // F-G4-64 fix round 2: an order minted before the gate existed carries
        // no quotation_id, so re-entry stamps the document it was just checked
        // against onto it. Without this key the re-entry case dies with a
        // missing-model TypeError instead of exercising the door.
        updateMany: jest.fn(async () => ({ count: 1 })),
    },
    invoice: { create: jest.fn(), update: jest.fn() },
    invoiceLineItem: { createMany: jest.fn(async () => ({ count: 3 })) },
    paymentTransaction: { create: jest.fn(), update: jest.fn() },
    stripeWebhookEvent: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    checkoutDocument: { create: jest.fn() },
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userConsent: { findFirst: jest.fn() },
    // FOR-UPDATE re-check inside the settle tx — `cb` below receives
    // mockDb itself as `tx`, so this doubles as tx.$queryRaw.
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (cb, opts) => { mockDb.__txOpts = opts; return cb(mockDb); }),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const mockWriteStatus = jest.fn(async () => ({}));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteStatus(...a),
}));

const mockRecordPaymentEntry = jest.fn(async () => ({ persisted: true, journalEntryId: 'je-1' }));
jest.mock('../../services/journal-entry-service', () => ({
    recordPaymentEntry: (...a) => mockRecordPaymentEntry(...a),
}));

const mockAllocate = jest.fn();
jest.mock('../../services/receipt-numbering-service', () => {
    const actual = jest.requireActual('../../services/receipt-numbering-service');
    return { ...actual, allocateReceiptNumber: (...a) => mockAllocate(...a) };
});

const { STATEMENT_DESCRIPTOR, toSatang } = require('../../config/stripe');
const { SETTLEMENT } = require('../../config/business-rules');
// W2-01 adapter seam: the client factory + webhook-secret assertion moved to
// the ONE SDK-importing file. Same fail-closed assertions, new home.
const { getStripeClient, assertWebhookSecret } =
    require('../../services/payment/stripe-adapter');
const { createCheckoutForApplication } = require('../../services/checkout/stripe-checkout-service');
const { settleFromPaymentIntent, handleStripeEvent } =
    require('../../services/checkout/checkout-settlement-service');
const { buildAcceptanceSnapshot } = require('../../services/quotation-service');
const { ConsentVersions } = require('../../middleware/consent-manager');

const APPLICATION = {
    id: 'app-1',
    applicationNumber: 'APP-2026-000001',
    status: 'PENDING_DOC_FEE',
    healthId: 'HID-1',
    organizationId: 'org-1',
    totalAreaTypes: 1,
    formData: { cultivationMethods: ['outdoor'] },
};

function pendingOrder(overrides = {}) {
    return {
        id: 'co-1',
        applicationId: 'app-1',
        milestone: 'M1',
        status: 'PENDING_PAYMENT',
        // Columns as breakdownForMilestone writes them since 2026-09-11: the
        // whole ค่าบริการ in platform_fee_net. The charge (5,885) is the same
        // number it was under the old split.
        platformFeeNet: '5500.00',
        platformFeeVat: '385.00',
        platformFeeGross: '5885.00',
        totalPayableAmount: '5885.00',
        stripePaymentIntentId: 'pi_1',
        invoiceId: 'inv-1',
        paymentTransactionId: 'pt-1',
        organizationId: 'org-1',
        // F-G4-64 — the other half of the binding T5 writes at mint time. The
        // settle path stamps the instalment on THIS quotation after its
        // transaction commits.
        quotationId: 'qt-1',
        application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-2026-000001' },
        invoice: { id: 'inv-1', invoiceNumber: 'INV-CO-1' },
        ...overrides,
    };
}

/**
 * The accepted quotation of record for APPLICATION: both instalments at one
 * scope, W14 figures (5,885 / 29,425) — the same decomposition every checkout
 * case below asserts, so the R2 drift check passes on the money and refuses
 * only when the money is wrong.
 */
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

beforeEach(() => {
    jest.clearAllMocks();
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedQuotation() });
    mockDb.userConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        version: ConsentVersions.PAYMENT_TERMS,
        granted: true,
        grantedAt: new Date('2026-08-28T03:00:00.000Z'),
    });
    mockDb.$transaction.mockImplementation(async (cb, opts) => { mockDb.__txOpts = opts; return cb(mockDb); });
    // FOR-UPDATE re-check default: order still PENDING_PAYMENT under the
    // lock (every settle test in this file uses order id 'co-1'). Tests
    // that need a different row override this with mockResolvedValueOnce.
    mockDb.$queryRaw.mockResolvedValue([{ id: 'co-1', status: 'PENDING_PAYMENT' }]);
    mockDb.invoiceLineItem.createMany.mockResolvedValue({ count: 3 });
    mockDb.stripeWebhookEvent.update.mockResolvedValue({});
    mockDb.invoice.update.mockResolvedValue({});
    mockDb.paymentTransaction.update.mockResolvedValue({});
});

describe('config/stripe — the locked constants and fail-closed posture', () => {
    test('the statement descriptor is exactly the locked value and within the 22-char limit', () => {
        expect(STATEMENT_DESCRIPTOR).toBe('PREDICTIVE AI - GACP');
        expect(STATEMENT_DESCRIPTOR.length).toBeLessThanOrEqual(22);
    });

    test('THB amounts convert to satang exactly', () => {
        expect(toSatang('5535.00')).toBe(553500);
        expect(toSatang(5535)).toBe(553500);
        expect(toSatang('27675.00')).toBe(2767500);
        // Decimal strings with satang precision survive.
        expect(toSatang('5535.50')).toBe(553550);
    });

    test('the client factory fails closed without a secret key', () => {
        const saved = process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_SECRET_KEY;
        try {
            expect(() => getStripeClient()).toThrow(/STRIPE_SECRET_KEY/);
        } finally {
            process.env.STRIPE_SECRET_KEY = saved;
        }
    });

    test('the webhook secret assertion fails closed', () => {
        const saved = process.env.STRIPE_WEBHOOK_SECRET;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        try {
            expect(() => assertWebhookSecret()).toThrow(/STRIPE_WEBHOOK_SECRET/);
        } finally {
            process.env.STRIPE_WEBHOOK_SECRET = saved;
        }
    });
});

describe('stripe-checkout-service — one order, one invoice, one intent', () => {
    test('M1 checkout mints the order with the fee-service decomposition and a satang intent', async () => {
        mockDb.application.findFirst.mockResolvedValue(APPLICATION);
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
        mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
        mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
        mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-1', ...data }));
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
        mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });

        const result = await createCheckoutForApplication({
            applicationId: 'app-1',
            milestone: 'M1',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        });

        // Breakdown = modules/billing decomposition, arithmetic intact.
        const created = mockDb.checkoutOrder.create.mock.calls[0][0].data;
        expect(created.milestone).toBe('M1');
        // W14 (operator ruling 2026-08-22, the change log c28355ea; figures
        // confirmed d1c33ea0): VAT is 7% of the WHOLE ค่าบริการ, not of a
        // platform slice. Phase 1 at one scope is 5,885, not 5,535.
        //
        // 2026-09-11 — the state/platform split is retired, so the columns
        // changed even though the charge did not: the whole 5,500 ค่าบริการ
        // sits in `platformFeeNet` (it used to read 5,000 / 500). The DB CHECK
        // since migration 20260929155037 — total = gross — is asserted below.
        expect(created).not.toHaveProperty('dtamPayableAmount');
        expect(created.platformFeeNet).toBe(5500);
        expect(created.platformFeeVat).toBe(385);
        expect(created.platformFeeGross).toBe(5885);
        expect(created.totalPayableAmount).toBe(5885);
        expect(created.totalPayableAmount).toBe(created.platformFeeGross);

        // The intent: satang, THB, PromptPay-ONLY (mandate D3 2026-08-04 —
        // Stripe method = PromptPay QR only; card path intentionally removed),
        // locked descriptor, metadata, and the idempotency key that makes a
        // retried create return the SAME intent instead of a second charge.
        const [intentArgs, intentOpts] = mockIntentCreate.mock.calls[0];
        expect(intentArgs.amount).toBe(588500); // W14 — 5,885 THB in satang
        expect(intentArgs.currency).toBe('thb');
        expect(intentArgs.payment_method_types).toEqual(['promptpay']);
        expect(intentArgs.statement_descriptor).toBe('PREDICTIVE AI - GACP');
        expect(intentArgs.metadata).toMatchObject({
            checkoutOrderId: 'co-1',
            applicationId: 'app-1',
            milestone: 'M1',
            organizationId: 'org-1',
        });
        expect(intentOpts.idempotencyKey).toBe('checkout:co-1');

        // One invoice, two lines: ค่าบริการ and its VAT.
        const lines = mockDb.invoiceLineItem.createMany.mock.calls[0][0].data;
        // 2026-09-05: the first line was ['DTAM_FEE', ...] with isTaxable false —
        // an exemption claimed on money the same document charges 7% on.
        // 2026-09-11: with the state/platform split retired that line would
        // print 0 baht captioned "ราคาเต็ม", so it is gone rather than zeroed.
        // invoice-lines-agree-with-the-vat-charged.test.js pins the arithmetic;
        // this pins the shape.
        expect(lines.map((l) => l.code).sort()).toEqual(['PLATFORM_FEE', 'PLATFORM_VAT']);
        expect(lines.find((l) => l.code === 'STATE_FEE')).toBeUndefined();
        expect(lines.find((l) => l.code === 'PLATFORM_FEE').isTaxable).toBe(true);
        expect(lines.find((l) => l.code === 'PLATFORM_VAT').isTaxable).toBe(false);
        expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(5885);

        expect(result.clientSecret).toBe('pi_1_secret');
        expect(result.breakdown.totalPayableAmount).toBe(5885);
    });

    test('mint stamps invoice.dueDate — billing.prisma requires it NOT NULL, so a mint without it crashes on the real DB', async () => {
        // Q2-D1 (W3-41): prisma/schema/billing.prisma:58 declares
        // `dueDate DateTime` (required). The mocked prisma below accepts any
        // shape, which is exactly why the missing field survived unit tests —
        // this case pins the field itself.
        mockDb.application.findFirst.mockResolvedValue(APPLICATION);
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
        mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
        mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
        mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-1', ...data }));
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
        mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });

        const before = new Date();
        await createCheckoutForApplication({
            applicationId: 'app-1',
            milestone: 'M1',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        });
        const after = new Date();

        const invoiceData = mockDb.invoice.create.mock.calls[0][0].data;
        expect(invoiceData.dueDate).toBeInstanceOf(Date);

        // And it must be the schedule service's answer for the mint instant
        // (config-driven M1 window on the canonical Thai calendar). Both
        // bounds are computed in case the test straddles ICT midnight.
        const { computeDueDate } = require('../../services/checkout/checkout-schedule-service');
        const allowed = [
            computeDueDate(before, 'M1').getTime(),
            computeDueDate(after, 'M1').getTime(),
        ];
        expect(allowed).toContain(invoiceData.dueDate.getTime());
    });

    test('re-entry returns the open order instead of minting a sibling', async () => {
        mockDb.application.findFirst.mockResolvedValue(APPLICATION);
        mockDb.checkoutOrder.findFirst.mockResolvedValue(pendingOrder());
        mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret_again' });

        const result = await createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] } },
        });

        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockDb.invoice.create).not.toHaveBeenCalled();
        // Review I-1 (2026-09-27): re-entry no longer trusts the idempotency
        // key alone (Stripe prunes it after ~24 h). It retrieves the intent the
        // order names and hands THAT back — no create call at all.
        expect(mockIntentRetrieve).toHaveBeenCalledWith('pi_1');
        expect(mockIntentCreate).not.toHaveBeenCalled();
        expect(result.paymentIntentId).toBe('pi_1');
        expect(result.clientSecret).toBe('pi_1_secret_live');
        expect(result.checkoutOrderId).toBe('co-1');
    });

    test('concurrent double-checkout: winner mints, loser gets a clean 409 — never a raw P2002', async () => {
        // W2-02 §3.4: both requests pass the findFirst gate before either has
        // committed; the Wave-1 partial unique index rejects the second insert
        // and the service must translate that into a readable 409.
        mockDb.application.findFirst.mockResolvedValue(APPLICATION);
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
        const p2002 = Object.assign(
            new Error('Unique constraint failed on the fields: (`applicationId`,`milestone`,`status`)'),
            { code: 'P2002' },
        );
        mockDb.checkoutOrder.create
            .mockImplementationOnce(async ({ data }) => ({ id: 'co-1', ...data }))
            .mockRejectedValueOnce(p2002);
        mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
        mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-1', ...data }));
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
        mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });

        const results = await Promise.allSettled([
            createCheckoutForApplication({ applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' } }),
            createCheckoutForApplication({ applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' } }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        // The loser sees a user-facing conflict, not Prisma internals.
        expect(rejected[0].reason).toMatchObject({
            status: 409,
            code: 'CHECKOUT_ALREADY_IN_PROGRESS',
        });
        expect(rejected[0].reason.code).not.toBe('P2002');
        // Exactly one order minted; the loser minted nothing downstream.
        expect(mockDb.checkoutOrder.create).toHaveBeenCalledTimes(2);
        expect(mockDb.invoice.create).toHaveBeenCalledTimes(1);
    });

    test('M2 is refused before the documents pass (canonical step 4 gate)', async () => {
        mockDb.application.findFirst.mockResolvedValue({ ...APPLICATION, status: 'ASSIGNED_FOR_REVIEW' });
        await expect(createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M2', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] } },
        })).rejects.toMatchObject({ code: 'CHECKOUT_MILESTONE_NOT_PAYABLE' });
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });

    test('an unknown milestone is refused outright', async () => {
        await expect(createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M3', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] } },
        })).rejects.toMatchObject({ code: 'CHECKOUT_INVALID_MILESTONE' });
    });
});

describe('F-CHECKOUT-M2 — invoice serviceType is milestone-dimensioned (2026-08-18 unblock)', () => {
    test('RED-proof: M2 checkout must not collide with M1\'s already-active invoice (money-flow report §0)', async () => {
        // Simulates the partial unique index uniq_invoice_app_service_active
        // (applicationId, serviceType) WHERE isDeleted=false — the exact
        // mechanism the real-DB Playwright walk hit as a raw 500
        // ("Unique constraint failed on (applicationId, serviceType)").
        // Settlement never soft-deletes a paid invoice (predicate is
        // isDeleted only), so M1's row stays ACTIVE forever.
        const activeInvoices = []; // { applicationId, serviceType }
        mockDb.invoice.create.mockImplementation(async ({ data }) => {
            const collides = activeInvoices.some(
                (r) => r.applicationId === data.applicationId && r.serviceType === data.serviceType,
            );
            if (collides) {
                throw Object.assign(
                    new Error('Unique constraint failed on the fields: (`applicationId`,`serviceType`)'),
                    { code: 'P2002' },
                );
            }
            activeInvoices.push({ applicationId: data.applicationId, serviceType: data.serviceType });
            return { id: `inv-${data.serviceType}`, ...data };
        });
        mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: `co-${data.milestone}`, ...data }));
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-x', ...data }));
        mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-x', ...data }));
        mockIntentCreate.mockResolvedValue({ id: 'pi_x', client_secret: 'secret_x' });

        // M1 mints first.
        mockDb.application.findFirst.mockResolvedValue({ ...APPLICATION, status: 'PENDING_DOC_FEE' });
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
        await createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        });

        // M2 becomes payable once documents pass; no open M2 order yet.
        mockDb.application.findFirst.mockResolvedValue({ ...APPLICATION, status: 'PENDING_AUDIT_FEE' });
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);

        // Pre-fix this REJECTS with the raw P2002 (the exact reported 500).
        await expect(createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M2', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        })).resolves.toMatchObject({ milestone: 'M2' });

        const [m1ServiceType, m2ServiceType] = mockDb.invoice.create.mock.calls.map((c) => c[0].data.serviceType);
        expect(m1ServiceType).toBe('CERTIFICATION_CHECKOUT_M1');
        expect(m2ServiceType).toBe('CERTIFICATION_CHECKOUT_M2');
        expect(m1ServiceType).not.toBe(m2ServiceType);
        // Invariant (report §5.1): must never contain STATE_FEE, or
        // resolveIssuerType flips the journal entry to DTAM and the whole
        // revenue leg is skipped.
        expect(m2ServiceType).not.toContain('STATE_FEE');
    });

    test('same-(app,milestone) double-submit that collides at the INVOICE index is still a 409, never a raw 500', async () => {
        mockDb.application.findFirst.mockResolvedValue(APPLICATION);
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
        mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
        // The ORDER create succeeds (no order-level race here); the invoice
        // step is what collides — e.g. a stale orphan invoice from a
        // previous crashed attempt at the exact same milestone still holds
        // the active slot. The P2002 must still translate to 409.
        mockDb.invoice.create.mockRejectedValue(
            Object.assign(new Error('Unique constraint failed on the fields: (`applicationId`,`serviceType`)'), { code: 'P2002' }),
        );

        await expect(createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        })).rejects.toMatchObject({ status: 409, code: 'CHECKOUT_ALREADY_IN_PROGRESS' });
    });

    test('tx-wrap: order+invoice+lines+charge are ONE transaction — an invoice failure never leaves an orphan order', async () => {
        mockDb.application.findFirst.mockResolvedValue(APPLICATION);
        mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
        mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-orphan-check', ...data }));
        // Force the invoice step to blow up mid-sequence — a real DB error,
        // NOT a P2002 (that path is covered by the test above); this proves
        // atomicity, not the 409 translation.
        mockDb.invoice.create.mockRejectedValue(Object.assign(new Error('db exploded'), { code: 'P9999' }));

        await expect(createCheckoutForApplication({
            applicationId: 'app-1', milestone: 'M1', actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        })).rejects.toThrow('db exploded');

        // The create sequence must run inside prisma.$transaction — the ONLY
        // mechanism that rolls the just-created order back with the failed
        // invoice instead of leaving it committed as an orphan
        // PENDING_PAYMENT row (invoiceId=null) that a retry would later hand
        // to settlement (recordPaymentEntry throws on invoiceId=null).
        expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
        expect(mockDb.checkoutOrder.create).toHaveBeenCalledTimes(1);
        // The link-back update (the step that finalizes a usable order) never
        // ran — the failure happened before it, inside the same transaction.
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
    });
});

describe('checkout-settlement-service — the atomic settle', () => {
    test('a verified succeeded intent settles everything in ONE transaction', async () => {
        const order = pendingOrder();
        mockDb.checkoutOrder.findFirst.mockResolvedValue(order);
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ ...order, ...data }));
        mockAllocate
            .mockResolvedValueOnce({ number: 'TAX-PRD-2026-000001' })
            .mockResolvedValueOnce({ number: 'RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑' });

        const result = await settleFromPaymentIntent({
            paymentIntent: {
                id: 'pi_1',
                amount: 588500,
                amount_received: 588500,
                metadata: { checkoutOrderId: 'co-1', milestone: 'M1' },
            },
            eventId: 'evt_1',
        });

        expect(result.settled).toBe(true);
        // Everything ran inside the single transaction wrapper.
        expect(mockDb.$transaction).toHaveBeenCalledTimes(1);

        // Order → SETTLED, and nothing else but its settlement instant.
        const orderUpdate = mockDb.checkoutOrder.update.mock.calls[0][0].data;
        expect(orderUpdate.status).toBe('SETTLED');
        expect(Object.keys(orderUpdate).sort()).toEqual(['settledAt', 'status']);
        expect(orderUpdate.settledAt).toBeInstanceOf(Date);

        // One-fee journal entry: full cash in, service fee + VAT, atomically
        // via the tx handle.
        const [invoiceId, amount, components, meta] = mockRecordPaymentEntry.mock.calls[0];
        expect(invoiceId).toBe('inv-1');
        expect(amount).toBe(5885);
        // `platformFee` carries the whole ค่าบริการ since 2026-09-11, and no
        // `stateFee` is passed at all since 2026-09-29 (operator: DTAM is settled
        // offline in the company's own accounts) — the money (5,885) never moved.
        expect(components).toEqual({ platformFee: 5500, vat: 385 });
        expect(components.platformFee + components.vat).toBe(amount);
        expect(meta.tx).toBe(mockDb);
        // Settlement provenance (Task 3 carry-forward #2): sourceId MUST be
        // non-null — it's the key the partial unique index
        // journal_entries_settlement_once guards.
        expect(meta.sourceType).toBe('CHECKOUT_SETTLEMENT');
        expect(meta.sourceId).toBe('co-1');

        // Bounded transaction — SETTLEMENT config, not Prisma's 5s default.
        expect(mockDb.__txOpts).toEqual({
            timeout: SETTLEMENT.TX_TIMEOUT_MS,
            maxWait: SETTLEMENT.TX_MAX_WAIT_MS,
        });

        // W14 (operator ruling 2026-08-22, the change log c28355ea) — ONE
        // document. This previously required the pair ['DTAM_DISBURSAL_RECEIPT',
        // 'PLATFORM_TAX_INVOICE']: a VAT-exempt receipt issued in DTAM's name,
        // plus a tax invoice covering only the platform fee. The farmer no
        // longer pays DTAM and the company no longer collects as its agent, so
        // the disbursal receipt is retired and the company's tax invoice now
        // covers the WHOLE ค่าบริการ.
        const docTypes = mockDb.checkoutDocument.create.mock.calls.map((c) => c[0].data.documentType).sort();
        expect(docTypes).toEqual(['PLATFORM_TAX_INVOICE']);
        const taxDoc = mockDb.checkoutDocument.create.mock.calls
            .map((c) => c[0].data).find((d) => d.documentType === 'PLATFORM_TAX_INVOICE');
        expect(taxDoc.payload.issuerName).toContain('พรีดิกทีฟ เอไอ โซลูชัน');
        expect(taxDoc.payload.vat).toMatchObject({ rate: 0.07 });
        // The document totals the FULL charge, and the VAT base is the whole
        // ค่าบริการ — the platform_fee_net column alone (no DTAM portion is added
        // in since 2026-09-29).
        expect(taxDoc.payload.total).toBe(String(order.totalPayableAmount));
        expect(taxDoc.payload.vat.base).toBe(String(Number(order.platformFeeNet)));

        // The workflow unlock: M1 → the dispatcher-1 queue state, SYSTEM actor.
        const statusArgs = mockWriteStatus.mock.calls[0][0];
        expect(statusArgs.applicationId).toBe('app-1');
        expect(statusArgs.toStatus).toBe('DOC_FEE_PAID');
        expect(statusArgs.actorRole).toBe('SYSTEM');

        // F-G4-64 §3.3 — the quotation is stamped for THIS milestone, with the
        // number of the document that was just issued, and OUTSIDE the
        // transaction asserted above (no `tx` handed over: a throw in there
        // would roll back every write this test just checked).
        expect(mockRecordPhaseInvoiced).toHaveBeenCalledTimes(1);
        const closeArgs = mockRecordPhaseInvoiced.mock.calls[0][0];
        expect(closeArgs.quotationId).toBe('qt-1');
        expect(closeArgs.milestone).toBe('M1');
        expect(closeArgs.invoiceNumber).toBe('TAX-PRD-2026-000001');
        expect(closeArgs.tx).toBeUndefined();
    });

    test('M2 settlement unlocks the dispatcher-2 queue state', async () => {
        const order = pendingOrder({
            milestone: 'M2',
            application: { id: 'app-1', status: 'PENDING_AUDIT_FEE', applicationNumber: 'APP-2026-000001' },
        });
        mockDb.checkoutOrder.findFirst.mockResolvedValue(order);
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ ...order, ...data }));
        mockAllocate.mockResolvedValue({ number: 'X-1' });

        await settleFromPaymentIntent({
            paymentIntent: { id: 'pi_1', amount_received: 588500, metadata: { checkoutOrderId: 'co-1' } },
            eventId: 'evt_2',
        });

        expect(mockWriteStatus.mock.calls[0][0].toStatus).toBe('AUDIT_FEE_PAID');
    });

    test('an amount mismatch is an alert, NOT a settlement', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue(pendingOrder());

        const result = await settleFromPaymentIntent({
            paymentIntent: { id: 'pi_1', amount_received: 100, metadata: { checkoutOrderId: 'co-1' } },
            eventId: 'evt_3',
        });

        expect(result.settled).toBe(false);
        expect(result.reason).toBe('AMOUNT_MISMATCH');
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
        expect(mockRecordPaymentEntry).not.toHaveBeenCalled();
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });

    test('an already-settled order is an idempotent no-op', async () => {
        mockDb.checkoutOrder.findFirst.mockResolvedValue(pendingOrder({ status: 'SETTLED' }));

        const result = await settleFromPaymentIntent({
            paymentIntent: { id: 'pi_1', amount_received: 588500, metadata: { checkoutOrderId: 'co-1' } },
            eventId: 'evt_4',
        });

        expect(result.settled).toBe(true);
        expect(result.alreadySettled).toBe(true);
        expect(mockRecordPaymentEntry).not.toHaveBeenCalled();
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });
});

describe('the webhook route — verify, dedup, dispatch', () => {
    const express = require('express');
    const request = require('supertest');

    function buildApp() {
        const webhookRouter = require('../../routes/api/webhooks/stripe');
        const app = express();
        // Mirror server.js: express.json with the rawBody capture hook.
        app.use(express.json({
            verify: (req, _res, buf) => { if (buf && buf.length) { req.rawBody = buf; } },
        }));
        app.use('/api/v1/webhooks', webhookRouter);
        return app;
    }

    test('an invalid signature is a 400 with zero side effects', async () => {
        mockConstructEvent.mockImplementation(() => { throw new Error('bad signature'); });

        const res = await request(buildApp())
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 't=1,v1=bad')
            .send({ id: 'evt_x' });

        expect(res.status).toBe(400);
        expect(mockDb.stripeWebhookEvent.create).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
    });

    test('a redelivered event id is a 200 no-op (insert-first dedup)', async () => {
        mockConstructEvent.mockReturnValue({
            id: 'evt_dup', type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_1', metadata: {} } },
        });
        mockDb.stripeWebhookEvent.create.mockRejectedValue(
            Object.assign(new Error('unique'), { code: 'P2002' }),
        );
        // Task 4: a P2002 alone is not a no-op — the route re-checks the
        // stored row's status. Only an already-PROCESSED row is a true
        // duplicate; this test's "no-op" premise needs that row.
        mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_dup', status: 'PROCESSED' });

        const res = await request(buildApp())
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 't=1,v1=ok')
            .send({ id: 'evt_dup' });

        expect(res.status).toBe(200);
        expect(res.body.duplicate).toBe(true);
        expect(mockDb.checkoutOrder.findFirst).not.toHaveBeenCalled();
    });

    test('payment_intent.succeeded settles and stamps the event processed', async () => {
        const event = {
            id: 'evt_ok', type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_1', amount_received: 588500, metadata: { checkoutOrderId: 'co-1' } } },
        };
        mockConstructEvent.mockReturnValue(event);
        mockDb.stripeWebhookEvent.create.mockResolvedValue({ id: 'evt_ok' });
        // settleEvent(eventId) (Task 3) re-loads the event row by id rather
        // than trusting the live `event` param — so the stored payload must
        // mirror what the dedup insert above wrote.
        mockDb.stripeWebhookEvent.findUnique.mockResolvedValue({
            id: 'evt_ok', status: 'RECEIVED', attempts: 0, payload: event,
        });
        const order = pendingOrder();
        mockDb.checkoutOrder.findFirst.mockResolvedValue(order);
        mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ ...order, ...data }));
        mockAllocate.mockResolvedValue({ number: 'X-1' });

        const res = await request(buildApp())
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 't=1,v1=ok')
            .send({ id: 'evt_ok' });
        // Task 4: the route ACKs before settling — settleEvent is kicked via
        // setImmediate, not awaited in the request path. Drain one more
        // check-phase turn so the (fully mocked, synchronously-resolving)
        // settle chain finishes before asserting on its side effects.
        await new Promise((resolve) => setImmediate(resolve));

        expect(res.status).toBe(200);
        expect(mockDb.checkoutOrder.update.mock.calls[0][0].data.status).toBe('SETTLED');
        const stamp = mockDb.stripeWebhookEvent.update.mock.calls[0][0];
        expect(stamp.where.id).toBe('evt_ok');
        expect(stamp.data.processedAt).toBeInstanceOf(Date);
    });

    test('an unrelated event type is acknowledged without settling anything', async () => {
        mockConstructEvent.mockReturnValue({
            id: 'evt_other', type: 'charge.refunded', data: { object: {} },
        });
        mockDb.stripeWebhookEvent.create.mockResolvedValue({ id: 'evt_other' });

        const res = await request(buildApp())
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 't=1,v1=ok')
            .send({ id: 'evt_other' });

        expect(res.status).toBe(200);
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
    });
});

describe('handleStripeEvent — failure and cancellation paths', () => {
    test('payment_intent.payment_failed records the failure without touching the order state', async () => {
        mockDb.stripeWebhookEvent.create.mockResolvedValue({ id: 'evt_f' });
        mockDb.paymentTransaction.update.mockResolvedValue({});
        mockDb.checkoutOrder.findFirst.mockResolvedValue(pendingOrder());

        const result = await handleStripeEvent({
            id: 'evt_f', type: 'payment_intent.payment_failed',
            data: { object: { id: 'pi_1', last_payment_error: { message: 'card_declined' }, metadata: { checkoutOrderId: 'co-1' } } },
        });

        expect(result.handled).toBe(true);
        // The order stays PENDING_PAYMENT — the applicant can retry.
        expect(mockDb.checkoutOrder.update).not.toHaveBeenCalled();
    });
});
