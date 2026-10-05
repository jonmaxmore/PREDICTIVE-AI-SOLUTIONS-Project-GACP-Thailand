'use strict';

/**
 * Cookie `Secure` flag policy (auth audit 2026-06-11, L-2).
 *
 * In production, session cookies are ALWAYS Secure — gacpth.com is served over
 * TLS (nginx terminates), so an auth cookie must never be emitted over plain
 * HTTP. The previous inline logic
 *     COOKIE_SECURE === 'true' || (NODE_ENV === 'production' && COOKIE_SECURE !== 'false')
 * let an operator DISABLE the Secure flag in production by setting
 * COOKIE_SECURE=false. Now production ignores that override entirely; the
 * `COOKIE_SECURE=true` opt-in only matters in non-prod (local HTTP dev, where a
 * Secure cookie would break testing). Single source of truth so the four call
 * sites (auth-controller, auth-provider ×2, identity/mfa) can't drift.
 */
function isSecureCookie() {
    if (process.env.NODE_ENV === 'production') {
        return true;
    }
    return process.env.COOKIE_SECURE === 'true';
}

module.exports = { isSecureCookie };
