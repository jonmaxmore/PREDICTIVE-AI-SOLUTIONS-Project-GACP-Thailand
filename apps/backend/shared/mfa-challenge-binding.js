'use strict';

const crypto = require('crypto');

/**
 * AUTH-5 — bind an MFA challenge (the `mfa_session` JWT minted after the
 * password step) to the client that started it, so a stolen/leaked challenge
 * token cannot be completed from a different network or browser.
 *
 * We embed a SHA-256 fingerprint of `ip|user-agent` in the JWT `bind` claim —
 * never the raw IP/User-Agent (PDPA-class data + keeps the token small). The
 * /verify endpoint recomputes the fingerprint from the completing request and
 * rejects when it differs from the bound value.
 *
 * The fingerprint MUST be computed identically at issue and verify, so both
 * sides go through this one function.
 *
 * @param {string} ip          client IP (use getRequestIp(req) — proxy/XFF aware)
 * @param {string} userAgent   req.headers['user-agent']
 * @returns {string} 64-char hex SHA-256 fingerprint
 */
function computeMfaChallengeBinding(ip, userAgent) {
    const normIp = String(ip || '').trim();
    // Cap the UA so a hostile/oversized header can't blow up the hash input.
    const normUa = String(userAgent || '').trim().slice(0, 512);
    return crypto.createHash('sha256').update(`${normIp}\n${normUa}`).digest('hex');
}

/**
 * Enforcement is ON by default. Ops can set MFA_CHALLENGE_BIND_ENFORCE=false to
 * downgrade a binding mismatch from a hard 401 to a logged warning — an escape
 * hatch if mobile-network IP rotation inside the 5-minute challenge window ever
 * causes false rejections. The mismatch is always audited regardless.
 *
 * @returns {boolean}
 */
function isMfaChallengeBindingEnforced() {
    return process.env.MFA_CHALLENGE_BIND_ENFORCE !== 'false';
}

/**
 * Mint the short-lived JWT `mfa_session` challenge that the password step returns
 * and that POST /api/mfa/verify consumes. ALL login surfaces (legacy provider,
 * health, provider) MUST mint via this single helper so
 * the challenge format is identical everywhere — /verify only understands this
 * JWT shape (`purpose:'mfa_challenge'`), never the opaque Redis token that
 * issueMfaChallenge used to emit (that was an unverifiable dead-end).
 *
 * The `method` claim names the factor /verify checks. Since the operator ruling
 * of 2026-09-15 (ไม่มี 2FA แบบอีเมล — หมอพร้อม/ThaID เท่านั้น) the only factor is
 * 'TOTP'; asking for the retired 'EMAIL' method throws rather than minting a
 * five-minute challenge nobody could answer (there is no code to email). `bind`
 * ties the challenge to the originating client (AUTH-5).
 *
 * @param {Object} p
 * @param {string} p.userId
 * @param {string} [p.method]      'TOTP' (default and only value)
 * @param {string} p.ip            getRequestIp(req)
 * @param {string} p.userAgent     req.headers['user-agent']
 * @param {'provider'|'public'} p.tokenType  per-portal signing key (provider vs health)
 * @returns {string} signed 5-minute JWT mfa_session
 * @throws {Error} code MFA_METHOD_RETIRED for any method other than TOTP
 */
function mintMfaChallengeToken({ userId, method, ip, userAgent, tokenType }) {
    const resolvedMethod = method || 'TOTP';
    if (resolvedMethod !== 'TOTP') {
        const err = new Error(`MFA method ${resolvedMethod} is retired; only TOTP can be challenged`);
        err.code = 'MFA_METHOD_RETIRED';
        err.statusCode = 400;
        throw err;
    }
    // Lazy require to keep this leaf module free of a top-level jwt-security dep.
    const jwtConfig = require('../config/jwt-security');
    return jwtConfig.generateToken({
        id: userId,
        purpose: 'mfa_challenge',
        method: resolvedMethod,
        bind: computeMfaChallengeBinding(ip, userAgent),
    }, tokenType, { expiresIn: '5m' });
}

module.exports = { computeMfaChallengeBinding, isMfaChallengeBindingEnforced, mintMfaChallengeToken };
