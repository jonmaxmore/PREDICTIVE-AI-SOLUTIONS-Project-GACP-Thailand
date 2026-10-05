/**
 * jwt-security — JTI Minting Coverage
 *
 * Closes the other half of the JTI revocation gate: it is not enough for the
 * central auth-middleware to REJECT tokens without `jti` — every token we
 * MINT must include one, or else our own /login and /refresh endpoints would
 * produce tokens that fail the gate on the very next request.
 *
 * This test verifies the contract of the central minting helpers in
 * `config/jwt-security.js`:
 *
 *  1. `generateToken()` always produces a non-empty `jti`.
 *  2. `generateRefreshToken()` always produces a non-empty `jti`.
 *  3. Successive calls produce DIFFERENT jti values (no static identifier).
 *  4. Caller-supplied `jti` is preserved (so tests / rotation flows can pin).
 *  5. Payload-level `jti` is not silently dropped — it is forwarded into the
 *     standard `jwtid` slot.
 *  6. Tokens minted by these helpers PASS the central auth-middleware's jti
 *     enforcement gate end-to-end (round-trip integration check).
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

const jwtSecurity = require('../../config/jwt-security');
const authMiddleware = require('../../middleware/auth-middleware');

function decode(token) {
    return jwt.decode(token);
}

describe('jwt-security — JTI Minting Coverage', () => {
    describe('generateToken()', () => {
        it('injects a non-empty jti when none is supplied', () => {
            const token = jwtSecurity.generateToken({ id: 'user-1', role: 'HEALTH' });
            const decoded = decode(token);

            expect(decoded.jti).toBeDefined();
            expect(typeof decoded.jti).toBe('string');
            expect(decoded.jti.length).toBeGreaterThan(0);
        });

        it('produces a DIFFERENT jti on each call', () => {
            const a = jwtSecurity.generateToken({ id: 'user-1', role: 'HEALTH' });
            const b = jwtSecurity.generateToken({ id: 'user-1', role: 'HEALTH' });

            expect(decode(a).jti).not.toEqual(decode(b).jti);
        });

        it('preserves caller-supplied jti via payload.jti', () => {
            const token = jwtSecurity.generateToken({
                id: 'user-1',
                role: 'HEALTH',
                jti: 'caller-pinned-jti-abc-123',
            });

            expect(decode(token).jti).toBe('caller-pinned-jti-abc-123');
        });

        it('preserves caller-supplied jti via overrides.jwtid', () => {
            const token = jwtSecurity.generateToken(
                { id: 'user-1', role: 'HEALTH' },
                'public',
                { jwtid: 'override-jti-xyz' },
            );

            expect(decode(token).jti).toBe('override-jti-xyz');
        });

        it('strips payload-level jti so signing does not throw on duplicate claim', () => {
            // jsonwebtoken throws "Bad options.jti option" if jti appears both
            // in payload and options.jwtid. The wrapper must hide that.
            expect(() => {
                jwtSecurity.generateToken({
                    id: 'user-1',
                    role: 'HEALTH',
                    jti: 'p1',
                }, 'public', { jwtid: 'p1' });
            }).not.toThrow();
        });

        it('injects jti for provider tokens too', () => {
            const token = jwtSecurity.generateToken(
                { id: 'p-1', role: 'document_reviewer' },
                'provider',
            );

            expect(decode(token).jti).toBeTruthy();
        });
    });

    describe('generateRefreshToken()', () => {
        it('injects a non-empty jti', () => {
            const token = jwtSecurity.generateRefreshToken({ id: 'user-1', role: 'HEALTH' });

            expect(decode(token).jti).toBeTruthy();
        });

        it('produces a DIFFERENT jti on each call (rotation precondition)', () => {
            const a = jwtSecurity.generateRefreshToken({ id: 'user-1', role: 'HEALTH' });
            const b = jwtSecurity.generateRefreshToken({ id: 'user-1', role: 'HEALTH' });

            expect(decode(a).jti).not.toEqual(decode(b).jti);
        });

        it('preserves caller-supplied payload.jti', () => {
            const token = jwtSecurity.generateRefreshToken({
                id: 'user-1',
                role: 'HEALTH',
                jti: 'refresh-pinned',
            });

            expect(decode(token).jti).toBe('refresh-pinned');
        });
    });

    describe('End-to-end: minted token PASSES auth-middleware jti gate', () => {
        function makeReqRes(token) {
            const req = {
                headers: { authorization: `Bearer ${token}` },
                cookies: {},
                path: '/test',
                originalUrl: '/test',
            };
            const res = {};
            res.status = jest.fn(function () { return this; });
            res.json = jest.fn(function () { return this; });
            return { req, res };
        }

        it('health token minted by generateToken is accepted by authenticateHealth', async () => {
            const token = jwtSecurity.generateToken({ id: 'user-1', role: 'HEALTH' });
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateHealth(req, res, next);

            // No TOKEN_NO_JTI rejection
            expect(res.status).not.toHaveBeenCalledWith(401);
            expect(res.json).not.toHaveBeenCalledWith(
                expect.objectContaining({ code: 'TOKEN_NO_JTI' }),
            );
            expect(next).toHaveBeenCalled();
        });

        it('provider token minted by generateToken is accepted by authenticateProvider', async () => {
            const token = jwtSecurity.generateToken(
                { id: 'p-1', role: 'document_reviewer' },
                'provider',
            );
            const { req, res } = makeReqRes(token);
            const next = jest.fn();

            await authMiddleware.authenticateProvider(req, res, next);

            expect(res.status).not.toHaveBeenCalledWith(401);
            expect(res.json).not.toHaveBeenCalledWith(
                expect.objectContaining({ code: 'TOKEN_NO_JTI' }),
            );
            expect(next).toHaveBeenCalled();
        });
    });

    describe('generateJti() helper is exposed', () => {
        it('returns a non-empty string', () => {
            const id = jwtSecurity.generateJti();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        });

        it('returns a unique value on each call', () => {
            const a = jwtSecurity.generateJti();
            const b = jwtSecurity.generateJti();
            expect(a).not.toBe(b);
        });
    });
});
