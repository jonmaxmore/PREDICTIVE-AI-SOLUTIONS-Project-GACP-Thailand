/**
 * SEC — optionalAuth must not accept a non-access token as an identity.
 *
 * optionalAuth is the one access path that never went through
 * rejectPurposeScopedToken: it did `req.user = decoded` for ANY payload that
 * verified against the public secret. A refresh token verifies there (same
 * secret / issuer / audience as an access token, full login payload including
 * role and organizationId), and so does an mfa_challenge token issued to a
 * caller who supplied only a password. Either one became a complete
 * authenticated identity for every downstream handler and for bindScopes,
 * which derives the tenant binding from req.user.
 *
 * It is mounted on zero routes today — every production reference is a test
 * mock — so this is a landmine rather than a live breach. That is exactly why
 * it is worth closing now: the next route that mounts it inherits the hole
 * silently, and nothing in review would flag `optionalAuth` as dangerous.
 *
 * The contract of "optional" auth decides the shape of the fix: a bad token
 * means ANONYMOUS, not 401. The caller asked for a request that works either
 * way, so a wrong-class token is treated the same as a malformed one —
 * req.user stays unset and the request proceeds. Both the existing
 * anonymous-fallback tests in auth-middleware-jti-enforcement.test.js and the
 * cases below assert that.
 */

'use strict';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockVerifyToken = jest.fn();
jest.mock('../../config/jwt-security', () => ({
    ...jest.requireActual('../../config/jwt-security'),
    verifyToken: (...a) => mockVerifyToken(...a),
}));

const authMiddleware = require('../../middleware/auth-middleware');

function buildReq(token = 'tok') {
    return { headers: { authorization: `Bearer ${token}` }, cookies: {} };
}
function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

const NOW_SEC = Math.floor(Date.now() / 1000);
const ACCESS_PAYLOAD = {
    id: 'user-1', role: 'HEALTH', canonicalRole: 'health',
    organizationId: 'org-1', jti: 'jti-1', iat: NOW_SEC,
};

describe('SEC — optionalAuth token-class guard', () => {
    const graceEnv = process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
    });

    afterAll(() => {
        if (graceEnv === undefined) {
            delete process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
        } else {
            process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL = graceEnv;
        }
    });

    it('does not adopt a refresh token as an identity', async () => {
        mockVerifyToken.mockReturnValue({ ...ACCESS_PAYLOAD, tokenType: 'refresh' });
        const req = buildReq();
        const next = jest.fn();

        await authMiddleware.optionalAuth(req, buildRes(), next);

        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('does not adopt an mfa_challenge token as an identity', async () => {
        mockVerifyToken.mockReturnValue({ ...ACCESS_PAYLOAD, purpose: 'mfa_challenge' });
        const req = buildReq();
        const next = jest.fn();

        await authMiddleware.optionalAuth(req, buildRes(), next);

        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('stays anonymous rather than 401-ing on a wrong-class token', async () => {
        mockVerifyToken.mockReturnValue({ ...ACCESS_PAYLOAD, tokenType: 'refresh' });
        const res = buildRes();
        const next = jest.fn();

        await authMiddleware.optionalAuth(buildReq(), res, next);

        // "Optional" means a bad token degrades to anonymous, never to a 401.
        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    it('still adopts a genuine access token', async () => {
        mockVerifyToken.mockReturnValue({ ...ACCESS_PAYLOAD, tokenType: 'access' });
        const req = buildReq();
        const next = jest.fn();

        await authMiddleware.optionalAuth(req, buildRes(), next);

        expect(req.user).toBeDefined();
        expect(req.user.id).toBe('user-1');
        expect(next).toHaveBeenCalled();
    });

    it('still adopts a legacy untyped token while the grace window is open', async () => {
        process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL =
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        mockVerifyToken.mockReturnValue({ ...ACCESS_PAYLOAD });
        const req = buildReq();
        const next = jest.fn();

        await authMiddleware.optionalAuth(req, buildRes(), next);

        expect(req.user).toBeDefined();
        expect(next).toHaveBeenCalled();
    });

    it('stays anonymous for a legacy untyped token once the grace window closes', async () => {
        mockVerifyToken.mockReturnValue({ ...ACCESS_PAYLOAD });
        const req = buildReq();
        const next = jest.fn();

        await authMiddleware.optionalAuth(req, buildRes(), next);

        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('remains anonymous with no token at all', async () => {
        const req = { headers: {}, cookies: {} };
        const res = buildRes();
        const next = jest.fn();

        await authMiddleware.optionalAuth(req, res, next);

        expect(req.user).toBeUndefined();
        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });
});
