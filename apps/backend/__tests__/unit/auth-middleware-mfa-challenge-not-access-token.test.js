/**
 * PENTEST A1 — an MFA challenge / purpose-scoped token is NOT an access token.
 *
 * The `mfa_session` challenge (shared/mfa-challenge-binding.js) and the provider
 * `mfa_setup` token are signed with the SAME per-portal secret + audience as a
 * real access token; only the `purpose` claim distinguishes them. Before the fix,
 * authenticateHealth / authenticateProvider / authenticateAny verified the
 * signature+aud and attached req.user WITHOUT inspecting `purpose`, so a
 * password-only attacker on a 2FA-enabled account could replay the challenge
 * token as a full session — a total 2FA bypass.
 *
 * These tests assert every access-token middleware hard-rejects a purpose-bearing
 * token (401 INVALID_TOKEN, next NOT called) while a normal token clears the
 * purpose gate. RED before the guard in auth-middleware.js, GREEN after.
 */

const jwt = require('jsonwebtoken');

process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

jest.mock('../../services/token-revocation-service', () => ({
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: jest.fn().mockResolvedValue({ healthId: null, providerId: null, status: 'ACTIVE', isDeleted: false }) },
    },
}));

const authMiddleware = require('../../middleware/auth-middleware');

function makeReqRes(token, opts = {}) {
    const req = {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cookies: opts.cookies || {},
        path: '/test',
        originalUrl: '/test',
    };
    const res = {};
    res.status = jest.fn(function () { return this; });
    res.json = jest.fn(function () { return this; });
    return { req, res };
}

function signToken(payload, type = 'public') {
    const secret = type === 'provider' ? process.env.PROVIDER_JWT_SECRET : process.env.HEALTH_JWT_SECRET;
    return jwt.sign(
{ tokenType: 'access', ...payload }, secret, {
        algorithm: 'HS256',
        issuer: 'gacp-backend',
        audience: type === 'provider' ? 'gacp-provider' : 'gacp-health',
        expiresIn: '5m',
        jwtid: 'jti-' + Math.random().toString(36).slice(2),
    });
}

describe('PENTEST A1 — mfa_challenge token is not an access token', () => {
    beforeEach(() => jest.clearAllMocks());

    test('authenticateHealth rejects a health mfa_challenge token (2FA bypass closed)', async () => {
        const challenge = signToken({ id: 'user-1', purpose: 'mfa_challenge', method: 'EMAIL' }, 'public');
        const { req, res } = makeReqRes(challenge);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    });

    test('authenticateProvider rejects a provider purpose-scoped (mfa_setup) token', async () => {
        const setup = signToken({ id: 'staff-1', purpose: 'mfa_setup' }, 'provider');
        const { req, res } = makeReqRes(setup, { cookies: { provider_token: setup } });
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('authenticateAny (provider branch) rejects a provider mfa_challenge token', async () => {
        const challenge = signToken({ id: 'staff-2', purpose: 'mfa_challenge' }, 'provider');
        const { req, res } = makeReqRes(challenge, { cookies: { provider_token: challenge } });
        const next = jest.fn();
        await authMiddleware.authenticateAny(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('authenticateAny (health branch) rejects a health mfa_challenge token', async () => {
        const challenge = signToken({ id: 'user-3', purpose: 'mfa_challenge', method: 'EMAIL' }, 'public');
        const { req, res } = makeReqRes(challenge, { cookies: { auth_token: challenge } });
        const next = jest.fn();
        await authMiddleware.authenticateAny(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('a NORMAL health access token (no purpose) clears the purpose gate', async () => {
        // No purpose claim → must NOT be rejected by the purpose guard. It proceeds
        // past the guard (may 401 later for other reasons in this mocked env, but
        // NOT with the purpose-reject path — asserted by reaching next() or a
        // non-purpose failure). Here the mocked DB returns a healthy row so it
        // reaches next().
        const normal = signToken({ id: 'user-ok', role: 'HEALTH', canonicalRole: 'HEALTH' }, 'public');
        const { req, res } = makeReqRes(normal);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
