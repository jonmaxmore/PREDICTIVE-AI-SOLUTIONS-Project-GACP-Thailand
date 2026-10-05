/**
 * CSRF Double-Submit Cookie Middleware
 *
 * Defence-in-depth against Cross-Site Request Forgery on cookie-based auth
 * endpoints. Pattern: the client mints a random `csrf_token` value, stores
 * it in a non-HttpOnly cookie AND echoes it back via the `x-csrf-token`
 * header on every state-changing request. Server compares cookie vs header
 * (constant-time-ish equality) — a cross-origin attacker cannot read the
 * cookie value to forge the matching header (Same-Origin Policy).
 *
 * Extracted verbatim from `server.js` (W2-D refactor) so the behaviour can
 * be unit-tested in isolation. The original closure captured 3 module
 * constants — they are now exposed as middleware `options` so test fixtures
 * can override per-it().
 *
 * Notes:
 *   - Bypass list MUST include login endpoints. Without bypass, a stale
 *     csrf_token cookie from a previous session would block the user from
 *     authenticating (they have no valid header to send yet).
 *   - Lab webhook callbacks are server-to-server (signed payloads, no
 *     session cookie). They are bypassed because they never carry the
 *     auth cookie that gates the CSRF check.
 *   - Safe methods (GET/HEAD/OPTIONS) are skipped per RFC 7231 §4.2.1
 *     (they must be idempotent and not have side-effects).
 *   - Requests WITHOUT an auth cookie are skipped (anonymous traffic;
 *     CSRF only matters once the user is authenticated).
 *
 * @see docs/handoffs/iter-W2/00-rfc.md §W2-D
 * @version 1.0.0
 */

'use strict';

const { sendErrorResponse } = require('../shared/api-response');

/**
 * Default bypass patterns — login endpoints (versioned + unversioned) and
 * lab-webhook callbacks. Exposed for unit tests to assert the regex set.
 */
const DEFAULT_BYPASS_PATTERNS = [
    /^\/api(?:\/v\d+)?\/auth\/health\/login\/?$/,
    /^\/api(?:\/v\d+)?\/auth\/provider\/login\/?$/,
    // AUTH-01 P2: OAuth IdP entry points are login endpoints — a stale
    // csrf_token cookie from a previous session must not block a fresh
    // sign-in (same rationale as the two login bypasses above). Their own
    // anti-CSRF is the single-use signed `state` cookie enforced by
    // routes/api/auth/auth-idp.js (mandate §D3), which a cross-origin
    // attacker can neither read nor forge.
    /^\/api(?:\/v\d+)?\/auth\/idp\/[^/]+\/authorize-url\/?$/,
    /^\/api(?:\/v\d+)?\/auth\/idp\/[^/]+\/callback\/?$/,
    /^\/api(?:\/v\d+)?\/callbacks(?:\/|$)/,
];

/**
 * HTTP methods that MUST NOT have side-effects per RFC 7231 §4.2.1 — these
 * skip the CSRF check entirely.
 */
const DEFAULT_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Auth cookies that signal the request is authenticated. If neither is
 * present, the request is treated as anonymous and the CSRF check is
 * skipped (there is no session to hijack).
 */
const DEFAULT_AUTH_COOKIES = ['auth_token', 'provider_token'];

/**
 * Build an Express middleware that enforces the CSRF double-submit cookie
 * pattern. Options match the original server.js closure 1:1 — defaults
 * preserve behaviour.
 *
 * @param {Object} [options]
 * @param {string} [options.headerName='x-csrf-token']
 * @param {string} [options.cookieName='csrf_token']
 * @param {RegExp[]} [options.bypassPatterns=DEFAULT_BYPASS_PATTERNS]
 * @param {Set<string>} [options.safeMethods=DEFAULT_SAFE_METHODS]
 * @param {string[]} [options.authCookies=DEFAULT_AUTH_COOKIES]
 * @returns {import('express').RequestHandler}
 */
function csrfDoubleSubmit(options = {}) {
    const headerName = options.headerName || 'x-csrf-token';
    const cookieName = options.cookieName || 'csrf_token';
    const bypassPatterns = Array.isArray(options.bypassPatterns)
        ? options.bypassPatterns
        : DEFAULT_BYPASS_PATTERNS;
    const safeMethods = options.safeMethods instanceof Set
        ? options.safeMethods
        : DEFAULT_SAFE_METHODS;
    const authCookies = Array.isArray(options.authCookies)
        ? options.authCookies
        : DEFAULT_AUTH_COOKIES;

    function isCsrfBypassed(path) {
        const p = String(path || '');
        return bypassPatterns.some((rx) => rx.test(p));
    }

    function hasAuthCookie(req) {
        const cookies = req.cookies || {};
        return authCookies.some((name) => Boolean(cookies[name]));
    }

    return function csrfDoubleSubmitMiddleware(req, res, next) {
        if (isCsrfBypassed(req.path)) { return next(); }
        if (safeMethods.has(req.method)) { return next(); }
        if (!hasAuthCookie(req)) { return next(); }

        const csrfCookie = req.cookies?.[cookieName];
        const csrfHeader = req.headers[headerName];

        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
            return sendErrorResponse(res, req, {
                status: 403,
                code: 'CSRF_MISMATCH',
                message: 'Invalid CSRF token',
                messageTh: 'Invalid CSRF token',
            });
        }

        return next();
    };
}

module.exports = csrfDoubleSubmit;
module.exports.csrfDoubleSubmit = csrfDoubleSubmit;
module.exports.DEFAULT_BYPASS_PATTERNS = DEFAULT_BYPASS_PATTERNS;
module.exports.DEFAULT_SAFE_METHODS = DEFAULT_SAFE_METHODS;
module.exports.DEFAULT_AUTH_COOKIES = DEFAULT_AUTH_COOKIES;
