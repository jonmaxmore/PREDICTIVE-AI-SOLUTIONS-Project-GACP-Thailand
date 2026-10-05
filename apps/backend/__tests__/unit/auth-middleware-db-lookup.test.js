/**
 * [Sprint6] Auth Middleware Post-Verify DB Identity Lookup
 *
 * Sprint 6 healthId-audit Phase B-C1 removed `healthId`/`providerId` from JWT payload.
 * The middleware now fetches identity columns from the DB after verifying the JWT and
 * attaches them to `req.user` so the 17+ route callers continue to work unchanged.
 *
 * Also covers M1 — `resolveTokenUserId` no longer falls back to `healthId`.
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
const _jwtConfig = require('../../config/jwt-security');

function makeReqRes(token) {
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, path: '/test' };
    const status = jest.fn(() => ({ json: jest.fn() }));
    const res = { status };
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
        expiresIn: '1h',
        jwtid: 'fake-jti-123',
    });
}

describe('[Sprint6] Auth Middleware Post-Verify DB Identity Lookup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // `jest.clearAllMocks()` resets `mock.calls` but in some Jest configurations also
        // resets the chained `mockResolvedValue`. Re-prime the blocklist mock to false on
        // every test so we don't get accidental TOKEN_REVOKED responses.
        const { isAccessTokenBlocklisted } = require('../../services/token-revocation-service');
        isAccessTokenBlocklisted.mockResolvedValue(false);
    });

    it('authenticateHealth populates req.user.healthId from DB lookup (not JWT)', async () => {
        // Sprint 6 invariant: token does NOT carry healthId, but middleware still attaches it.
        const token = signToken({ id: 'user-uuid-1', role: 'HEALTH', canonicalRole: 'health' });
        mockFindUnique.mockResolvedValue({ healthId: '1100100100011', providerId: null, status: 'ACTIVE', isDeleted: false });

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        // Detokenize STAGE 0: the identity select now ALSO fetches the *Hmac
        // columns (the source of req.user.canonicalId under the FK-token flag).
        expect(mockFindUnique).toHaveBeenCalledWith({
            where: { id: 'user-uuid-1' },
            select: { healthId: true, providerId: true, healthIdHmac: true, providerIdHmac: true, canonicalId: true, sessionsRevokedAt: true, status: true, isDeleted: true, role: true },
        });
        expect(req.user.healthId).toBe('1100100100011');
        expect(req.user.providerId).toBeNull();
        // Flag OFF (default) → canonicalId == the national ID (the FK key today).
        expect(req.user.canonicalId).toBe('1100100100011');
        expect(next).toHaveBeenCalled();
    });

    it('authenticateHealth refuses a token whose owner row is gone (SECU-03 — was a pass-through)', async () => {
        // The lookup SUCCEEDED and found no row: nobody owns this token any more.
        // Only a failed lookup (below) keeps the degraded-DB keep-alive.
        const token = signToken({ id: 'user-uuid-1', role: 'HEALTH', canonicalRole: 'health' });
        mockFindUnique.mockResolvedValue(null);

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_INACTIVE' }));
        expect(req.user).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('authenticateHealth gracefully degrades when DB lookup throws (continues with null healthId)', async () => {
        const token = signToken({ id: 'user-uuid-1', role: 'HEALTH', canonicalRole: 'health' });
        mockFindUnique.mockRejectedValue(new Error('connection timeout'));

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(req.user.id).toBe('user-uuid-1');
        expect(req.user.healthId).toBeNull();
        expect(next).toHaveBeenCalled(); // does NOT block the request
    });

    it('legacy JWT carrying decoded.healthId is honoured as fallback when the DB column is null', async () => {
        // Defensive path: pre-Sprint-6 tokens still in flight.
        const token = signToken({
            id: 'user-uuid-1',
            role: 'HEALTH',
            canonicalRole: 'health',
            healthId: 'LEGACY-FROM-OLD-TOKEN',
        });
        mockFindUnique.mockResolvedValue({ healthId: null, providerId: null, status: 'ACTIVE', isDeleted: false });

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(req.user.healthId).toBe('LEGACY-FROM-OLD-TOKEN');
    });

    it('blocklisted JTI returns 401 TOKEN_REVOKED and does NOT call DB lookup', async () => {
        const { isAccessTokenBlocklisted } = require('../../services/token-revocation-service');
        isAccessTokenBlocklisted.mockResolvedValue(true);
        const token = signToken({ id: 'user-uuid-1', role: 'HEALTH', canonicalRole: 'health' });

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('token missing id/userId/sub/accountId returns 401 TOKEN_PAYLOAD_INVALID', async () => {
        // Token has only `healthId` — Sprint 6 M1 removed this from the fallback chain.
        const token = signToken({ healthId: '1100100100011', role: 'HEALTH' });

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('authenticateProvider applies the same DB-lookup pattern (Sprint 6 C1)', async () => {
        const token = signToken({ id: 'provider-uuid-9', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' }, 'provider');
        mockFindUnique.mockResolvedValue({ healthId: null, providerId: '5555555555555', status: 'ACTIVE', isDeleted: false });

        const { req, res } = makeReqRes(token);
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(mockFindUnique).toHaveBeenCalledWith({
            where: { id: 'provider-uuid-9' },
            select: { healthId: true, providerId: true, healthIdHmac: true, providerIdHmac: true, canonicalId: true, sessionsRevokedAt: true, status: true, isDeleted: true, role: true },
        });
        expect(req.user.providerId).toBe('5555555555555');
        // Flag OFF (default) → canonicalId == providerId (the FK key today).
        expect(req.user.canonicalId).toBe('5555555555555');
        expect(next).toHaveBeenCalled();
    });
});

// BE-EDGE-04 — the 401/403 mapping on authenticateProvider has documented
// failure codes (INVALID_ROLE, TOKEN_EXPIRED, INVALID_TOKEN, NO_TOKEN) that
// were behavior-verified but had no dedicated assertion. These guard the exact
// status + `code` for each branch so a refactor can't silently change the
// client-visible contract (the web client switches on `code`). See
// the hardening findings
describe('[BE-EDGE-04] authenticateProvider failure-code mapping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { isAccessTokenBlocklisted } = require('../../services/token-revocation-service');
        isAccessTokenBlocklisted.mockResolvedValue(false);
    });

    it('no token → 401 NO_TOKEN (and never hits the DB)', async () => {
        const req = { headers: {}, cookies: {}, path: '/test' };
        const res = { status: jest.fn(function () { return this; }), json: jest.fn(function () { return this; }) };
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_TOKEN' }));
        expect(next).not.toHaveBeenCalled();
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('valid provider-signed token but NON-provider role → 403 INVALID_ROLE (role check, not DB)', async () => {
        // Token verifies under the provider secret/audience but carries a HEALTH
        // role — the role gate must reject before any identity DB lookup.
        const token = signToken({ id: 'user-uuid-1', role: 'HEALTH', canonicalRole: 'health' }, 'provider');
        const { req, res } = makeReqRes(token);
        req.cookies = {};
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_ROLE' }));
        expect(next).not.toHaveBeenCalled();
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('expired provider token → 401 TOKEN_EXPIRED (with expiredAt)', async () => {
        const token = jwt.sign(
{ tokenType: 'access', id: 'provider-uuid-9', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' },
            process.env.PROVIDER_JWT_SECRET,
            {
                algorithm: 'HS256',
                issuer: 'gacp-backend',
                audience: 'gacp-provider',
                expiresIn: '-10s', // already expired
                jwtid: 'fake-jti-expired',
            },
        );
        const { req, res } = makeReqRes(token);
        req.cookies = {};
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('token signed with the WRONG secret (health token at a provider endpoint) → 401 INVALID_TOKEN', async () => {
        // Crypto separation: a health-secret token must never authenticate as a
        // provider — signature verification fails → INVALID_TOKEN, not a role error.
        const healthToken = signToken({ id: 'user-uuid-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' }, 'public');
        const { req, res } = makeReqRes(healthToken);
        req.cookies = {};
        const next = jest.fn();
        await authMiddleware.authenticateProvider(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
        expect(next).not.toHaveBeenCalled();
    });

    // H4 regression (the OTHER direction): a PROVIDER-audience token must be
    // rejected by authenticateHealth BEFORE any role/DB step — separate secret
    // AND audience ('gacp-health' only, no provider alias). Staging once let a
    // provider token through a health endpoint (env misconfig); this locks the
    // source-level invariant so a code regression can't reintroduce it.
    it('PROVIDER token at a health endpoint → 401 INVALID_TOKEN, no DB lookup', async () => {
        const providerToken = signToken({ id: 'provider-uuid-9', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' }, 'provider');
        const { req, res } = makeReqRes(providerToken);
        const next = jest.fn();
        await authMiddleware.authenticateHealth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
        expect(next).not.toHaveBeenCalled();
        expect(mockFindUnique).not.toHaveBeenCalled();
    });
});
