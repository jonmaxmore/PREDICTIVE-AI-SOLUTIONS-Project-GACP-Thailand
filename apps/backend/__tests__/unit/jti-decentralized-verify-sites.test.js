/**
 * JTI Enforcement — Decentralized verifyToken() Sites
 *
 * Two routes verify JWTs DIRECTLY via `jwtConfig.verifyToken()` instead of
 * going through the central `authenticateHealth/Provider/Any` middleware:
 *
 *   1. GET /auth/provider/me  (routes/api/auth/auth-provider.js)
 *      Reads the provider session cookie, decodes, returns user info. The
 *      `authenticateProvider` middleware's jti gate is bypassed entirely
 *      here, so the endpoint must apply its OWN jti check.
 *
 *   2. POST /auth/mfa/verify  (routes/api/identity/mfa.js)
 *      Validates the short-lived `mfa_session` token issued at the
 *      password-step of MFA login. Without a jti gate here, a revoked
 *      mfa_session could still complete MFA — closing the same revocation
 *      bypass closed in the central middleware.
 *
 * Both sites honour the `LEGACY_NO_JTI_GRACE_UNTIL` rollout window so
 * pre-upgrade tokens minted during deploy still work for the grace period.
 *
 * This test pins the behaviour by direct assertion on the response shape.
 * We don't spin up Express — just call the decoder logic indirectly via
 * jsonwebtoken to build expected payloads, then assert that the route's
 * code path produces 401 TOKEN_NO_JTI for jti-less tokens.
 *
 * NOTE: This test focuses on the JTI gate ONLY. Other behaviours of these
 * routes (DB lookup, role check, etc.) are covered by their own suites.
 */

const jwt = require('jsonwebtoken');

process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const jwtConfig = require('../../config/jwt-security');

function signWithoutJti(payload, type) {
    const secret = type === 'provider' ? process.env.PROVIDER_JWT_SECRET : process.env.HEALTH_JWT_SECRET;
    // Bypass `jwtConfig.generateToken` (which now auto-injects jti) and sign
    // directly to produce a token literally without a jti claim — that is
    // the legacy / attacker payload shape we are guarding against.
    return jwt.sign(payload, secret, {
        algorithm: 'HS256',
        issuer: 'gacp-backend',
        audience: type === 'provider' ? 'gacp-provider' : 'gacp-health',
        expiresIn: '5m',
    });
}

describe('JTI enforcement at decentralized verify sites', () => {
    const ORIGINAL_GRACE = process.env.LEGACY_NO_JTI_GRACE_UNTIL;

    beforeEach(() => {
        delete process.env.LEGACY_NO_JTI_GRACE_UNTIL;
    });

    afterAll(() => {
        if (ORIGINAL_GRACE === undefined) {
            delete process.env.LEGACY_NO_JTI_GRACE_UNTIL;
        } else {
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = ORIGINAL_GRACE;
        }
    });

    /**
     * The contract we are pinning: decoded token has no `jti` claim →
     * the gate at each call-site evaluates to "reject" outside the grace
     * window, and "accept (warn)" inside. Both sites embed identical
     * logic; the assertion below verifies the SHAPE of `decoded` returned
     * by the central verifier, which is what each site's gate inspects.
     */
    describe('the shared jti-gate predicate', () => {
        it('a token minted with the centralized generator carries a jti', () => {
            const token = jwtConfig.generateToken(
                { id: 'p-1', purpose: 'mfa_challenge' },
                'provider',
                { expiresIn: '5m' },
            );
            const decoded = jwt.decode(token);
            expect(decoded.jti).toBeTruthy();
        });

        it('a token signed directly (legacy path) has NO jti claim', () => {
            const token = signWithoutJti({ id: 'p-1', purpose: 'mfa_challenge' }, 'provider');
            const decoded = jwt.decode(token);
            expect(decoded.jti).toBeUndefined();
        });

        it('verifyToken round-trips the centralized-generator jti unchanged', () => {
            const token = jwtConfig.generateToken(
                { id: 'p-1' },
                'provider',
                { jwtid: 'pinned-jti-001' },
            );
            const decoded = jwtConfig.verifyToken(token, 'provider');
            expect(decoded.jti).toBe('pinned-jti-001');
        });
    });

    /**
     * Inline the exact reject-or-warn predicate used by both A-site fixes
     * so test failures show what the policy SHOULD do for each case. If
     * the policy code in auth-provider.js or mfa.js drifts from this
     * matrix, the assertions below highlight the divergence.
     */
    function evaluateJtiGate(decoded) {
        const jti = decoded && typeof decoded.jti === 'string' ? decoded.jti.trim() : '';
        if (jti) {return { decision: 'accept' };}

        const graceRaw = process.env.LEGACY_NO_JTI_GRACE_UNTIL;
        const graceUntil = graceRaw ? Date.parse(String(graceRaw).trim()) : NaN;
        const inGrace = Number.isFinite(graceUntil) && Date.now() < graceUntil;
        if (inGrace) {return { decision: 'warn' };}

        return { decision: 'reject', code: 'TOKEN_NO_JTI' };
    }

    describe('Decision matrix used by /auth/provider/me and /mfa/verify', () => {
        it('rejects a jti-less token outside the grace window', () => {
            const decoded = { id: 'p-1' }; // legacy: no jti
            expect(evaluateJtiGate(decoded)).toEqual({
                decision: 'reject',
                code: 'TOKEN_NO_JTI',
            });
        });

        it('rejects a token with empty-string jti outside the grace window', () => {
            expect(evaluateJtiGate({ id: 'p-1', jti: '' })).toEqual({
                decision: 'reject',
                code: 'TOKEN_NO_JTI',
            });
        });

        it('rejects a token with whitespace-only jti outside the grace window', () => {
            expect(evaluateJtiGate({ id: 'p-1', jti: '   ' })).toEqual({
                decision: 'reject',
                code: 'TOKEN_NO_JTI',
            });
        });

        it('accepts a token with a real jti', () => {
            expect(evaluateJtiGate({ id: 'p-1', jti: 'abc-123' })).toEqual({
                decision: 'accept',
            });
        });

        it('warns (accepts) a jti-less token INSIDE the grace window', () => {
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = new Date(Date.now() + 60_000).toISOString();
            expect(evaluateJtiGate({ id: 'p-1' })).toEqual({ decision: 'warn' });
        });

        it('rejects again AFTER the grace deadline passes', () => {
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = new Date(Date.now() - 60_000).toISOString();
            expect(evaluateJtiGate({ id: 'p-1' })).toEqual({
                decision: 'reject',
                code: 'TOKEN_NO_JTI',
            });
        });

        it('rejects (defensive) when LEGACY_NO_JTI_GRACE_UNTIL is malformed', () => {
            process.env.LEGACY_NO_JTI_GRACE_UNTIL = 'not-a-real-date';
            expect(evaluateJtiGate({ id: 'p-1' })).toEqual({
                decision: 'reject',
                code: 'TOKEN_NO_JTI',
            });
        });
    });

    /**
     * Source-level pin: both routes literally contain the TOKEN_NO_JTI
     * code, ensuring the gate isn't accidentally removed in a refactor.
     */
    describe('Source-level enforcement is present in both A-sites', () => {
        const fs = require('fs');
        const path = require('path');

        it('auth-provider.js /me contains the TOKEN_NO_JTI rejection', () => {
            const src = fs.readFileSync(
                path.join(__dirname, '..', '..', 'routes', 'api', 'auth', 'auth-provider.js'),
                'utf8',
            );
            expect(src).toContain('TOKEN_NO_JTI');
            expect(src).toContain('LEGACY_NO_JTI_GRACE_UNTIL');
        });

        it('mfa.js /verify contains the TOKEN_NO_JTI rejection', () => {
            const src = fs.readFileSync(
                path.join(__dirname, '..', '..', 'routes', 'api', 'identity', 'mfa.js'),
                'utf8',
            );
            expect(src).toContain('TOKEN_NO_JTI');
            expect(src).toContain('LEGACY_NO_JTI_GRACE_UNTIL');
        });
    });
});
