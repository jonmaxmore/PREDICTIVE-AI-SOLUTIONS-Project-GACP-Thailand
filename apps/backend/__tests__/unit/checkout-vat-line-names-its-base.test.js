'use strict';

/**
 * The VAT line item on a checkout invoice names the base it is 7% of.
 *
 * F-G4-54 (2026-08-27). The line read 'ภาษีมูลค่าเพิ่ม 7% (ของค่าบริการแพลตฟอร์ม)' while the
 * amount next to it was 7% of the WHOLE ค่าบริการ, state fee plus platform fee (W14, operator
 * ruling 2026-08-22; modules/billing/internal/fee-service.js). The demo invoices showed
 * 1,155 = 7% × 16,500 under a caption that said the base was the platform fee alone. A tax
 * line whose words and number disagree is a wrong invoice. The amount was right; the caption
 * changes.
 *
 * Mocks follow stripe-checkout-engine.test.js.
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

// F-G4-64: a checkout now runs the acceptance gate first. The mock must carry a
// real ACCEPTED row whose frozen figures MATCH the decomposition asserted below,
// or the drift check refuses and this suite would "fail in the shape of a
// working policy" while proving nothing about the VAT caption.
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
    invoiceLineItem: { createMany: jest.fn(async () => ({ count: 3 })) },
    paymentTransaction: { create: jest.fn(), update: jest.fn() },
    // Both gates are fail-closed: a missing model raises a TypeError inside the
    // gate, which is caught and re-thrown as a refusal, so a stale mock looks
    // exactly like a working policy (synthesis 5.7).
    quotation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    userConsent: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb) => cb(mockDb)),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { createCheckoutForApplication } = require('../../services/checkout/stripe-checkout-service');
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

/** The accepted quotation for this application: phase 1 at one scope, W14 figures. */
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
    mockDb.$transaction.mockImplementation(async (cb) => cb(mockDb));
    mockDb.invoiceLineItem.createMany.mockResolvedValue({ count: 3 });
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: acceptedQuotation() });
    mockDb.userConsent.findFirst.mockResolvedValue({
        id: 'consent-1',
        version: ConsentVersions.PAYMENT_TERMS,
        granted: true,
        grantedAt: new Date('2026-08-28T03:00:00.000Z'),
    });
    mockDb.checkoutOrder.findFirst.mockResolvedValue(null);
    mockDb.checkoutOrder.create.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
    mockDb.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
    mockDb.paymentTransaction.create.mockImplementation(async ({ data }) => ({ id: 'pt-1', ...data }));
    mockDb.checkoutOrder.update.mockImplementation(async ({ data }) => ({ id: 'co-1', ...data }));
    mockIntentCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });
});

test('the VAT line names the base its amount was computed on', async () => {
    await createCheckoutForApplication({
        applicationId: 'app-1',
        milestone: 'M1',
        actor: { id: 'user-1', holderScope: { userId: 'user-1', readIds: ['ent-1'], editIds: ['ent-1'] }, healthId: 'HID-1' },
    });

    const lines = mockDb.invoiceLineItem.createMany.mock.calls[0][0].data;
    const vat = lines.find((l) => l.code === 'PLATFORM_VAT');

    // 7% × 5,500 ค่าบริการ = 385 at one scope.
    expect(vat.amount).toBe(385);
    // The caption has been wrong twice and fixed twice, and both times for the
    // same reason: it named a base the amount was not computed on.
    //   'ค่าธรรมเนียมกรม + ค่าแพลตฟอร์ม' — the farmer pays the company, not a
    //     department fee (W14, operator 2026-08-22)
    //   'ราคาเต็ม + ค่าแพลตฟอร์ม'        — a sum of two components that stopped
    //     existing when the split was retired (operator 2026-09-11)
    // What this test is FOR is unchanged: the caption must name the base.
    // There is one base now, so it names one thing.
    // fix/fee-line-descriptions (operator 2026-10-03): the catalogue's wording,
    // "คิดจากค่าบริการทั้งจำนวน" — the whole service fee is the base.
    expect(vat.description).toBe('ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน');
    expect(vat.description).not.toContain('ค่าแพลตฟอร์ม');
    expect(vat.description).not.toContain('ราคาเต็ม');
    // And the base it names is the amount on the only other line.
    const service = lines.find((l) => l.code === 'PLATFORM_FEE');
    expect(Math.round(service.amount * 0.07)).toBe(vat.amount);
});
