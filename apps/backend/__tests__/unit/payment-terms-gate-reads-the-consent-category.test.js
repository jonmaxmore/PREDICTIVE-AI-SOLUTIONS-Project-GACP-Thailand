'use strict';
/**
 * F-G4-64, fix round 2 (reviewer, minor 5) — the payment-terms gate asks
 * consent-manager what the PAYMENT_TERMS category is called; it does not
 * remember.
 *
 * Failure this pins: consent-manager exports ConsentCategory and this repo's
 * rules explicitly sanction renaming a wrong name rather than hiding a right
 * value behind it ("name things correctly, don't keep legacy names"). If the
 * identifier is ever renamed, a gate that typed the string itself matches no
 * row, and BOTH rails then refuse every payment with PAYMENT_TERMS_NOT_ACCEPTED
 * with no test failing, because every fixture types the same string too. So the
 * category here is deliberately NOT the production one: only a gate that reads
 * the constant can pass.
 */

jest.mock('../../middleware/consent-manager', () => ({
    // A category name the gate cannot have memorised.
    ConsentCategory: Object.freeze({ PAYMENT_TERMS: 'PAYMENT_TERMS_RENAMED_BY_THIS_TEST' }),
    ConsentVersions: Object.freeze({ PAYMENT_TERMS: '1.0.0' }),
}));

const mockConsentFindFirst = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: { userConsent: { findFirst: (...a) => mockConsentFindFirst(...a) } },
}));

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
    assertPaymentTermsAccepted, PAYMENT_TERMS_CATEGORY,
} = require('../../services/billing/payment-terms-gate');
const { ConsentCategory } = require('../../middleware/consent-manager');

beforeEach(() => { jest.clearAllMocks(); });

describe('the consent category comes from consent-manager, not from a literal', () => {
    it('the exported category is ConsentCategory.PAYMENT_TERMS', () => {
        expect(PAYMENT_TERMS_CATEGORY).toBe(ConsentCategory.PAYMENT_TERMS);
    });

    it('the lookup queries the category consent-manager names', async () => {
        mockConsentFindFirst.mockResolvedValue({
            id: 'c1', version: '1.0.0', grantedAt: new Date('2026-08-28T03:00:00.000Z'),
        });

        await expect(assertPaymentTermsAccepted({ actorUserId: 'user-1' }))
            .resolves.toMatchObject({ version: '1.0.0' });

        expect(mockConsentFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                userId: 'user-1',
                category: ConsentCategory.PAYMENT_TERMS,
                granted: true,
            }),
        }));
    });
});
