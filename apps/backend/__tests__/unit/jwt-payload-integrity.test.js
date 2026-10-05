/**
 * [Sprint6] JWT Payload Integrity
 *
 * Asserts the Sprint 6 healthId-audit invariant: JWTs do not carry plaintext
 * Thai national IDs. See `docs/handoffs/healthid-audit-sprint-6/00-team-meeting-summary.md`
 * Phase B-C1 / M1.
 */

const jwt = require('jsonwebtoken');

// Mock secrets BEFORE requiring anything that consumes them.
process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/token-revocation-service', () => ({
    issueRefreshToken: jest.fn().mockResolvedValue('fake-refresh-jti'),
    blocklistAccessToken: jest.fn().mockResolvedValue(undefined),
    revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
    issueMfaChallenge: jest.fn().mockResolvedValue('fake-challenge-token'),
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
    // Closing-review (2026-05-15): canonical column is twoFactorEnabled.
    // The legacy `mfaEnabled` is still accepted by the auth service as a
    // safety fallback (prisma-auth-service.js:366), but the canonical
    // schema column (auth.prisma:116) is what real DB reads will return.
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
const jwtConfig = require('../../config/jwt-security');

describe('[Sprint6] JWT Payload Integrity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('login() returns access + refresh tokens whose payload omits healthId and providerId', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);
        prisma.user.update.mockResolvedValue(undefined);

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
        });

        expect(result.token).toBeDefined();
        const decoded = jwt.decode(result.token);
        expect(decoded).toBeDefined();
        expect(decoded.id).toBe('user-uuid-1');
        // The Sprint 6 invariant — no plaintext national ID in the access token payload.
        expect(decoded.healthId).toBeUndefined();
        expect(decoded.providerId).toBeUndefined();
        expect(decoded.idCard).toBeUndefined();

        const decodedRefresh = jwt.decode(result.refreshToken);
        expect(decodedRefresh.healthId).toBeUndefined();
        expect(decodedRefresh.providerId).toBeUndefined();
    });

    it('JWT carries only non-PII identity claims (id, role, canonicalRole, accountType, authType, email)', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });
        const decoded = jwt.decode(result.token);

        // Allowed claims
        expect(decoded.id).toBe('user-uuid-1');
        expect(decoded.canonicalRole).toBe('health');
        expect(decoded.accountType).toBe('INDIVIDUAL');
        expect(decoded.authType).toBe('HEALTH_ID');

        // Disallowed claims — none of these may appear in the payload.
        for (const piiField of ['healthId', 'providerId', 'idCard', 'taxId', 'communityRegistrationNo']) {
            expect(decoded[piiField]).toBeUndefined();
        }
    });

    it('access token carries a `jti` claim (Sprint 6 C-1 dependency for blocklist revocation)', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });
        const decoded = jwt.decode(result.token);

        expect(decoded.jti).toBeDefined();
        expect(typeof decoded.jti).toBe('string');
        expect(decoded.jti.length).toBeGreaterThanOrEqual(16);
    });

    it('refresh token jti equals the JTI registered in the allowlist (Sprint 6 C-2)', async () => {
        const { issueRefreshToken } = require('../../services/token-revocation-service');
        issueRefreshToken.mockResolvedValue('jti-from-redis-allowlist');
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });
        const decodedRefresh = jwt.decode(result.refreshToken);

        expect(decodedRefresh.jti).toBe('jti-from-redis-allowlist');
    });

    it('[Sprint7-IssueB] both access and refresh tokens carry a non-empty sessionFamilyId', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });

        const access = jwt.decode(result.token);
        const refresh = jwt.decode(result.refreshToken);

        expect(typeof access.sessionFamilyId).toBe('string');
        expect(access.sessionFamilyId.length).toBeGreaterThanOrEqual(16);
        // Both tokens minted in the same login must share the family ID
        // (a single family represents the device tree from this login).
        expect(refresh.sessionFamilyId).toBe(access.sessionFamilyId);
    });

    it('[Sprint7-IssueB] each login mints a DIFFERENT sessionFamilyId', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);

        const a = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });
        const b = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });

        const aFamily = jwt.decode(a.token).sessionFamilyId;
        const bFamily = jwt.decode(b.token).sessionFamilyId;

        expect(aFamily).toBeDefined();
        expect(bFamily).toBeDefined();
        expect(aFamily).not.toBe(bFamily);
    });

    it('signed access token verifies back to a payload with no healthId field', async () => {
        prisma.user.findFirst.mockResolvedValue(HEALTH_USER);
        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });

        // Round-trip via verify — same payload shape.
        const config = jwtConfig.loadJWTConfiguration();
        const verified = jwtConfig.verifyToken(result.token, 'public', config);
        expect(verified.healthId).toBeUndefined();
        expect(verified.providerId).toBeUndefined();
        expect(verified.id).toBe('user-uuid-1');
    });

    it('MFA-enabled login does NOT issue tokens at all (returns mfaRequired + method, no token)', async () => {
        prisma.user.findFirst.mockResolvedValue({ ...HEALTH_USER, twoFactorEnabled: true });

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });

        expect(result.mfaRequired).toBe(true);
        // login() no longer emits the opaque issueMfaChallenge token (it was an
        // unverifiable dead-end); the JWT mfa_session is minted by the caller.
        // login() returns the method so the caller knows which factor to challenge.
        expect(result.twoFactorMethod).toBe('TOTP');
        expect(result.challengeToken).toBeUndefined();
        // The security invariant: NO access/refresh token is issued at the password stage.
        expect(result.token).toBeUndefined();
        expect(result.refreshToken).toBeUndefined();
    });

    it('Legacy `mfaEnabled` fallback still triggers MFA gate when canonical `twoFactorEnabled` is unset', async () => {
        // Retro-QA fix M3 (2026-05-15): the legacy fallback in
        // `prisma-auth-service.js:366` reads `user.twoFactorEnabled ||
        // user.mfaEnabled`. The CLOSING-REVIEW NEW-1 static-source test
        // only checks the source text contains `user.twoFactorEnabled` —
        // it never exercised the runtime path where the user row carries
        // ONLY the legacy `mfaEnabled` field (which can happen during the
        // migration window or for accounts created against an older
        // backend version). Without this behavioral test, accidentally
        // removing the `|| user.mfaEnabled` fallback would silently let
        // legacy-flag users bypass MFA at login.
        prisma.user.findFirst.mockResolvedValue({
            ...HEALTH_USER,
            twoFactorEnabled: undefined,
            mfaEnabled: true,
        });

        const result = await authService.login('1100100100011', 'password', 'INDIVIDUAL', {
            healthId: '1100100100011',
        });

        expect(result.mfaRequired).toBe(true);
        expect(result.token).toBeUndefined();
    });
});
