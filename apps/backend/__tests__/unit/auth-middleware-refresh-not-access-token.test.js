/**
 * TASK-2 — a REFRESH token must not authenticate as an ACCESS token.
 *
 * generateRefreshToken (config/jwt-security.js) signs with the SAME secret,
 * issuer and audience as generateToken, and carries the FULL login payload
 * (id/role/canonicalRole/organizationId) plus `tokenType:'refresh'`. It carries
 * NO `purpose` claim, so the old rejectPurposeScopedToken guard let it straight
 * through: `Authorization: Bearer <refresh token>` was a full 7-day session
 * that survived /logout and /refresh rotation (both write the RT jti to the
 * `auth:rt-blocklist:` namespace, while the access path reads `auth:blocklist:`).
 *
 * RED before classifyTokenForAccessPath(), GREEN after.
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

const jwtConfig = require('../../config/jwt-security');
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

const LOGIN_PAYLOAD = {
    id: 'user-rt-1',
    role: 'HEALTH',
    canonicalRole: 'health',
    userType: 'HEALTH_ID',
    organizationId: 'org-default',
    sessionFamilyId: 'fam-1',
};

describe('TASK-2 — refresh token replayed on the access path', () => {
    const ORIGINAL_GRACE = process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
    });
    afterAll(() => {
        if (ORIGINAL_GRACE === undefined) {
            delete process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
        } else {
            process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL = ORIGINAL_GRACE;
        }
    });

    test('the refresh token verifies against the ACCESS verifier (same secret/iss/aud)', () => {
        const rt = jwtConfig.generateRefreshToken({ ...LOGIN_PAYLOAD }, 'public');
        const decoded = jwtConfig.verifyToken(rt, 'public');
        expect(decoded.tokenType).toBe('refresh');
        expect(decoded.purpose).toBeUndefined();
        expect(typeof decoded.jti).toBe('string');
    });

    test('authenticateHealth REJECTS a refresh token presented as a Bearer access token', async () => {
        const rt = jwtConfig.generateRefreshToken({ ...LOGIN_PAYLOAD }, 'public');
        const { req, res } = makeReqRes(rt);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    });

    test('authenticateHealth REJECTS a refresh token supplied via the auth_token cookie', async () => {
        const rt = jwtConfig.generateRefreshToken({ ...LOGIN_PAYLOAD }, 'public');
        const { req, res } = makeReqRes(null, { cookies: { auth_token: rt } });
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('authenticateAny (health branch) REJECTS a refresh token', async () => {
        const rt = jwtConfig.generateRefreshToken({ ...LOGIN_PAYLOAD }, 'public');
        const { req, res } = makeReqRes(rt, { cookies: { auth_token: rt } });
        const next = jest.fn();
        await authMiddleware.authenticateAny(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('authenticateProvider REJECTS a provider-signed refresh token', async () => {
        const rt = jwtConfig.generateRefreshToken(
            { ...LOGIN_PAYLOAD, role: 'AUDITOR', canonicalRole: 'auditor' },
            'provider',
        );
        const { req, res } = makeReqRes(rt, { cookies: { provider_token: rt } });
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('the refresh token is rejected EVEN INSIDE the legacy-untyped grace window', async () => {
        // The grace tolerates an ABSENT tokenType only — never an explicit
        // non-access one. This is what makes the fix safe to ship on day one.
        process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL = '2099-01-01T00:00:00Z';
        const rt = jwtConfig.generateRefreshToken({ ...LOGIN_PAYLOAD }, 'public');
        const { req, res } = makeReqRes(rt);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('a NORMAL access token still authenticates (no regression)', async () => {
        const at = jwtConfig.generateToken({ ...LOGIN_PAYLOAD }, 'public');
        const { req, res } = makeReqRes(at);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('a legacy UNTYPED access token still authenticates inside the grace window', async () => {
        process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL = '2099-01-01T00:00:00Z';
        const legacy = jwt.sign({ ...LOGIN_PAYLOAD }, process.env.HEALTH_JWT_SECRET, {
            algorithm: 'HS256',
            issuer: 'gacp-backend',
            audience: 'gacp-health',
            expiresIn: '1h',
            jwtid: 'legacy-jti-1',
        });
        const { req, res } = makeReqRes(legacy);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('a legacy UNTYPED access token is rejected once the grace window has expired', async () => {
        process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL = '2020-01-01T00:00:00Z';
        const legacy = jwt.sign({ ...LOGIN_PAYLOAD }, process.env.HEALTH_JWT_SECRET, {
            algorithm: 'HS256',
            issuer: 'gacp-backend',
            audience: 'gacp-health',
            expiresIn: '1h',
            jwtid: 'legacy-jti-2',
        });
        const { req, res } = makeReqRes(legacy);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
