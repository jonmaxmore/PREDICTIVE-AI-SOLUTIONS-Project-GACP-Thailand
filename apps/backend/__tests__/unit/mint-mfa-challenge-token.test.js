'use strict';

/**
 * PR2 — mintMfaChallengeToken is the single source of the JWT `mfa_session` that
 * every login surface emits and /api/mfa/verify consumes. This locks the token
 * SHAPE so the auth paths can never drift back to the old opaque
 * Redis token (which /verify could not verify).
 */

const {
    mintMfaChallengeToken,
    computeMfaChallengeBinding,
} = require('../../shared/mfa-challenge-binding');
const jwtConfig = require('../../config/jwt-security');

describe('mintMfaChallengeToken', () => {
    const ip = '203.0.113.7';
    const ua = 'Mozilla/5.0 (test)';

    it('mints a verifiable JWT with purpose=mfa_challenge + the client binding', () => {
        const token = mintMfaChallengeToken({ userId: 'u-1', method: 'TOTP', ip, userAgent: ua, tokenType: 'public' });
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3);

        const decoded = jwtConfig.verifyToken(token, 'public');
        expect(decoded.id).toBe('u-1');
        expect(decoded.purpose).toBe('mfa_challenge');
        expect(decoded.method).toBe('TOTP');
        // bind === the same fingerprint /verify recomputes from the completing request
        expect(decoded.bind).toBe(computeMfaChallengeBinding(ip, ua));
    });

    it('defaults method to TOTP when omitted (existing authenticator users)', () => {
        const token = mintMfaChallengeToken({ userId: 'u-2', ip, userAgent: ua, tokenType: 'public' });
        expect(jwtConfig.verifyToken(token, 'public').method).toBe('TOTP');
    });

    it('refuses to mint an EMAIL challenge — the email second factor is retired (operator 2026-09-15)', () => {
        // A challenge nobody can answer (there is no code to email) must not exist
        // for five minutes with the user's id inside it. Fail closed at the mint.
        let err;
        try {
            mintMfaChallengeToken({ userId: 'u-3', method: 'EMAIL', ip, userAgent: ua, tokenType: 'public' });
        } catch (e) { err = e; }
        expect(err && err.code).toBe('MFA_METHOD_RETIRED');
    });

    it('signs with the provider key for the provider portal (not verifiable as public)', () => {
        const token = mintMfaChallengeToken({ userId: 'u-4', method: 'TOTP', ip, userAgent: ua, tokenType: 'provider' });
        // Verifiable with the provider key...
        expect(jwtConfig.verifyToken(token, 'provider').id).toBe('u-4');
        // ...and NOT with the public key (cryptographic portal separation).
        expect(() => jwtConfig.verifyToken(token, 'public')).toThrow();
    });
});
