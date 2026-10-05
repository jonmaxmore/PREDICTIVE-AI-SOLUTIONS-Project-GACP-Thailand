'use strict';

/**
 * The /auth/idp rate-limit wrapper, as a testable factory.
 *
 * Lived inline in server.js first. The E1 deep review proved the inline form
 * was guarded only by source-text regexes — inverting the branch (authLimiter
 * for the read, next() for the OAuth surfaces) passed every pin. A factory
 * takes real limiter functions and returns real middleware, so the test can
 * mount it in express, fire requests, and count which limiter saw what.
 *
 * Contract: exactly one exemption. GET /providers is a public states-only
 * read the login chooser fetches on every mount, and the strict limiter's
 * per-IP bucket is SHARED with the login routes — one NAT office fumbling
 * logins would take the providers feed down with it. Everything else on the
 * prefix (authorize-url, callback, any future sub-path) stays on the strict
 * limiter. Method-checked: POST to the same path is not the read.
 */
function createIdpRateLimit({ authLimiter }) {
    if (typeof authLimiter !== 'function') {
        throw new TypeError('createIdpRateLimit needs the strict authLimiter function');
    }
    return function idpRateLimit(req, res, next) {
        if (req.method === 'GET' && req.path === '/providers') {
            return next();
        }
        return authLimiter(req, res, next);
    };
}

module.exports = { createIdpRateLimit };
