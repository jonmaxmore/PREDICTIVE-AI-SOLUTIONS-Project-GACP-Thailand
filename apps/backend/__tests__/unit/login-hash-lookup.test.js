/**
 * [Sprint6] Login Hash-First Lookup (M5)
 *
 * Sprint 6 healthId-audit Phase B-M5: login() now queries `healthIdHash` /
 * `providerIdHash` / `idCardHash` (SHA-256 of the cleaned numeric ID) instead of
 * the plaintext columns. This is the preparation step for the eventual schema
 * migration that drops the plaintext columns (Phase D-H4/H5).
 */

const crypto = require('crypto');

process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/token-revocation-service', () => ({
    issueRefreshToken: jest.fn().mockResolvedValue('fake-refresh-jti'),
    issueMfaChallenge: jest.fn().mockResolvedValue('fake-challenge-token'),
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
}));

const HEALTH_USER = {
    id: 'user-uuid-1',
    role: 'HEALTH',
    accountType: 'INDIVIDUAL',
    accountTier: 'NORMAL',
    authType: 'HEALTH_ID',
    email: 'farmer@example.test',
    healthId: '1100100100011',
    providerId: null,
    // Closing-review (2026-05-15): canonical column is twoFactorEnabled
    // (auth.prisma:116). Legacy `mfaEnabled` remains as a safety fallback.
    twoFactorEnabled: false,
    isLocked: false,
    status: 'ACTIVE',
    loginAttempts: 0,
    password: '$2a$12$qHzD9aN..fakeBcryptHash..for..testing..............',
};

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
            findUnique: jest.fn(),
        },
        $transaction: jest.fn(),
        userConsent: { create: jest.fn() },
    },
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn().mockResolvedValue(true),
    hash: jest.fn().mockResolvedValue('$2a$12$mockhash'),
}));

const { prisma } = require('../../services/prisma-database');
const authService = require('../../services/prisma-auth-service');

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

describe('[Sprint6] Login Hash-First Lookup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('login with 13-digit healthId queries `healthIdHash` (not plaintext `healthId`)', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });

        expect(prisma.user.findFirst).toHaveBeenCalled();
        const whereArg = prisma.user.findFirst.mock.calls[0][0].where;
        expect(whereArg).toBeDefined();
        const orClauses = whereArg.OR || [];

        // At least one OR clause must be a healthIdHash match for the SHA-256 of the input.
        const expectedHash = sha256('1100100100011');
        const hasHashClause = orClauses.some(
            (clause) => clause.healthIdHash === expectedHash || clause.idCardHash === expectedHash,
        );
        expect(hasHashClause).toBe(true);

        // No plaintext healthId clause should appear in the OR list.
        const hasPlaintextClause = orClauses.some(
            (clause) => clause.healthId === '1100100100011',
        );
        expect(hasPlaintextClause).toBe(false);
    });

    it('login with an email is REJECTED — national-ID-only (owner directive 2026-06-11)', async () => {
        // Email is no longer a login credential. login() short-circuits a
        // non-13-digit identifier to "Invalid credentials" BEFORE any DB query.
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        await expect(
            authService.login('farmer@example.test', 'password', 'INDIVIDUAL', {}),
        ).rejects.toThrow(/Invalid credentials/i);

        // No lookup should ever be issued for an email identifier.
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('login with provider auth queries `providerIdHash`', async () => {
        const PROVIDER_USER = { ...HEALTH_USER, healthId: null, providerId: '5555555555555', authType: 'PROVIDER_ID', role: 'system_admin_dtam' };
        prisma.user.findFirst.mockResolvedValue(PROVIDER_USER);

        await authService.login('5555555555555', 'password', 'PROVIDER', {
            providerId: '5555555555555',
        });

        const whereArg = prisma.user.findFirst.mock.calls[0][0].where;
        const orClauses = whereArg.OR || [];
        const expectedHash = sha256('5555555555555');
        const hasProviderHashClause = orClauses.some(
            (clause) => clause.providerIdHash === expectedHash,
        );
        expect(hasProviderHashClause).toBe(true);
    });

    it('hash lookup returning null user throws "Invalid credentials"', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        await expect(
            authService.login('1100100100011', 'password', 'INDIVIDUAL', { healthId: '1100100100011' }),
        ).rejects.toThrow(/Invalid credentials/i);
    });

    it('non-13-digit identifier is rejected with no DB query (national-ID-only)', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        await expect(
            authService.login('not-a-thai-id@example.test', 'password', 'INDIVIDUAL', {}),
        ).rejects.toThrow(/Invalid credentials/i);

        // A non-13-digit identifier never reaches the user lookup.
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
});
