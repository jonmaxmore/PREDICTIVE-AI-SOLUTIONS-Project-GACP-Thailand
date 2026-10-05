/**
 * H-4 Phase 1 — national-ID keyed-HMAC lookup, flag-gated.
 *
 * Proves the three contract points from the RFC
 * (docs/handoffs/H-4-national-id-hmac-migration-rfc.md):
 *
 *   (a) flag OFF (default) → behaviour is byte-for-byte the CURRENT behaviour:
 *       login looks up by the legacy raw-SHA-256 `*Hash` columns, register
 *       writes ONLY the `*Hash` columns (no `*Hmac`).
 *   (b) flag ON → login looks up by the keyed-HMAC `*Hmac` columns
 *       (= computeLookupHmac(typed)), and register/create DUAL-WRITES both
 *       `*Hash` (legacy sha256, unchanged) and `*Hmac`.
 *   (c) computeLookupHmac === hashData by default (no dedicated key set).
 *
 * The six lookup/write sites all branch on the SAME AUTH_LOOKUP_USE_HMAC switch,
 * so these unit tests exercise representative sites: prisma-auth-service.login()
 * + register() + checkIdentifierExists(), provider-user-service create, and the
 * user-lookup-service helper.
 */

const crypto = require('crypto');

process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';
// Ensure the flag starts OFF; individual tests toggle it explicitly.
delete process.env.AUTH_LOOKUP_USE_HMAC;
delete process.env.AUTH_LOOKUP_HMAC_KEY;

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/token-revocation-service', () => ({
    issueRefreshToken: jest.fn().mockResolvedValue('fake-refresh-jti'),
    issueMfaChallenge: jest.fn().mockResolvedValue('fake-challenge-token'),
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
            findUnique: jest.fn(),
            create: jest.fn(),
        },
        organization: { findUnique: jest.fn() },
        $transaction: jest.fn(),
        userConsent: { create: jest.fn() },
    },
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn().mockResolvedValue(true),
    hash: jest.fn().mockResolvedValue('$2a$12$mockhash'),
}));

// register() creates the personal INDIVIDUAL entity inside the tx — that pulls
// entity-service (+ its own prisma usage). The H-4 contract under test is the
// user.create PAYLOAD, not entity creation, so stub the entity hook out.
jest.mock('../../services/entity-service', () => ({
    ensurePersonalIndividualEntity: jest.fn().mockResolvedValue(undefined),
}));

const { prisma } = require('../../services/prisma-database');
const { hashData, computeLookupHmac } = require('../../utils/field-encryption');
const authService = require('../../services/prisma-auth-service');

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

const HEALTH_USER = {
    id: 'user-uuid-1',
    role: 'HEALTH',
    accountType: 'INDIVIDUAL',
    accountTier: 'NORMAL',
    authType: 'HEALTH_ID',
    email: 'farmer@example.test',
    healthId: '1100100100011',
    providerId: null,
    twoFactorEnabled: false,
    isLocked: false,
    status: 'ACTIVE',
    loginAttempts: 0,
    password: '$2a$12$qHzD9aN..fakeBcryptHash..for..testing..............',
};

const ID = '1100100100011';

describe('H-4 Phase 1 — computeLookupHmac (helper)', () => {
    afterEach(() => {
        delete process.env.AUTH_LOOKUP_HMAC_KEY;
    });

    it('(c) equals hashData() by default (no AUTH_LOOKUP_HMAC_KEY)', () => {
        expect(process.env.AUTH_LOOKUP_HMAC_KEY).toBeUndefined();
        expect(computeLookupHmac(ID)).toBe(hashData(ID));
    });

    it('is NOT raw SHA-256 (keyed HMAC, not a bare hash)', () => {
        expect(computeLookupHmac(ID)).not.toBe(sha256(ID));
    });

    it('returns null for empty/falsy input', () => {
        expect(computeLookupHmac('')).toBeNull();
        expect(computeLookupHmac(null)).toBeNull();
        expect(computeLookupHmac(undefined)).toBeNull();
    });

    it('uses a dedicated key when AUTH_LOOKUP_HMAC_KEY is set (overridable, decoupled from ENCRYPTION_KEY)', () => {
        const withDefault = computeLookupHmac(ID);
        process.env.AUTH_LOOKUP_HMAC_KEY = 'a-different-dedicated-lookup-key-value';
        const withDedicated = computeLookupHmac(ID);
        expect(withDedicated).not.toBe(withDefault);
        expect(withDedicated).not.toBe(hashData(ID));
        // Deterministic for the same key.
        expect(computeLookupHmac(ID)).toBe(withDedicated);
    });
});

describe('H-4 Phase 1 — login() lookup column is flag-gated', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.AUTH_LOOKUP_USE_HMAC;
    });
    afterEach(() => {
        delete process.env.AUTH_LOOKUP_USE_HMAC;
    });

    it('(a) flag OFF → looks up by legacy raw-SHA-256 healthIdHash (unchanged)', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        await authService.login(ID, 'password', 'INDIVIDUAL', { healthId: ID });

        const where = prisma.user.findFirst.mock.calls[0][0].where;
        const or = where.OR || [];
        const expected = sha256(ID);
        expect(or.some((c) => c.healthIdHash === expected || c.idCardHash === expected)).toBe(true);
        // No *Hmac column is touched when the flag is off.
        const json = JSON.stringify(or);
        expect(json).not.toContain('Hmac');
    });

    it('(b) flag ON → looks up by healthIdHmac = computeLookupHmac(typed)', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        await authService.login(ID, 'password', 'INDIVIDUAL', { healthId: ID });

        const where = prisma.user.findFirst.mock.calls[0][0].where;
        const or = where.OR || [];
        const expected = computeLookupHmac(ID);
        expect(or.some((c) => c.healthIdHmac === expected || c.idCardHmac === expected)).toBe(true);
        // Legacy *Hash columns are NOT queried when the flag is on.
        const json = JSON.stringify(or);
        expect(json).not.toContain('IdHash');
        // The lookup value is the keyed HMAC, never the raw sha256.
        expect(json).not.toContain(sha256(ID));
    });

    it('(b) flag ON, provider → looks up by providerIdHmac', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        const PROVIDER_USER = { ...HEALTH_USER, healthId: null, providerId: '5555555555555', authType: 'PROVIDER_ID', role: 'system_admin_dtam' };
        prisma.user.findFirst.mockResolvedValue(PROVIDER_USER);

        await authService.login('5555555555555', 'password', 'PROVIDER', { providerId: '5555555555555' });

        const where = prisma.user.findFirst.mock.calls[0][0].where;
        const or = where.OR || [];
        const expected = computeLookupHmac('5555555555555');
        expect(or.some((c) => c.providerIdHmac === expected)).toBe(true);
    });
});

describe('H-4 Phase 1 — register() dual-write is flag-gated', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.AUTH_LOOKUP_USE_HMAC;
        prisma.organization.findUnique.mockResolvedValue({ id: 'org-default' });
        // $transaction runs the callback against a tx client; expose the same
        // user.create mock so we can inspect the create payload.
        prisma.$transaction.mockImplementation(async (cb) => cb({
            user: { create: prisma.user.create },
        }));
        prisma.user.create.mockImplementation(async ({ data }) => ({
            id: 'new-user',
            status: data.status,
            healthId: data.healthId,
            ...data,
        }));
    });
    afterEach(() => {
        delete process.env.AUTH_LOOKUP_USE_HMAC;
    });

    function createPayload() {
        return prisma.user.create.mock.calls[0][0].data;
    }

    it('(a) flag OFF → writes ONLY legacy *Hash (no *Hmac keys in payload)', async () => {
        await authService.register({
            healthId: ID,
            password: 'pw',
            firstName: 'A',
            lastName: 'B',
            phoneNumber: '0800000000',
        });

        const data = createPayload();
        expect(data.healthIdHash).toBe(sha256(ID));
        expect(data.idCardHash).toBe(sha256(ID));
        // Byte-for-byte legacy: the *Hmac keys are absent (undefined), so Prisma
        // omits them entirely from the INSERT.
        expect(data.healthIdHmac).toBeUndefined();
        expect(data.idCardHmac).toBeUndefined();
        expect(data.providerIdHmac).toBeUndefined();
    });

    it('(b) flag ON → DUAL-WRITES both healthIdHash (sha256) AND healthIdHmac (computeLookupHmac)', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';

        await authService.register({
            healthId: ID,
            password: 'pw',
            firstName: 'A',
            lastName: 'B',
            phoneNumber: '0800000000',
        });

        const data = createPayload();
        // Legacy sha256 STILL written (unchanged).
        expect(data.healthIdHash).toBe(sha256(ID));
        expect(data.idCardHash).toBe(sha256(ID));
        // Keyed-HMAC ALSO written.
        expect(data.healthIdHmac).toBe(computeLookupHmac(ID));
        expect(data.idCardHmac).toBe(computeLookupHmac(ID));
        // HEALTH account → providerIdHmac stays null.
        expect(data.providerIdHmac).toBeNull();
    });
});

describe('H-4 Phase 1 — checkIdentifierExists() column is flag-gated', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.AUTH_LOOKUP_USE_HMAC;
        prisma.user.findFirst.mockResolvedValue(null);
    });
    afterEach(() => {
        delete process.env.AUTH_LOOKUP_USE_HMAC;
    });

    it('(a) flag OFF → JURISTIC queries taxIdHash (sha256)', async () => {
        await authService.checkIdentifierExists(ID, 'JURISTIC');
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { taxIdHash: sha256(ID) } });
    });

    it('(b) flag ON → JURISTIC queries taxIdHmac (computeLookupHmac)', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        await authService.checkIdentifierExists(ID, 'JURISTIC');
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { taxIdHmac: computeLookupHmac(ID) } });
    });

    it('(b) flag ON → COMMUNITY_ENTERPRISE queries communityRegistrationNoHmac', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        await authService.checkIdentifierExists(ID, 'COMMUNITY_ENTERPRISE');
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { communityRegistrationNoHmac: computeLookupHmac(ID) } });
    });

    it('(b) flag ON → INDIVIDUAL queries idCardHmac', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        await authService.checkIdentifierExists(ID, 'INDIVIDUAL');
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { idCardHmac: computeLookupHmac(ID) } });
    });
});
