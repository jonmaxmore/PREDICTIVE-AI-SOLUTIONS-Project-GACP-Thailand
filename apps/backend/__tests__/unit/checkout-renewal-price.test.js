'use strict';

/**
 * M2 — a renewal paid through the card/checkout rail must be charged the
 * RENEWAL price, not the phase-2 price.
 *
 * Operator rulings (the change log 2026-08-22, 67ef3612 / 8b8d581f / eabfc020):
 *   - a renewal is ONE charge of 30,000 state fee PER CULTIVATION SCOPE;
 *   - service fee = state + 10% platform, payable = service fee + 7% VAT on
 *     the whole service fee -> 35,310 per scope (70,620 / 105,930 for 2 / 3).
 *
 * A renewal enters the workflow at PENDING_AUDIT_FEE
 * (services/renewal-service.js:232), which is a PAYABLE_STATES.M2 state
 * (services/checkout/stripe-checkout-service.js:41). So the ONLY milestone a
 * renewal can reach checkout with is M2 — and breakdownForMilestone priced M2
 * from fees.phase2 (25,000 state -> 29,425 payable), short by 5,885 per scope.
 *
 * quotation-service already prices a renewal correctly and deliberately maps
 * the single charge onto the PHASE_2 / M2 slot (services/quotation-service.js:
 * 271-300) so settlement (M2 -> AUDIT_FEE_PAID) needs no change. The checkout
 * rail must agree with the quotation it is collecting against.
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

const mockIntentCreate = jest.fn();
jest.mock('stripe', () => jest.fn(() => ({
    paymentIntents: { create: (...a) => mockIntentCreate(...a) },
    webhooks: { constructEvent: jest.fn() },
})));

// F-G4-64: a checkout now runs the acceptance gate first, and the charge is
// compared to the accepted snapshot to the satang. A renewal is quoted as a
// PHASE_2-ONLY instalment at the renewal price (quotation-service maps the
// single charge onto that slot), so the mock below must say exactly that or the
// drift check refuses the very case this suite exists to pin.
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
    invoice: { create: jest.fn() },
    invoiceLineItem: { createMany: jest.fn(async () => ({ count: 3 })) },
    paymentTransaction: { create: jest.fn() },
    // A missing model raises a TypeError inside a fail-closed gate, which is
    // caught and re-thrown as a refusal — a stale mock fails in the shape of a
    // working policy (synthesis 5.7).
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userConsent: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { createCheckoutForApplication } =
    require('../../services/checkout/stripe-checkout-service');
const { buildAcceptanceSnapshot } = require('../../services/quotation-service');
const { ConsentVersions } = require('../../middleware/consent-manager');

/** A renewal as renewal-service actually creates it. */
function renewalApplication({ scopes = ['outdoor'], status = 'PENDING_AUDIT_FEE' } = {}) {
    return {
        id: 'app-ren-1',
        applicationNumber: 'GACP-REN-2569-AB12CD',
        status,
        healthId: 'HID-1',
        organizationId: 'org-1',
        totalAreaTypes: scopes.length,
        formData: {
            cultivationMethods: scopes,
            // The marker renewal-service writes (services/renewal-service.js:334).
            renewalOf: 'cert-old-1',
            renewalOfCertificateNumber: 'GACP-TH-2568-000001',
            workflowEntryState: 'PENDING_AUDIT_FEE',
        },
    };
}

function newApplicationAtM2() {
    return {
        id: 'app-new-1',
        applicationNumber: 'APP-2026-000001',
        status: 'DOC_APPROVED',
        healthId: 'HID-1',
        organizationId: 'org-1',
        totalAreaTypes: 1,
        formData: { cultivationMethods: ['outdoor'] },
    };
}

/**
 * The accepted quotation for a phase-2 charge of `scopes` scopes at the given
 * per-scope ค่าบริการ: 33,000 for a renewal, 27,500 for a phase-2 instalment.
 * VAT = 7% of ค่าบริการ — the row's own frozen arithmetic, which is what the
 * drift check compares against.
 *
 * The argument was `statePerScope` (30,000 / 25,000) until 2026-09-11, and the
 * helper added a 10% platform cut on top. The operator retired that split, so
 * the declared rate IS ค่าบริการ and the helper stopped deriving it. Every
 * payable below is unchanged: 35,310 and 29,425 per scope.
 */
function armAcceptedPhase2Quotation({ scopes = 1, servicePerScope = 33000 } = {}) {
    const serviceFeeAmount = servicePerScope * scopes;
    const vatAmount = Math.round(serviceFeeAmount * 0.07);
    const row = {
        id: 'qt-ren-1',
        quotationNumber: 'QT-PRD-2026-000009',
        issuerType: 'PLATFORM',
        status: 'ACCEPTED',
        subtotal: String(serviceFeeAmount) + '.00',
        vat: String(vatAmount) + '.00',
        totalAmount: String(serviceFeeAmount + vatAmount) + '.00',
        validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        installments: [{
            phase: 'PHASE_2',
            amount: serviceFeeAmount + vatAmount,
            serviceFeeAmount,
            vatAmount,
            scopeCount: scopes,
        }],
    };
    mockFindQuotations.mockResolvedValue({
        dtam: null, platform: { ...row, acceptedSnapshot: buildAcceptanceSnapshot(row) },
    });
}

function armConsent() {
    mockDb.userConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        version: ConsentVersions.PAYMENT_TERMS,
        granted: true,
        grantedAt: new Date('2026-08-28T03:00:00.000Z'),
    });
}

function armMint() {
    armConsent();
    mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
    mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-r1', ...data }));
    mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-r1', ...data }));
    mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-r1', ...data }));
    mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-r1', ...data }));
    mockIntentCreate.mockResolvedValue({
        id: 'pi_r1', client_secret: 'pi_r1_secret', status: 'requires_payment_method',
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (cb) => cb(mockDb));
    mockDb.invoiceLineItem.createMany.mockResolvedValue({ count: 3 });
});

describe('M2 — renewal pricing on the checkout rail', () => {
    test('one scope: the renewal checkout charges 35,310, not the phase-2 29,425', async () => {
        mockDb.application.findFirst.mockResolvedValue(renewalApplication());
        armMint();
        armAcceptedPhase2Quotation({ scopes: 1, servicePerScope: 33000 });

        const result = await createCheckoutForApplication({
            applicationId: 'app-ren-1',
            milestone: 'M2',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        });

        // The breakdown since 2026-09-29: no DTAM figure at all — the whole
        // ค่าบริการ sits in platform_fee_net (the retired column is still written
        // 0 on the row below until the contract migration drops it). The charge
        // — 35,310 — is the same number the old 30,000 + 3,000 + 2,310 split
        // added up to.
        expect(result.breakdown).toEqual({
            platformFeeNet: 33000,
            platformFeeVat: 2310,
            platformFeeGross: 35310,
            totalPayableAmount: 35310,
        });

        // The row the DB CHECK sees, and the amount the gateway is asked for.
        const created = mockDb.checkoutOrder.create.mock.calls[0][0].data;
        expect(created.totalPayableAmount).toBe(35310);
        expect(created.platformFeeNet + created.platformFeeVat)
            .toBe(created.totalPayableAmount);
        expect(mockIntentCreate.mock.calls[0][0].amount).toBe(3531000);

        // The invoice must carry the same money, or the receipt disagrees
        // with the charge.
        const invoiceData = mockDb.invoice.create.mock.calls[0][0].data;
        expect(invoiceData.totalAmount).toBe(35310);
        expect(invoiceData.subtotal).toBe(33000);
        expect(invoiceData.vat).toBe(2310);
        const lines = mockDb.invoiceLineItem.createMany.mock.calls[0][0].data;
        // Two lines since 2026-09-11 — ค่าบริการ and its VAT. The third,
        // a 'STATE_FEE' line, would now print 0 baht under a caption that
        // says "ราคาเต็ม" on a document the applicant keeps.
        expect(lines).toHaveLength(2);
        expect(lines.find((l) => l.code === 'STATE_FEE')).toBeUndefined();
        expect(lines.find((l) => l.code === 'PLATFORM_FEE').amount).toBe(33000);
        expect(lines.find((l) => l.code === 'PLATFORM_VAT').amount).toBe(2310);
        expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(35310);
    });

    test('two and three scopes: 70,620 and 105,930', async () => {
        const cases = [
            [['outdoor', 'greenhouse'], 70620],
            [['outdoor', 'greenhouse', 'indoor'], 105930],
        ];
        for (const [scopes, expected] of cases) {
            jest.clearAllMocks();
            mockDb.$transaction.mockImplementation(async (cb) => cb(mockDb));
            mockDb.invoiceLineItem.createMany.mockResolvedValue({ count: 3 });
            mockDb.application.findFirst.mockResolvedValue(renewalApplication({ scopes }));
            armMint();
            armAcceptedPhase2Quotation({ scopes: scopes.length, servicePerScope: 33000 });

            const result = await createCheckoutForApplication({
                applicationId: 'app-ren-1',
                milestone: 'M2',
                actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
            });
            expect(result.breakdown.totalPayableAmount).toBe(expected);
            expect(mockIntentCreate.mock.calls[0][0].amount).toBe(expected * 100);
        }
    });

    test('a NON-renewal M2 is untouched: still 29,425 at one scope', async () => {
        mockDb.application.findFirst.mockResolvedValue(newApplicationAtM2());
        armMint();
        armAcceptedPhase2Quotation({ scopes: 1, servicePerScope: 27500 });

        const result = await createCheckoutForApplication({
            applicationId: 'app-new-1',
            milestone: 'M2',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        });

        expect(result.breakdown).toEqual({
            platformFeeNet: 27500,
            platformFeeVat: 1925,
            platformFeeGross: 29425,
            totalPayableAmount: 29425,
        });
    });

    test('a renewal is never billed a phase-1 instalment: CHECKOUT_RENEWAL_SINGLE_CHARGE', async () => {
        // Fix round 1 (reviewer, minor 4). This case used status DRAFT, which
        // F-G4-64 removed from PAYABLE_STATES.M1, so it stopped at the status
        // door and the assertion had to be loosened to /RENEWAL|NOT_PAYABLE/ -
        // leaving CHECKOUT_RENEWAL_SINGLE_CHARGE pinned by no test at all
        // (deleting the guard at stripe-checkout-service.js:179 would have left
        // every suite green). SUBMITTED IS M1-payable, so the request now walks
        // the whole path - status door, acceptance gate, terms gate, re-entry
        // lookup - and reaches breakdownForMilestone, where the renewal rule is
        // the refusal under test.
        mockDb.application.findFirst.mockResolvedValue(renewalApplication({ status: 'SUBMITTED' }));
        armMint();
        armAcceptedPhase2Quotation({ scopes: 1, servicePerScope: 33000 });

        await expect(createCheckoutForApplication({
            applicationId: 'app-ren-1',
            milestone: 'M1',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        })).rejects.toMatchObject({ code: 'CHECKOUT_RENEWAL_SINGLE_CHARGE', status: 409 });

        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });

    test('DRAFT is refused at the status door, before the renewal rule is reached', async () => {
        // The other half of the two-deep defence, kept as its own case so each
        // door is named by the test that proves it.
        mockDb.application.findFirst.mockResolvedValue(renewalApplication({ status: 'DRAFT' }));
        armMint();
        armAcceptedPhase2Quotation({ scopes: 1, servicePerScope: 33000 });

        await expect(createCheckoutForApplication({
            applicationId: 'app-ren-1',
            milestone: 'M1',
            actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
        })).rejects.toMatchObject({ code: 'CHECKOUT_MILESTONE_NOT_PAYABLE', status: 409 });

        expect(mockFindQuotations).not.toHaveBeenCalled();
        expect(mockDb.checkoutOrder.create).not.toHaveBeenCalled();
        expect(mockIntentCreate).not.toHaveBeenCalled();
    });
});

// fix/fee-line-descriptions (operator 2026-10-03): the line items stored for a NEW
// checkout invoice are named from the one catalogue (shared/instalment-service-names.js).
// A renewal's M2 is the renewal service, not "งวดที่ 2". Stored rows of older invoices
// are not rewritten; amounts are pinned unchanged here.
describe('stored line-item descriptions come from the catalogue', () => {
    const actor = { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' };

    test('renewal M2: ค่าบริการต่ออายุใบรับรอง + the VAT line names its base', async () => {
        mockDb.application.findFirst.mockResolvedValue(renewalApplication());
        armMint();
        armAcceptedPhase2Quotation({ scopes: 1, servicePerScope: 33000 });
        await createCheckoutForApplication({ applicationId: 'app-ren-1', milestone: 'M2', actor });
        const lines = mockDb.invoiceLineItem.createMany.mock.calls[0][0].data;
        expect(lines.map((l) => [l.code, l.description, l.amount])).toEqual([
            ['PLATFORM_FEE', 'ค่าบริการต่ออายุใบรับรอง', 33000],
            ['PLATFORM_VAT', 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน', 2310],
        ]);
    });

    test('new filing M2: งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง', async () => {
        mockDb.application.findFirst.mockResolvedValue(newApplicationAtM2());
        armMint();
        armAcceptedPhase2Quotation({ scopes: 1, servicePerScope: 27500 });
        await createCheckoutForApplication({ applicationId: 'app-new-1', milestone: 'M2', actor });
        const lines = mockDb.invoiceLineItem.createMany.mock.calls[0][0].data;
        expect(lines.map((l) => [l.code, l.description, l.amount])).toEqual([
            ['PLATFORM_FEE', 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง', 27500],
            ['PLATFORM_VAT', 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน', 1925],
        ]);
    });
});
