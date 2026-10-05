/**
 * Auth Middleware — JTI Claim Enforcement
 *
 * Closes the token-revocation bypass: a JWT without a `jti` claim cannot be
 * looked up in the Redis blocklist, so revoked tokens would stay valid until
 * their natural `exp`. `authenticateHealth`, `authenticateProvider`, and
 * `authenticateAny` MUST hard-reject any token missing a non-empty `jti`.
 *
 * `optionalAuth` is intentionally excluded — by design it allows anonymous
 * fallback for endpoints that work for logged-out users.
 *
 * `LEGACY_NO_JTI_GRACE_UNTIL` provides a backward-compat grace window so
 * pre-upgrade tokens can still authenticate during the rollout.
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

function signToken(payload, type = 'public', { jwtid } = {}) {
    const secret = type === 'provider' ? process.env.PROVIDER_JWT_SECRET : process.env.HEALTH_JWT_SECRET;
    const opts = {
        algorithm: 'HS256',
        issuer: 'gacp-backend',
        audience: type === 'provider' ? 'gacp-provider' : 'gacp-health',
        expiresIn: '1h',
    };
    if (jwtid !== undefined) {
        opts.jwtid = jwtid;
    }
    return jwt.sign(
{ tokenType: 'access', ...payload }, secret, opts);
}

describe('Auth Middleware — JTI Claim Enforcement', () => {
    const ORIGINAL_GRACE = process.env.LEGACY_NO_JTI_GRACE_UNTIL;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.LEGACY_NO_JTI_GRACE_UNTIL;
    });

    afterAll(() => {
        if (ORIGINAL_GRACE === undefined) {
            delete process.env.LEGACY_NO_JTI_GRACE_UNTIL;
        } else {
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = ORIGINAL_GRACE;
        }
    });

    describe('authenticateHealth', () => {
        it('rejects token without jti claim with 401 TOKEN_NO_JTI', async () => {
            const token = signToken({ id: 'user-1', role: 'HEALTH' }); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                code: 'TOKEN_NO_JTI',
            }));
            expect(next).not.toHaveBeenCalled();
        });

        it('rejects token with empty-string jti with 401 TOKEN_NO_JTI', async () => {
            // jsonwebtoken refuses an empty `jwtid` option, so we sign manually
            // to produce a payload literally containing `jti: ""`.
            const token = jwt.sign(
{ tokenType: 'access', id: 'user-1', role: 'HEALTH', jti: '' },
                process.env.HEALTH_JWT_SECRET,
                {
                    algorithm: 'HS256',
                    issuer: 'gacp-backend',
                    audience: 'gacp-health',
                    expiresIn: '1h',
                },
            );
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('rejects token with whitespace-only jti with 401 TOKEN_NO_JTI', async () => {
            // Defensive: a `jti` claim that trims to an empty string is just
            // as useless for revocation lookups as a missing one.
            const token = jwt.sign(
{ tokenType: 'access', id: 'user-1', role: 'HEALTH', jti: '   ' },
                process.env.HEALTH_JWT_SECRET,
                {
                    algorithm: 'HS256',
                    issuer: 'gacp-backend',
                    audience: 'gacp-health',
                    expiresIn: '1h',
                },
            );
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
        });

        it('accepts token with a valid jti and calls next()', async () => {
            const token = signToken({ id: 'user-1', role: 'HEALTH', canonicalRole: 'health' }, 'public', { jwtid: 'real-jti-abc' });
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(next).toHaveBeenCalled();
            // No 401 TOKEN_NO_JTI response should have fired.
            const jtiRejections = res.json.mock.calls.filter(([body]) => body && body.code === 'TOKEN_NO_JTI');
            expect(jtiRejections).toHaveLength(0);
        });
    });

    describe('authenticateProvider', () => {
        it('rejects token without jti claim with 401 TOKEN_NO_JTI', async () => {
            const token = signToken({ id: 'provider-1', role: 'system_admin_dtam' }, 'provider'); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateProvider(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('accepts provider token with a valid jti', async () => {
            const token = signToken(
                { id: 'provider-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' },
                'provider',
                { jwtid: 'real-jti-xyz' },
            );
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateProvider(req, res, next);

            expect(next).toHaveBeenCalled();
            const jtiRejections = res.json.mock.calls.filter(([body]) => body && body.code === 'TOKEN_NO_JTI');
            expect(jtiRejections).toHaveLength(0);
        });
    });

    describe('authenticateAny', () => {
        it('rejects token without jti claim with 401 TOKEN_NO_JTI (provider branch)', async () => {
            const token = signToken({ id: 'provider-1', role: 'system_admin_dtam' }, 'provider'); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateAny(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('rejects token without jti claim with 401 TOKEN_NO_JTI (health branch)', async () => {
            const token = signToken({ id: 'user-1', role: 'HEALTH' }, 'public'); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateAny(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('accepts token with a valid jti', async () => {
            const token = signToken(
                { id: 'user-1', role: 'HEALTH', canonicalRole: 'health' },
                'public',
                { jwtid: 'real-jti-ok' },
            );
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateAny(req, res, next);

            expect(next).toHaveBeenCalled();
            const jtiRejections = res.json.mock.calls.filter(([body]) => body && body.code === 'TOKEN_NO_JTI');
            expect(jtiRejections).toHaveLength(0);
        });
    });

    describe('optionalAuth (anonymous fallback preserved)', () => {
        it('does NOT reject anonymous (no-token) requests', async () => {
            const { req, res } = makeReqRes(null);
            const next = jest.fn();

            await authMiddleware.optionalAuth(req, res, next);

            expect(res.status).not.toHaveBeenCalledWith(401);
            expect(next).toHaveBeenCalled();
        });

        it('does NOT reject when a token without jti is supplied — by design', async () => {
            // optionalAuth allows anonymous fallback even if a malformed token
            // is presented. The contract is "best-effort, never blocks".
            const token = signToken({ id: 'user-1', role: 'HEALTH' }, 'public'); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.optionalAuth(req, res, next);

            // No TOKEN_NO_JTI rejection — request still flows through.
            const jtiRejections = res.json.mock.calls.filter(([body]) => body && body.code === 'TOKEN_NO_JTI');
            expect(jtiRejections).toHaveLength(0);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('LEGACY_NO_JTI_GRACE_UNTIL grace period', () => {
        let warnSpy;

        beforeEach(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        });
        afterEach(() => {
            warnSpy.mockRestore();
        });

        it('inside grace window: token without jti passes through with a console.warn', async () => {
            // 1 hour in the future — clearly inside the grace window.
            const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = future;

            const token = signToken({ id: 'user-1', role: 'HEALTH', canonicalRole: 'health' }); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(next).toHaveBeenCalled();
            const jtiRejections = res.json.mock.calls.filter(([body]) => body && body.code === 'TOKEN_NO_JTI');
            expect(jtiRejections).toHaveLength(0);

            // Loud warning so operators see remaining pre-upgrade tokens.
            expect(warnSpy).toHaveBeenCalled();
            const warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
            expect(warnMessages.some(m => m.includes('legacy token without jti'))).toBe(true);
        });

        it('after grace deadline: token without jti is hard-rejected again', async () => {
            // 1 hour in the past — grace window has closed.
            const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = past;

            const token = signToken({ id: 'user-1', role: 'HEALTH' }); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('malformed ISO string: defaults to hard-reject (defensive)', async () => {
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = 'not-a-real-timestamp';

            const token = signToken({ id: 'user-1', role: 'HEALTH' }); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_NO_JTI' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('grace window applies to authenticateProvider as well', async () => {
            const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = future;

            const token = signToken({ id: 'provider-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' }, 'provider'); // no jwtid
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateProvider(req, res, next);

            expect(next).toHaveBeenCalled();
            const jtiRejections = res.json.mock.calls.filter(([body]) => body && body.code === 'TOKEN_NO_JTI');
            expect(jtiRejections).toHaveLength(0);
        });
    });
});
