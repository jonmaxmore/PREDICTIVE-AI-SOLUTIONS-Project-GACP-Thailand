'use strict';

/**
 * F-QA-01 (deep-qa 2026-09-06) — capturing the two required PDPA consents at
 * registration used to cost 8 statements per category: findFirst, a user
 * lookup for an organizationId the caller already held, a create, and a whole
 * locked transaction for the CONSENT_GRANTED audit row. At a measured 364 ms
 * per round trip that is most of a 5.6 s registration.
 *
 * recordRegistrationConsents does the same work in one upsert per category and
 * hands the audit events back so the caller can write them in ONE batch.
 * What must NOT change: every required consent is still persisted, with its
 * version, its tenant, and an audit event per grant.
 */

const captured = { upserts: [] };

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userConsent: {
            upsert: jest.fn(async (args) => {
                captured.upserts.push(args);
                return { id: `consent-${args.create.category}`, ...args.create };
            }),
        },
        user: { findUnique: jest.fn(async () => ({ organizationId: 'org-from-lookup' })) },
    },
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(undefined), logMany: jest.fn().mockResolvedValue(0) },
    AuditCategory: { SECURITY: 'SECURITY' },
}));

const { consentManager, RequiredConsents } = require('../../middleware/consent-manager');
const { auditLogger } = require('../../middleware/audit-logger');
const { prisma } = require('../../services/prisma-database');

const call = (overrides = {}) => consentManager.recordRegistrationConsents({
    userId: 'user-1',
    organizationId: 'org-xyz',
    categories: RequiredConsents,
    ipAddress: '1.2.3.4',
    userAgent: 'jest',
    metadata: { source: 'REGISTRATION' },
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    captured.upserts = [];
});

describe('recordRegistrationConsents — every required consent, one write each', () => {
    it('persists one row per required category, granted, versioned, in the given tenant', async () => {
        const { consents, failures } = await call();

        expect(failures).toEqual([]);
        expect(consents).toHaveLength(RequiredConsents.length);
        expect(captured.upserts.map((a) => a.create.category)).toEqual(RequiredConsents);
        for (const args of captured.upserts) {
            expect(args.where).toEqual({ userId_category: { userId: 'user-1', category: args.create.category } });
            expect(args.create).toMatchObject({
                userId: 'user-1',
                organizationId: 'org-xyz',
                granted: true,
                ipAddress: '1.2.3.4',
            });
            expect(typeof args.create.version).toBe('string');
            expect(args.create.grantedAt).toBeInstanceOf(Date);
            expect(args.create.withdrawnAt).toBeNull();
            expect(JSON.parse(args.create.metadata)).toEqual({ source: 'REGISTRATION' });
        }
    });

    it('does not look the user up when the caller already knows the tenant', async () => {
        await call();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to resolving the tenant from the user when the caller does not know it', async () => {
        await call({ organizationId: undefined });

        expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(captured.upserts[0].create.organizationId).toBe('org-from-lookup');
    });

    it('returns one audit event per grant and writes NONE of them itself', async () => {
        const { auditEvents } = await call();

        expect(auditEvents).toHaveLength(RequiredConsents.length);
        expect(auditEvents.map((e) => e.action)).toEqual(RequiredConsents.map(() => 'CONSENT_GRANTED'));
        expect(auditEvents.map((e) => e.metadata.consentCategory)).toEqual(RequiredConsents);
        for (const event of auditEvents) {
            expect(event).toMatchObject({ category: 'SECURITY', actorId: 'user-1', resourceType: 'CONSENT' });
            expect(event.resourceId).toMatch(/^consent-/);
        }
        // The batching is the caller's to do — this method must stay silent.
        expect(auditLogger.log).not.toHaveBeenCalled();
        expect(auditLogger.logMany).not.toHaveBeenCalled();
    });

    it('one category failing does not lose the others their row or their audit event', async () => {
        prisma.userConsent.upsert.mockImplementationOnce(async () => { throw new Error('deadlock'); });

        const { consents, auditEvents, failures } = await call();

        expect(consents).toHaveLength(RequiredConsents.length - 1);
        expect(auditEvents).toHaveLength(RequiredConsents.length - 1);
        expect(failures).toHaveLength(1);
        expect(failures[0].category).toBe(RequiredConsents[0]);
    });

    it('a user with no resolvable organization is still a hard error, not a silent skip', async () => {
        prisma.user.findUnique.mockResolvedValueOnce({ organizationId: null });

        await expect(call({ organizationId: undefined })).rejects.toThrow(/organizationId/);
        expect(prisma.userConsent.upsert).not.toHaveBeenCalled();
    });
});

describe('recordConsent — the single-category door keeps its own audit write', () => {
    it('upserts once and writes exactly one audit event', async () => {
        await consentManager.recordConsent('user-1', 'MARKETING_EMAIL', true, '1.2.3.4', 'jest', {}, { organizationId: 'org-xyz' });

        expect(prisma.userConsent.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(auditLogger.log).toHaveBeenCalledTimes(1);
        expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONSENT_GRANTED' }));
    });

    it('a withdrawal writes CONSENT_WITHDRAWN and stamps withdrawnAt', async () => {
        await consentManager.recordConsent('user-1', 'MARKETING_EMAIL', false, '1.2.3.4', 'jest');

        const args = captured.upserts[0];
        expect(args.update.granted).toBe(false);
        expect(args.update.grantedAt).toBeNull();
        expect(args.update.withdrawnAt).toBeInstanceOf(Date);
        expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONSENT_WITHDRAWN' }));
    });
});
