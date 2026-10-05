'use strict';

/**
 * SECURITY regression (auth audit 2026-06-11): mass-assignment privilege
 * escalation on the PUBLIC /auth/health/register endpoint.
 *
 * healthRegisterSchema uses `.passthrough()`, so a client could smuggle
 * privileged columns (role, ministryVerified, accountTier, status, …) past
 * validation; registerHealthUser spread `...body` and register()'s
 * `_resolveIdentity` reads `userData.role`, so POST /auth/health/register
 * with {"role":"ADMIN"} created a PROVIDER/ADMIN account (ACTIVE if
 * ENABLE_OCR_BYPASS). registerHealthUser now strips every authority/identity
 * field before calling register(). This test drives the REAL code path with a
 * mocked prisma and asserts the create payload can only ever be a HEALTH
 * applicant.
 */

const captured = { createData: null };

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        systemConfig: { findUnique: jest.fn().mockResolvedValue(null) }, // no OCR bypass row → env fallback (default off)
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

jest.mock('../../services/entity-service', () => ({
    ensurePersonalIndividualEntity: jest.fn().mockResolvedValue({ id: 'entity-1' }),
}));

const authService = require('../../services/prisma-auth-service');
const { CANONICAL_ROLES, normalizeRole } = require('../../shared/canonical-rbac');

describe('registerHealthUser() — public endpoint cannot mass-assign privilege', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        captured.createData = null;
        delete process.env.ENABLE_OCR_BYPASS;
    });

    const baseBody = {
        identifier: '1234567890121', // valid Mod-11
        healthId: '1234567890121',
        firstName: 'mallory',
        lastName: 'attacker',
        phoneNumber: '0890000009',
        password: 'AttackPass123!',
        acceptedTermsOfService: true,
        acceptedPrivacyPolicy: true,
    };

    it('ignores a smuggled role=ADMIN — the account is HEALTH, not a provider', async () => {
        const res = await authService.registerHealthUser({ ...baseBody, role: 'ADMIN' });

        expect(res.status).toBe(201);
        expect(captured.createData).not.toBeNull();
        // The security property, asserted independently of spelling: whatever
        // the client smuggled, the stored role normalizes to HEALTH and to
        // nothing privileged. PR 2e changed the stored spelling from the legacy
        // 'HEALTH' to canonical 'health'; pinning either literal would let a
        // future writer regression read as a spelling change.
        expect(normalizeRole(captured.createData.role)).toBe(CANONICAL_ROLES.HEALTH);
        expect(captured.createData.role).toBe(CANONICAL_ROLES.HEALTH);
        for (const privileged of ['admin', 'platform_admin', 'auditor', 'document_reviewer', 'scheduler']) {
            expect(normalizeRole(captured.createData.role)).not.toBe(privileged);
        }
        // a HEALTH user keeps healthId and has NO providerId
        expect(captured.createData.healthId).toBe('1234567890121');
        expect(captured.createData.providerId).toBeNull();
        // accountType stays the forced INDIVIDUAL, never PROVIDER
        expect(captured.createData.accountType).toBe('INDIVIDUAL');
    });

    it('ignores smuggled ministryVerified / accountTier / status / verificationStatus', async () => {
        await authService.registerHealthUser({
            ...baseBody,
            ministryVerified: true,
            accountTier: 'PREMIUM',
            status: 'ACTIVE',
            verificationStatus: 'VERIFIED',
            organizationId: 'attacker-org',
        });

        const d = captured.createData;
        // ministryVerified/accountTier are not set by the client (undefined or schema default — never the smuggled true/PREMIUM)
        expect(d.ministryVerified).not.toBe(true);
        expect(d.accountTier).not.toBe('PREMIUM');
        // status is server-derived (OCR bypass off → PENDING_VERIFICATION), never the client's ACTIVE
        expect(d.status).toBe('PENDING_VERIFICATION');
        // organization is the default tenant, not the attacker's
        expect(d.organizationId).toBe('org-default');
    });

    it('still creates a normal HEALTH applicant from a clean body', async () => {
        const res = await authService.registerHealthUser({ ...baseBody });
        expect(res.status).toBe(201);
        expect(captured.createData).toMatchObject({
            firstName: 'mallory',
            lastName: 'attacker',
            role: CANONICAL_ROLES.HEALTH,
            accountType: 'INDIVIDUAL',
            healthId: '1234567890121',
            organizationId: 'org-default',
        });
    });
});
