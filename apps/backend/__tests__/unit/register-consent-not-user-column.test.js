'use strict';

/**
 * Regression: PDPA consent booleans must NOT reach prisma.user.create().
 *
 * COMP-006 made healthRegisterSchema REQUIRE acceptedTermsOfService /
 * acceptedPrivacyPolicy. register() spreads `...identity.userData` into
 * prisma.user.create({ data }), and those two keys are NOT User columns —
 * so every real registration threw Prisma "Unknown argument" and surfaced as
 * a generic REGISTER_FAILED 500. (The existing COMP-006 test stubbed
 * registerHealthUser entirely, so it never exercised this path.)
 *
 * _sanitizeInput now strips the consent keys. This test drives the REAL
 * register() with a mocked prisma and asserts the create payload is clean.
 */

const captured = { createData: null };

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        // _resolveVerificationStatus: no system_config table → caught → env fallback.
        $queryRaw: jest.fn().mockRejectedValue(new Error('relation "system_config" does not exist')),
        organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-default' }) },
        user: { update: jest.fn() },
        $transaction: jest.fn(async (cb) => cb({
            user: {
                create: jest.fn(async ({ data }) => {
                    captured.createData = data;
                    return { id: 'user-1', status: data.status, healthId: data.healthId };
                }),
            },
        })),
    },
}));

// Isolate the personal-entity creation — not under test here.
jest.mock('../../services/entity-service', () => ({
    ensurePersonalIndividualEntity: jest.fn().mockResolvedValue({ id: 'entity-1' }),
}));

const authService = require('../../services/prisma-auth-service');

describe('register() — PDPA consent fields are not persisted as User columns', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        captured.createData = null;
    });

    const payloadWithConsent = {
        accountType: 'INDIVIDUAL',
        identifier: '1234567890121', // valid Mod-11
        healthId: '1234567890121',
        firstName: 'diag',
        lastName: 'valid',
        phoneNumber: '0890000009',
        password: 'DiagPass123!',
        // The keys that broke registration:
        acceptedTermsOfService: true,
        acceptedPrivacyPolicy: true,
        acceptedConsent: true,
    };

    it('does not pass acceptedTermsOfService / acceptedPrivacyPolicy / acceptedConsent to user.create', async () => {
        await authService.register({ ...payloadWithConsent });

        expect(captured.createData).not.toBeNull();
        expect(captured.createData).not.toHaveProperty('acceptedTermsOfService');
        expect(captured.createData).not.toHaveProperty('acceptedPrivacyPolicy');
        expect(captured.createData).not.toHaveProperty('acceptedConsent');
    });

    it('still persists the real User fields', async () => {
        await authService.register({ ...payloadWithConsent });

        expect(captured.createData).toMatchObject({
            firstName: 'diag',
            lastName: 'valid',
            phoneNumber: '0890000009',
            healthId: '1234567890121',
            organizationId: 'org-default',
        });
    });

    it('resolves successfully (no Prisma "Unknown argument" throw)', async () => {
        await expect(authService.register({ ...payloadWithConsent })).resolves.toMatchObject({ id: 'user-1' });
    });
});
