/**
 * Tests for User Lookup Service.
 *
 * System deep-dive Tier 6 — Backend + Security + QA (2026-05-15).
 *
 * Covers:
 *   1. computeIdentifierHash format compatibility with production
 *      (raw SHA-256, NOT HMAC — see service-file header comment for why)
 *   2. findUserByHealthIdSecurely:
 *      - prefers healthIdHash over plaintext
 *      - falls back to plaintext for legacy rows where *Hash is NULL
 *      - respects isDeleted filter unless includeDeleted=true
 *      - returns null on empty/whitespace input without touching DB
 *      - accepts custom select + custom client (tx injection)
 *   3. findUserByProviderIdSecurely — same shape, providerIdHash column
 *   4. resolveUserIdFromHealthIdSecurely — returns just the ID string
 */

const crypto = require('crypto');
const path = require('path');

// H-4 Phase 1: these legacy-behaviour assertions are the flag-OFF baseline.
// Ensure no other suite leaked the flag into this worker's process.env.
delete process.env.AUTH_LOOKUP_USE_HMAC;

// Mock prisma BEFORE require so the service picks up our test client.
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(),
        },
    },
}));

const { prisma: mockPrisma } = require('../../services/prisma-database');
const { computeLookupHmac } = require('../../utils/field-encryption');

const {
    computeIdentifierHash,
    findUserByHealthIdSecurely,
    findUserByProviderIdSecurely,
    resolveUserIdFromHealthIdSecurely,
} = require(path.join(__dirname, '..', '..', 'services', 'user-lookup-service'));

beforeEach(() => {
    mockPrisma.user.findFirst.mockReset();
    delete process.env.AUTH_LOOKUP_USE_HMAC;
});

afterEach(() => {
    delete process.env.AUTH_LOOKUP_USE_HMAC;
});

describe('[Tier 6] computeIdentifierHash', () => {
    it('matches the canonical production format (raw SHA-256, no pepper, no HMAC key)', () => {
        // The production writer in prisma-auth-service.js:118 uses:
        //   crypto.createHash('sha256').update(actualIdCard).digest('hex')
        // This test anchors that the helper produces the SAME hash for the
        // SAME input — any drift will break lookups against existing rows.
        const plaintext = '1100100100011';
        const expected = crypto.createHash('sha256').update(plaintext).digest('hex');
        expect(computeIdentifierHash(plaintext)).toBe(expected);
    });

    it('trims whitespace before hashing', () => {
        const expected = crypto.createHash('sha256').update('1100100100011').digest('hex');
        expect(computeIdentifierHash('  1100100100011  ')).toBe(expected);
        expect(computeIdentifierHash('\t1100100100011\n')).toBe(expected);
    });

    it('returns null on empty/null/undefined input', () => {
        expect(computeIdentifierHash('')).toBeNull();
        expect(computeIdentifierHash('   ')).toBeNull();
        expect(computeIdentifierHash(null)).toBeNull();
        expect(computeIdentifierHash(undefined)).toBeNull();
    });

    // H-4 Phase 1 — when AUTH_LOOKUP_USE_HMAC=true the helper returns the keyed
    // HMAC (computeLookupHmac), matching the dual-write side in _generateHashes.
    it('returns the keyed HMAC when AUTH_LOOKUP_USE_HMAC=true (matches computeLookupHmac)', () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        const plaintext = '1100100100011';
        expect(computeIdentifierHash(plaintext)).toBe(computeLookupHmac(plaintext));
        // ...and is NOT the legacy raw SHA-256.
        expect(computeIdentifierHash(plaintext)).not.toBe(
            crypto.createHash('sha256').update(plaintext).digest('hex'),
        );
    });
});

describe('[H-4] findUserBy*Securely column is flag-gated', () => {
    it('flag ON → findUserByHealthIdSecurely queries healthIdHmac', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null) // step 0️⃣ canonicalId miss (real plaintext ID input)
            .mockResolvedValueOnce({ id: 'u-hmac' });

        await findUserByHealthIdSecurely('1100100100011');

        const where = mockPrisma.user.findFirst.mock.calls[1][0].where;
        expect(where.healthIdHmac).toBe(computeLookupHmac('1100100100011'));
        expect(where.healthIdHash).toBeUndefined();
    });

    it('flag ON → findUserByProviderIdSecurely queries providerIdHmac', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'staff-hmac' });

        await findUserByProviderIdSecurely('5555555555555');

        const where = mockPrisma.user.findFirst.mock.calls[0][0].where;
        expect(where.providerIdHmac).toBe(computeLookupHmac('5555555555555'));
        expect(where.providerIdHash).toBeUndefined();
    });
});

describe('[Tier 6] findUserByHealthIdSecurely', () => {
    it('prefers healthIdHash over plaintext WHERE when row exists with the hash (real plaintext ID: canonicalId misses first)', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null) // step 0️⃣ canonicalId miss (input is a real plaintext national ID)
            .mockResolvedValueOnce({ id: 'user-hash-match' });

        const result = await findUserByHealthIdSecurely('1100100100011');

        expect(result).toEqual({ id: 'user-hash-match' });
        expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);
        const hashCallArgs = mockPrisma.user.findFirst.mock.calls[1][0];
        expect(hashCallArgs.where.healthIdHash).toBe(
            crypto.createHash('sha256').update('1100100100011').digest('hex'),
        );
        expect(hashCallArgs.where.isDeleted).toBe(false);
        // The plaintext fallback was NOT invoked because the hash lookup hit.
    });

    it('falls back to plaintext WHERE when canonicalId + hash both miss (legacy row)', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null) // canonicalId miss
            .mockResolvedValueOnce(null) // hash lookup miss
            .mockResolvedValueOnce({ id: 'legacy-user' }); // plaintext hit

        const result = await findUserByHealthIdSecurely('1100100100011');

        expect(result).toEqual({ id: 'legacy-user' });
        expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(3);
        const thirdCall = mockPrisma.user.findFirst.mock.calls[2][0];
        expect(thirdCall.where.healthId).toBe('1100100100011');
        expect(thirdCall.where.isDeleted).toBe(false);
    });

    it('returns null when canonicalId, hash, and plaintext lookups all miss', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        const result = await findUserByHealthIdSecurely('1100100100011');
        expect(result).toBeNull();
        expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(3);
    });

    it('returns null without touching DB on empty/whitespace input', async () => {
        await expect(findUserByHealthIdSecurely('')).resolves.toBeNull();
        await expect(findUserByHealthIdSecurely('   ')).resolves.toBeNull();
        await expect(findUserByHealthIdSecurely(null)).resolves.toBeNull();
        await expect(findUserByHealthIdSecurely(undefined)).resolves.toBeNull();
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('respects includeDeleted=true by dropping the isDeleted filter (on every lookup path)', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null) // canonicalId miss
            .mockResolvedValueOnce({ id: 'soft-deleted-user' });

        await findUserByHealthIdSecurely('1100100100011', { includeDeleted: true });

        const canonicalCall = mockPrisma.user.findFirst.mock.calls[0][0];
        expect(canonicalCall.where).not.toHaveProperty('isDeleted');
        expect(canonicalCall.where.canonicalId).toBe('1100100100011');
        const hashCall = mockPrisma.user.findFirst.mock.calls[1][0];
        expect(hashCall.where).not.toHaveProperty('isDeleted');
        expect(hashCall.where.healthIdHash).toBeDefined();
    });

    it('passes the caller-provided select clause to Prisma', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'u1', email: 'a@b.test' });

        await findUserByHealthIdSecurely('1100100100011', { select: { id: true, email: true } });

        const firstCall = mockPrisma.user.findFirst.mock.calls[0][0];
        expect(firstCall.select).toEqual({ id: true, email: true });
    });

    it('uses the caller-provided client (e.g. tx) instead of the global', async () => {
        const txClient = {
            user: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'tx-user' }) },
        };

        const result = await findUserByHealthIdSecurely('1100100100011', { client: txClient });

        expect(result).toEqual({ id: 'tx-user' });
        expect(txClient.user.findFirst).toHaveBeenCalledTimes(1);
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
});

describe('[detokenize regression] findUserByHealthIdSecurely resolves the canonicalId TOKEN', () => {
    // Provider-E2E carpet 2026-07-09 (HIGH): after detokenize STAGE A,
    // Application.healthId is a keyed-HMAC TOKEN == User.canonicalId. Callers
    // (provider workflow handlers) pass that token; re-hashing it (hash step)
    // and the plaintext fallback BOTH miss, so the applicant was never resolved
    // and every workflow notification (pay-งวด2, REJECT, CAR, REVISION) was
    // silently dropped. The fix resolves by canonicalId FIRST.
    it('resolves a user by canonicalId on the FIRST lookup when passed the token', async () => {
        const token = 'bdc618b4fe26bcca58f84ac0b67e681ffedda32e5be51227fac23a34bce333cd';
        mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'applicant-42' });

        const result = await findUserByHealthIdSecurely(token);

        expect(result).toEqual({ id: 'applicant-42' });
        // ONE call — the canonicalId match short-circuits before re-hashing.
        expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
        expect(mockPrisma.user.findFirst.mock.calls[0][0].where.canonicalId).toBe(token);
    });

    it('resolveUserIdFromHealthIdSecurely returns the applicant id for a token (the dropped-notification path)', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'applicant-42' });
        await expect(resolveUserIdFromHealthIdSecurely('some-canonical-token')).resolves.toBe('applicant-42');
    });

    it('does NOT regress real plaintext national-ID lookups (canonicalId misses → hash path still used)', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null) // canonicalId miss (plaintext ID is not a canonicalId)
            .mockResolvedValueOnce({ id: 'login-user' }); // hash hit
        const result = await findUserByHealthIdSecurely('1100100100011');
        expect(result).toEqual({ id: 'login-user' });
        expect(mockPrisma.user.findFirst.mock.calls[1][0].where.healthIdHash).toBeDefined();
    });
});

describe('[Tier 6] findUserByProviderIdSecurely', () => {
    it('prefers providerIdHash over plaintext WHERE', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'staff-1' });

        const result = await findUserByProviderIdSecurely('DTAM-001');

        expect(result).toEqual({ id: 'staff-1' });
        expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(1);
        const firstCall = mockPrisma.user.findFirst.mock.calls[0][0];
        expect(firstCall.where.providerIdHash).toBe(
            crypto.createHash('sha256').update('DTAM-001').digest('hex'),
        );
    });

    it('falls back to plaintext for legacy providers with NULL providerIdHash', async () => {
        mockPrisma.user.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'legacy-staff' });

        const result = await findUserByProviderIdSecurely('DTAM-LEGACY');

        expect(result).toEqual({ id: 'legacy-staff' });
        expect(mockPrisma.user.findFirst.mock.calls[1][0].where.providerId).toBe('DTAM-LEGACY');
    });

    it('returns null on empty input without touching DB', async () => {
        await expect(findUserByProviderIdSecurely('')).resolves.toBeNull();
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
});

describe('[Tier 6] resolveUserIdFromHealthIdSecurely', () => {
    it('returns just the id string when a user is found', async () => {
        mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-x' });
        const result = await resolveUserIdFromHealthIdSecurely('1100100100011');
        expect(result).toBe('user-x');
    });

    it('returns null when no user is found', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        const result = await resolveUserIdFromHealthIdSecurely('1100100100011');
        expect(result).toBeNull();
    });

    it('returns null on empty input', async () => {
        await expect(resolveUserIdFromHealthIdSecurely('')).resolves.toBeNull();
        await expect(resolveUserIdFromHealthIdSecurely(null)).resolves.toBeNull();
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
});
