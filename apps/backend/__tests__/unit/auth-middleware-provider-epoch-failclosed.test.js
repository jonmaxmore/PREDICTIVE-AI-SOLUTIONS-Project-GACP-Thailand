/**
 * C4 (HIGH) — provider session-epoch eviction must fail CLOSED on a transient
 * DB read error.
 *
 * A provider has NO refresh token, so the post-verify DB epoch/identity check is
 * the ONLY eviction path. Today, when fetchIdentityFromDb throws (pool
 * timeout/failover → dbHealthy=false) the provider paths `next()` the user
 * through with their STALE role — a fired/demoted auditor could record
 * AUDIT_PASSED during the blip. Fail CLOSED (401, retry) for PRIVILEGED provider
 * roles; HEALTH keeps the availability keep-alive (its /refresh gate is the
 * authoritative eviction backstop).
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

const mockFindUnique = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: (...args) => mockFindUnique(...args) },
    },
}));

const authMiddleware = require('../../middleware/auth-middleware');

function makeReqRes(token, cookieName) {
    const cookies = cookieName ? { [cookieName]: token } : {};
    const req = { headers: { authorization: `Bearer ${token}` }, cookies, path: '/test' };
    const res = {
        status: jest.fn(function () { return this; }),
        json: jest.fn(function () { return this; }),
    };
    return { req, res };
}

function signToken(payload, type = 'public') {
    const secret = type === 'provider' ? process.env.PROVIDER_JWT_SECRET : process.env.HEALTH_JWT_SECRET;
    return jwt.sign(
{ tokenType: 'access', ...payload }, secret, {
        algorithm: 'HS256',
        issuer: 'gacp-backend',
        audience: type === 'provider' ? 'gacp-provider' : 'gacp-health',
        expiresIn: '1h',
        jwtid: 'jti-c4',
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    const { isAccessTokenBlocklisted } = require('../../services/token-revocation-service');
    isAccessTokenBlocklisted.mockResolvedValue(false);
    // Simulate the DB identity read failing (pool timeout / failover).
    mockFindUnique.mockRejectedValue(new Error('pool timeout'));
});

describe('C4 — authenticateProvider fails CLOSED on !dbHealthy for privileged roles', () => {
    const privileged = ['field_inspector', 'system_admin_dtam', 'dispatcher', 'document_reviewer', 'finance_officer_dtam', 'finance_officer_platform', 'system_admin_platform'];

    test.each(privileged)('%s + DB read failure → 401 IDENTITY_UNVERIFIED (not passed through)', async (role) => {
        const token = signToken({ id: 'p1', role, canonicalRole: role }, 'provider');
        const { req, res } = makeReqRes(token, 'provider_token');
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'IDENTITY_UNVERIFIED' }));
    });

    test('DB HEALTHY provider (row returned) still passes through', async () => {
        mockFindUnique.mockResolvedValue({ healthId: null, providerId: '5555555555555', status: 'ACTIVE', isDeleted: false });
        const token = signToken({ id: 'p1', role: 'field_inspector', canonicalRole: 'field_inspector' }, 'provider');
        const { req, res } = makeReqRes(token, 'provider_token');
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(401);
    });
});

describe('C4 — HEALTH keeps the degraded-DB keep-alive (availability)', () => {
    test('authenticateHealth + DB read failure → still next() (not 401)', async () => {
        const token = signToken({ id: 'u1', role: 'HEALTH', canonicalRole: 'health' }, 'public');
        const { req, res } = makeReqRes(token, 'auth_token');
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(401);
        expect(req.user.id).toBe('u1');
    });
});

describe('C4 — authenticateAny provider branch fails CLOSED on !dbHealthy', () => {
    test('provider (auditor) token via authenticateAny + DB failure → 401 IDENTITY_UNVERIFIED', async () => {
        const token = signToken({ id: 'p1', role: 'field_inspector', canonicalRole: 'field_inspector' }, 'provider');
        const { req, res } = makeReqRes(token, 'provider_token');
        const next = jest.fn();
        await authMiddleware.authenticateAny(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'IDENTITY_UNVERIFIED' }));
    });

    test('HEALTH token via authenticateAny + DB failure → still keep-alive next()', async () => {
        const token = signToken({ id: 'u1', role: 'HEALTH', canonicalRole: 'health' }, 'public');
        const { req, res } = makeReqRes(token, 'auth_token');
        const next = jest.fn();
        await authMiddleware.authenticateAny(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(401);
    });
});
