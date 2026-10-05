/**
 * BE-AUTH-03-03 — Session epoch: password change/reset evicts stolen tokens.
 *
 * Bug: a copied refresh token kept passing /refresh and minting fresh 24h
 * access + 7d refresh tokens even AFTER the victim changed/reset their
 * password (the JTI is never blocklisted; only the allowlist key is deleted).
 *
 * Fix = session epoch: changePassword (and, until 2026-09-17, resetPasswordWithToken) stamp
 * `User.sessionsRevokedAt = now()`. /refresh re-fetches the user and rejects
 * any RT whose `iat` predates the epoch (fail-CLOSED: re-fetch throw/null →
 * no mint). A post-change LOGIN still works (its new RT.iat > epoch).
 *
 * Covers:
 *   (a) RT with iat BEFORE sessionsRevokedAt → /refresh 401 REFRESH_TOKEN_REVOKED
 *   (b) RT with iat AFTER  sessionsRevokedAt (post-change login) → still mints
 *   (c) changePassword sets sessionsRevokedAt on the user update
 *   (d) user re-fetch failure (throw / null) → fail-closed (no mint)
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

// In-memory redis mock so the RT blocklist gate resolves its happy path.
// `mock`-prefixed so jest's mock-factory out-of-scope guard permits the ref.
const mockFakeStore = new Map();
// W1-5 (2026-08-22): the blocklist gates on /refresh read through the
// AUTHORITATIVE *Strict accessors, which reject when the store cannot
// answer (fail CLOSED) instead of returning null. A fake that omits them
// makes every refresh look like an outage and 401s. Healthy store here, so
// strict and cache reads agree; the outage cases are covered in
// __tests__/unit/redis-outage-fail-closed.test.js against the real service.
jest.mock('../../services/redis-service', () => ({
    get: jest.fn(async (key) => mockFakeStore.get(key) || null),
    set: jest.fn(async (key, value) => { mockFakeStore.set(key, value); return true; }),
    del: jest.fn(async (key) => { mockFakeStore.delete(key); return true; }),
    getStrict: jest.fn(async (key) => mockFakeStore.get(key) || null),
    setStrict: jest.fn(async (key, value) => { mockFakeStore.set(key, value); return true; }),
    delStrict: jest.fn(async (key) => { mockFakeStore.delete(key); return true; }),
    client: null,
}));

const { createAuthSessionSecurityHandlers } = require('../../controllers/auth-controller/auth-session-security-handlers');

function makeRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.clearCookie = jest.fn(() => res);
    return res;
}

function buildHandlers(overrides = {}) {
    return createAuthSessionSecurityHandlers({
        AuthService: {},
        auditLogger: { logAuth: jest.fn().mockResolvedValue(undefined) },
        jwtConfig: {
            loadJWTConfiguration: jest.fn(() => ({})),
            verifyRefreshToken: jest.fn(),
            generateToken: jest.fn(() => 'new-access-token'),
            generateRefreshToken: jest.fn(() => 'new-refresh-token'),
            ...overrides.jwtConfig,
        },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        sendErrorResponse: (res, _req, { status, code, message }) =>
            res.status(status).json({ success: false, code, error: message }),
        sendSuccessResponse: (res, _req, body) =>
            res.status(200).json({ success: true, ...body }),
        setAuthCookies: jest.fn(() => 'csrf-xyz'),
        // NEW injected dependency (defaults to a lazy prisma read in prod).
        fetchUserForSessionEpoch: overrides.fetchUserForSessionEpoch,
        ...overrides,
    });
}

const NOW_S = Math.floor(Date.now() / 1000);

describe('[BE-AUTH-03-03] /refresh session-epoch gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFakeStore.clear();
    });

    it('(a) rejects an RT whose iat predates sessionsRevokedAt → 401 REFRESH_TOKEN_REVOKED', async () => {
        // RT was issued at NOW-3600; the user changed their password 60s ago.
        const iat = NOW_S - 3600;
        const decoded = {
            id: 'victim-1',
            role: 'HEALTH',
            jti: 'jti-stolen',
            iat,
            exp: NOW_S + 3600,
        };
        const sessionsRevokedAt = new Date((NOW_S - 60) * 1000); // AFTER iat

        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'new-access-token'),
                generateRefreshToken: jest.fn(() => 'new-refresh-token'),
            },
            fetchUserForSessionEpoch: jest.fn(async () => ({ id: 'victim-1', status: 'ACTIVE', isDeleted: false, sessionsRevokedAt })),
        });

        const req = { body: { refreshToken: 'stolen-rt' }, cookies: {}, headers: { 'user-agent': 'jest' } };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REFRESH_TOKEN_REVOKED' }));
        expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' });
    });

    it('(b) allows an RT whose iat is AFTER sessionsRevokedAt (post-change re-login) → mints', async () => {
        // User changed password at NOW-3600, then re-logged in at NOW-60 → new RT.iat is fresh.
        const iat = NOW_S - 60;
        const decoded = {
            id: 'user-relogin',
            role: 'HEALTH',
            jti: 'jti-fresh',
            iat,
            exp: NOW_S + 3600,
        };
        const sessionsRevokedAt = new Date((NOW_S - 3600) * 1000); // BEFORE iat

        const genAccess = jest.fn(() => 'new-access-token');
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: genAccess,
                generateRefreshToken: jest.fn(() => 'new-refresh-token'),
            },
            fetchUserForSessionEpoch: jest.fn(async () => ({ id: 'user-relogin', status: 'ACTIVE', isDeleted: false, sessionsRevokedAt })),
        });

        const req = { body: { refreshToken: 'fresh-rt' }, cookies: {}, headers: { 'user-agent': 'jest' } };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(genAccess).toHaveBeenCalledTimes(1);
    });

    it('(b2) allows an RT when sessionsRevokedAt is NULL (never changed password) → mints', async () => {
        const decoded = { id: 'user-neverchanged', role: 'HEALTH', jti: 'jti-x', iat: NOW_S - 100, exp: NOW_S + 3600 };
        const genAccess = jest.fn(() => 'a');
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: genAccess,
                generateRefreshToken: jest.fn(() => 'r'),
            },
            fetchUserForSessionEpoch: jest.fn(async () => ({ id: 'user-neverchanged', status: 'ACTIVE', isDeleted: false, sessionsRevokedAt: null })),
        });
        const res = makeRes();
        await handlers.refreshToken({ body: { refreshToken: 'rt' }, cookies: {}, headers: {} }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(genAccess).toHaveBeenCalledTimes(1);
    });

    it('(d) fail-CLOSED: user re-fetch returns null → no mint (401)', async () => {
        const decoded = { id: 'ghost', role: 'HEALTH', jti: 'jti-ghost', iat: NOW_S - 100, exp: NOW_S + 3600 };
        const genAccess = jest.fn(() => 'a');
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: genAccess,
                generateRefreshToken: jest.fn(() => 'r'),
            },
            fetchUserForSessionEpoch: jest.fn(async () => null),
        });
        const res = makeRes();
        await handlers.refreshToken({ body: { refreshToken: 'rt' }, cookies: {}, headers: {} }, res);

        // MUST NOT mint. Rejection status (401/503), never 200.
        expect(genAccess).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(200);
        const statusArg = res.status.mock.calls[0][0];
        expect([401, 503]).toContain(statusArg);
    });

    it('(d2) fail-CLOSED: user re-fetch THROWS → no mint (401/503)', async () => {
        const decoded = { id: 'db-down', role: 'HEALTH', jti: 'jti-dbdown', iat: NOW_S - 100, exp: NOW_S + 3600 };
        const genAccess = jest.fn(() => 'a');
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: genAccess,
                generateRefreshToken: jest.fn(() => 'r'),
            },
            fetchUserForSessionEpoch: jest.fn(async () => { throw new Error('db unreachable'); }),
        });
        const res = makeRes();
        await handlers.refreshToken({ body: { refreshToken: 'rt' }, cookies: {}, headers: {} }, res);

        expect(genAccess).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(200);
        const statusArg = res.status.mock.calls[0][0];
        expect([401, 503]).toContain(statusArg);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// (c) changePassword stamps the epoch.
// Target the password-management service directly with a mocked prisma.
// ═══════════════════════════════════════════════════════════════════════
describe('[BE-AUTH-03-03] password-management stamps sessionsRevokedAt', () => {
    let prismaMock;
    let bcryptMock;
    let passwordManagement;

    beforeEach(() => {
        jest.resetModules();

        prismaMock = {
            user: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(async () => ({})),
            },
        };
        bcryptMock = {
            compare: jest.fn(async () => true),
            hash: jest.fn(async () => 'hashed-new'),
        };

        jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
        jest.doMock('bcryptjs', () => bcryptMock);
        jest.doMock('../../shared/logger', () => ({
            createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
        }));
        // Strong-password policy: allow the test password through.
        jest.doMock('../../utils/password-policy', () => ({
            validatePasswordStrength: () => ({ valid: true, errors: [] }),
        }));
        // Best-effort session revoke — stub so it never touches Redis.
        jest.doMock('../../services/token-revocation-service', () => ({
            revokeAllUserTokens: jest.fn(async () => undefined),
        }));

        passwordManagement = require('../../services/auth/password-management');
    });

    afterEach(() => {
        jest.dontMock('../../services/prisma-database');
        jest.dontMock('bcryptjs');
        jest.dontMock('../../utils/password-policy');
        jest.dontMock('../../services/token-revocation-service');
    });

    it('(c) changePassword sets sessionsRevokedAt on the update', async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: 'u-change',
            password: 'old-hash',
            healthId: '1234567890123',
            providerId: null,
        });

        await passwordManagement.changePassword('u-change', 'old-pw', 'NewPassw0rd!');

        expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
        const call = prismaMock.user.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'u-change' });
        expect(call.data.password).toBe('hashed-new');
        expect(call.data.sessionsRevokedAt).toBeInstanceOf(Date);
    });

    // (c2) was resetPasswordWithToken, removed 2026-09-17 (operator: no account
    // recovery). changePassword is the only password write left in this module.
});
