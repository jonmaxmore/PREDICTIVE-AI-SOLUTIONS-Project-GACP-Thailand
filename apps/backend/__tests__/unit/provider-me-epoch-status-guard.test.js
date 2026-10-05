/**
 * Wave-3 follow-up — GET /auth/provider/me must enforce session-epoch + status.
 *
 * /me verifies the JWT INLINE (not via authenticateProvider), so before this
 * fix it skipped BOTH the session-epoch gate and the status/isDeleted check:
 * a disabled / demoted / password-changed staffer whose token predates their
 * sessionsRevokedAt still got 200 with their profile. Every ACTION route is
 * gated by authenticateProvider (which DOES check), so this was profile-only —
 * but /me should tell the truth. Now it rejects an evicted or inactive token.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockVerifyToken = jest.fn();
jest.mock('../../config/jwt-security', () => ({
    loadJWTConfiguration: jest.fn(() => ({})),
    verifyToken: (...a) => mockVerifyToken(...a),
    // Only token VERIFICATION is stubbed. The access-path classifier is the real
    // implementation so this suite cannot pass against a decision the production
    // code does not actually make.
    classifyTokenForAccessPath:
        jest.requireActual('../../config/jwt-security').classifyTokenForAccessPath,
}));

const mockFindById = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    findProviderUserById: (...a) => mockFindById(...a),
}));

const mockIsBlocklisted = jest.fn();
jest.mock('../../services/token-revocation-service', () => ({
    isAccessTokenBlocklisted: (...a) => mockIsBlocklisted(...a),
}));

const authProviderRouter = require('../../routes/api/auth/auth-provider');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth/provider', authProviderRouter);
    return app;
}

// iat is epoch SECONDS. Base token minted "now".
const NOW_SEC = Math.floor(Date.now() / 1000);
// `tokenType: 'access'` mirrors what generateToken() stamps on every access
// token — see config/jwt-security.js. Without it these fixtures would be
// legacy untyped tokens, which is a different case (covered in
// provider-me-token-class-guard.test.js), not the epoch/status case under test.
function decoded(overrides = {}) {
    return { id: 'prov-1', jti: 'jti-1', iat: NOW_SEC, tokenType: 'access', ...overrides };
}
function user(overrides = {}) {
    return {
        id: 'prov-1', providerId: '1234567890123', email: 'a@b.co',
        firstName: 'ก', lastName: 'ข', role: 'AUDITOR', authType: 'PROVIDER_ID',
        status: 'ACTIVE', isDeleted: false, sessionsRevokedAt: null,
        ministryVerified: true, ...overrides,
    };
}

describe('GET /auth/provider/me — epoch + status guard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsBlocklisted.mockResolvedValue(false);
    });

    // Authorization header (the app has no cookie-parser; the handler reads
    // `req.headers.authorization?.split(' ')[1] || req.cookies?.provider_token`).
    const call = () => request(buildApp()).get('/auth/provider/me').set('Authorization', 'Bearer t');

    test('active user, no epoch → 200', async () => {
        mockVerifyToken.mockReturnValue(decoded());
        mockFindById.mockResolvedValue(user());
        const res = await call();
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe('prov-1');
    });

    test('token minted BEFORE sessionsRevokedAt → 401 (epoch eviction)', async () => {
        mockVerifyToken.mockReturnValue(decoded({ iat: NOW_SEC - 3600 }));
        mockFindById.mockResolvedValue(user({ sessionsRevokedAt: new Date((NOW_SEC - 60) * 1000) }));
        const res = await call();
        expect(res.status).toBe(401);
    });

    test('INACTIVE user → 401 (disabled staffer)', async () => {
        mockVerifyToken.mockReturnValue(decoded());
        mockFindById.mockResolvedValue(user({ status: 'INACTIVE' }));
        const res = await call();
        expect(res.status).toBe(401);
    });

    test('soft-deleted user → 401', async () => {
        mockVerifyToken.mockReturnValue(decoded());
        mockFindById.mockResolvedValue(user({ isDeleted: true }));
        const res = await call();
        expect(res.status).toBe(401);
    });

    // wave1/honest-limits review: /me kept its own sentence ("...กรุณาติดต่อผู้ดูแลระบบ")
    // after the login door and the middleware moved to the catalogue row. The web
    // client ends the session on the code either way, but any other client shows
    // this body, and there is no account recovery — the user contacts DTAM staff.
    test.each([
        ['INACTIVE', { status: 'INACTIVE' }],
        ['soft-deleted', { isDeleted: true }],
    ])('%s user → 401 ACCOUNT_INACTIVE with the catalogue sentence', async (_label, overrides) => {
        const row = require('../../shared/error-codes').lookup('ACCOUNT_INACTIVE');
        mockVerifyToken.mockReturnValue(decoded());
        mockFindById.mockResolvedValue(user(overrides));
        const res = await call();
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        expect(res.body.messageTh).toBe(row.messageTh);
        expect(res.body.message).toBe(`${row.messageTh} / ${row.messageEn}`);
        expect(JSON.stringify(res.body)).not.toMatch(/ผู้ดูแลระบบ|administrator/);
    });

    test('token minted AFTER sessionsRevokedAt (fresh re-login) → 200', async () => {
        mockVerifyToken.mockReturnValue(decoded({ iat: NOW_SEC }));
        mockFindById.mockResolvedValue(user({ sessionsRevokedAt: new Date((NOW_SEC - 60) * 1000) }));
        const res = await call();
        expect(res.status).toBe(200);
    });

    // Verify F1: /logout blocklists the jti in Redis, and authenticateProvider
    // consults it on every ACTION route — /me must too, or a logged-out
    // token keeps returning a 200 profile until exp.
    test('blocklisted jti (logged-out token) → 401 TOKEN_REVOKED', async () => {
        mockVerifyToken.mockReturnValue(decoded());
        mockFindById.mockResolvedValue(user());
        mockIsBlocklisted.mockResolvedValue(true);
        const res = await call();
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_REVOKED');
        expect(mockIsBlocklisted).toHaveBeenCalledWith('jti-1');
    });

    test('blocklist read failure → fail-open 200 (matches middleware policy)', async () => {
        mockVerifyToken.mockReturnValue(decoded());
        mockFindById.mockResolvedValue(user());
        mockIsBlocklisted.mockRejectedValue(new Error('redis down'));
        const res = await call();
        expect(res.status).toBe(200);
    });
});
