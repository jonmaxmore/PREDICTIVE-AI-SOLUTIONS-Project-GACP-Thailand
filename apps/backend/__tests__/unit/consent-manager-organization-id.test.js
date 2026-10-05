'use strict';

/**
 * Regression: consentManager.recordConsent must persist UserConsent.organizationId.
 *
 * UserConsent.organizationId is a REQUIRED FK (ADR-014 multi-tenancy, no
 * default). recordConsent only receives a userId, and the create() omitted
 * organizationId — so every create threw Prisma "Argument organizationId is
 * missing", caught non-fatally by the registration controller. Result: PDPA
 * consent (COMP-006) was SILENTLY never written. Found via the prod carpet
 * audit (2026-06-05: "consent persist failed (PRIVACY_POLICY, non-fatal)").
 *
 * Fix resolves the org from the user; this test pins that the create payload
 * carries it.
 */

const captured = { createData: null };

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userConsent: {
            // F-QA-01: the findFirst → create|update pair became ONE upsert on
            // @@unique([userId, category]). `create` is the branch Postgres
            // takes when no row exists — the one that must carry organizationId.
            upsert: jest.fn(async ({ create }) => {
                captured.createData = create;
                return { id: 'consent-1', ...create };
            }),
        },
        user: {
            findUnique: jest.fn(async () => ({ organizationId: 'org-xyz' })),
        },
    },
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(undefined) },
    AuditCategory: { SECURITY: 'SECURITY' },
}));

const { consentManager } = require('../../middleware/consent-manager');

describe('consentManager.recordConsent — persists organizationId (PDPA COMP-006)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        captured.createData = null;
    });

    it('includes organizationId (resolved from the user) in the create payload', async () => {
        await consentManager.recordConsent(
            'user-1', 'TERMS_OF_SERVICE', true, '1.2.3.4', 'jest', { source: 'REGISTRATION' },
        );

        expect(captured.createData).not.toBeNull();
        expect(captured.createData.organizationId).toBe('org-xyz');
        expect(captured.createData).toMatchObject({
            userId: 'user-1',
            category: 'TERMS_OF_SERVICE',
            granted: true,
        });
    });

    it('throws a clear error when the user has no resolvable organization', async () => {
        const { prisma } = require('../../services/prisma-database');
        prisma.user.findUnique.mockResolvedValueOnce({ organizationId: null });

        await expect(
            consentManager.recordConsent('ghost', 'PRIVACY_POLICY', true, '1.2.3.4', 'jest'),
        ).rejects.toThrow(/organizationId/);
    });
});
