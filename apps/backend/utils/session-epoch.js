'use strict';

/**
 * Session-epoch timestamp for credential invalidation (BE-AUTH-03 session epoch).
 *
 * Stamp `User.sessionsRevokedAt` with this on EVERY credential mutation
 * (password change/reset, PDPA anonymize/erase) so that access/refresh tokens
 * issued BEFORE the mutation are evicted: the refresh + auth-middleware checks
 * reject a token whose `iat` predates `sessionsRevokedAt`.
 *
 * SF-2: rounded UP to the next whole second. JWT `iat` is floored to whole
 * seconds, so a sub-second (`.xyz`) stamp would let a token minted later in the
 * SAME second survive the strict `iat*1000 < sessionsRevokedAt` comparison.
 * Rounding the stamp up to the next second closes that ~1s survival window
 * without switching the comparator to `<=` (which would falsely 401 a legitimate
 * same-second re-login).
 *
 * @returns {Date} the next whole-second boundary, in ms.
 */
function sessionEpochStamp() {
    return new Date((Math.floor(Date.now() / 1000) + 1) * 1000);
}

/**
 * BE-AUTH-03-03 (session epoch) — true when a verified JWT was issued BEFORE
 * the owner's last password change/reset, and must therefore be rejected.
 *
 * decoded.iat is epoch SECONDS (JWT standard); sessionsRevokedAt is a Date/ISO.
 * Returns false when either input is missing (no epoch → nothing to enforce;
 * no iat → we cannot compare, leave the token to the other gates).
 *
 * Lives here (moved from auth-middleware.js, which still re-exports it) so a
 * route that verifies a token itself — /mfa/verify for its challenge — does
 * not have to load the middleware for a time comparison.
 *
 * @param {object} decoded              verified JWT payload
 * @param {Date|string|null} revokedAt  User.sessionsRevokedAt
 * @returns {boolean}
 */
function isTokenBeforeSessionEpoch(decoded, revokedAt) {
    if (!revokedAt) { return false; }
    const iat = decoded && typeof decoded.iat === 'number' ? decoded.iat : null;
    if (iat === null) { return false; }
    const revokedMs = new Date(revokedAt).getTime();
    if (Number.isNaN(revokedMs)) { return false; }
    return iat * 1000 < revokedMs;
}

module.exports = { sessionEpochStamp, isTokenBeforeSessionEpoch };
