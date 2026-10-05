'use strict';

/**
 * S4 (adversarial verify 2026-07-08): PAYMENT_TERMS is a CONTRACTUAL
 * acknowledgment (พ.ร.บ.คุ้มครองข้อมูลฯ มาตรา 24(3) contract basis), not an
 * optional PDPA consent — it is the disclosure-before-payment EVIDENCE the Q4
 * no-refund policy stands on. Withdrawal (DELETE /consent/PAYMENT_TERMS or
 * POST granted:false) would overwrite the single UserConsent row (grantedAt
 * nulled, version replaced), destroying that evidence after money moved.
 * recordConsent is the single chokepoint: granted:false for PAYMENT_TERMS is
 * rejected, which covers both the POST route and withdrawConsent.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userConsent: {
            // F-QA-01: one upsert on @@unique([userId, category]) replaced the
            // findFirst → create|update pair. The create branch is what a fresh
            // grant takes.
            upsert: jest.fn(async ({ create }) => ({ id: 'consent-1', ...create })),
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

describe('S4 — PAYMENT_TERMS acknowledgment is non-withdrawable', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('recordConsent(granted:false) for PAYMENT_TERMS is rejected with PAYMENT_TERMS_NOT_WITHDRAWABLE', async () => {
        await expect(
            consentManager.recordConsent('user-1', 'PAYMENT_TERMS', false, '1.2.3.4', 'jest'),
        ).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_WITHDRAWABLE' });
    });

    it('withdrawConsent for PAYMENT_TERMS is rejected (routes through the same chokepoint)', async () => {
        await expect(
            consentManager.withdrawConsent('user-1', 'PAYMENT_TERMS', '1.2.3.4', 'jest'),
        ).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_WITHDRAWABLE' });
    });

    it('granting PAYMENT_TERMS still works', async () => {
        const consent = await consentManager.recordConsent('user-1', 'PAYMENT_TERMS', true, '1.2.3.4', 'jest');
        expect(consent).toMatchObject({ category: 'PAYMENT_TERMS', granted: true });
    });

    it('withdrawing an OPTIONAL consent (MARKETING_EMAIL) is unaffected', async () => {
        const result = await consentManager.withdrawConsent('user-1', 'MARKETING_EMAIL', '1.2.3.4', 'jest');
        expect(result).toMatchObject({ category: 'MARKETING_EMAIL', granted: false });
    });
});
