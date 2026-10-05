/**
 * W2-D — csrf-middleware unit test.
 *
 * Pins the behaviour of the CSRF double-submit cookie middleware extracted
 * from server.js (lines 263-300, pre-W2-D). The middleware is a pure
 * function: it inspects req.method / req.path / req.cookies / req.headers
 * and either calls next() or emits a 403 via sendErrorResponse.
 *
 * Why this test exists:
 *   - Pre-W2-D the CSRF logic was an inline closure in server.js, only
 *     reachable via integration tests (refresh-token-blocklist.test.js
 *     touches the JWT cookie name but does NOT exercise the middleware).
 *   - A future regression that flips the safe-method set, drops a bypass
 *     pattern, or compares header/cookie incorrectly would slip through
 *     until a live deploy fails.
 *
 * Pattern follows uploads-security-headers.test.js: mock req/res/next
 * objects, invoke middleware, assert outcomes.
 *
 * I-008 applied: the SUT calls `sendErrorResponse(res, req, opts)`. The
 * test seeds `req.cookies` (set by cookie-parser at runtime) and
 * `req.headers` directly so the middleware can run standalone without a
 * full express harness.
 *
 * See: docs/handoffs/iter-W2/00-rfc.md §W2-D
 */

'use strict';

const csrfMiddlewareModule = require('../../middleware/csrf-middleware');
const { csrfDoubleSubmit, DEFAULT_BYPASS_PATTERNS, DEFAULT_SAFE_METHODS, DEFAULT_AUTH_COOKIES } = csrfMiddlewareModule;

function createReq({
    method = 'POST',
    path = '/api/applications',
    cookies = {},
    headers = {},
} = {}) {
    return {
        method,
        path,
        originalUrl: path,
        cookies,
        headers,
        id: 'req-test-1',
    };
}

function createRes() {
    const res = {
        statusCode: 200,
        body: null,
        status: jest.fn(function statusFn(code) {
            res.statusCode = code;
            return res;
        }),
        json: jest.fn(function jsonFn(payload) {
            res.body = payload;
            return res;
        }),
    };
    return res;
}

describe('W2-D csrf-middleware module', () => {
    it('exports csrfDoubleSubmit factory + default constants (testable surface)', () => {
        expect(typeof csrfMiddlewareModule).toBe('function');
        expect(typeof csrfDoubleSubmit).toBe('function');
        expect(Array.isArray(DEFAULT_BYPASS_PATTERNS)).toBe(true);
        expect(DEFAULT_BYPASS_PATTERNS.length).toBeGreaterThanOrEqual(3);
        expect(DEFAULT_SAFE_METHODS).toBeInstanceOf(Set);
        expect(DEFAULT_SAFE_METHODS.has('GET')).toBe(true);
        expect(DEFAULT_SAFE_METHODS.has('HEAD')).toBe(true);
        expect(DEFAULT_SAFE_METHODS.has('OPTIONS')).toBe(true);
        expect(DEFAULT_AUTH_COOKIES).toEqual(expect.arrayContaining(['auth_token', 'provider_token']));
    });

    it('returns a function with a stable middleware shape (req, res, next)', () => {
        const mw = csrfDoubleSubmit();
        expect(typeof mw).toBe('function');
        expect(mw.length).toBe(3); // arity (req, res, next)
    });
});

describe('W2-D csrfDoubleSubmit — safe-method + bypass paths', () => {
    let mw;
    beforeEach(() => { mw = csrfDoubleSubmit(); });

    it('allows GET (safe method) without csrf check — even with auth cookie + no header', () => {
        const req = createReq({
            method: 'GET',
            path: '/api/applications',
            cookies: { auth_token: 'health-jwt' },
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('allows HEAD (safe method) without csrf check', () => {
        const req = createReq({ method: 'HEAD', path: '/api/applications', cookies: { auth_token: 'x' } });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows OPTIONS (safe method) without csrf check', () => {
        const req = createReq({ method: 'OPTIONS', path: '/api/applications', cookies: { auth_token: 'x' } });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows POST without any auth cookie (anonymous traffic — no session to hijack)', () => {
        const req = createReq({ method: 'POST', path: '/api/applications', cookies: {} });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('allows POST on /api/auth/health/login bypass path (login must succeed even with stale csrf cookie)', () => {
        const req = createReq({
            method: 'POST',
            path: '/api/auth/health/login',
            cookies: { auth_token: 'stale', csrf_token: 'stale-csrf' },
            headers: {},
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows POST on versioned /api/v1/auth/provider/login bypass path', () => {
        const req = createReq({
            method: 'POST',
            path: '/api/v1/auth/provider/login',
            cookies: { provider_token: 'stale' },
            headers: {},
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows POST on /api/callbacks/* lab-webhook bypass path (server-to-server)', () => {
        const req = createReq({
            method: 'POST',
            path: '/api/callbacks/lab/result',
            cookies: { auth_token: 'x' }, // even with cookie, callbacks bypass
            headers: {},
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe('W2-D csrfDoubleSubmit — rejection branches', () => {
    let mw;
    beforeEach(() => { mw = csrfDoubleSubmit(); });

    it('rejects POST with auth cookie but no csrf cookie → 403 CSRF_MISMATCH', () => {
        const req = createReq({
            method: 'POST',
            path: '/api/applications',
            cookies: { auth_token: 'health-jwt' },
            headers: { 'x-csrf-token': 'abc' },
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.body).toMatchObject({ success: false, code: 'CSRF_MISMATCH' });
    });

    it('rejects POST with auth cookie + csrf cookie but no header → 403 CSRF_MISMATCH', () => {
        const req = createReq({
            method: 'POST',
            path: '/api/applications',
            cookies: { auth_token: 'x', csrf_token: 'abc' },
            headers: {},
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.body.code).toBe('CSRF_MISMATCH');
    });

    it('rejects POST with auth cookie + csrf cookie/header mismatch → 403 CSRF_MISMATCH', () => {
        const req = createReq({
            method: 'POST',
            path: '/api/applications',
            cookies: { auth_token: 'x', csrf_token: 'cookie-value' },
            headers: { 'x-csrf-token': 'header-value-DIFFERENT' },
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.body.code).toBe('CSRF_MISMATCH');
    });

    it('rejects PUT/DELETE/PATCH with auth cookie + missing csrf — every non-safe method gated', () => {
        for (const method of ['PUT', 'DELETE', 'PATCH']) {
            const req = createReq({
                method,
                path: '/api/applications/abc',
                cookies: { auth_token: 'x' },
                headers: {},
            });
            const res = createRes();
            const next = jest.fn();
            mw(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        }
    });
});

describe('W2-D csrfDoubleSubmit — happy path + customisation', () => {
    it('passes POST with matching csrf cookie + header → next() called', () => {
        const mw = csrfDoubleSubmit();
        const req = createReq({
            method: 'POST',
            path: '/api/applications',
            cookies: { auth_token: 'x', csrf_token: 'matching-token-123' },
            headers: { 'x-csrf-token': 'matching-token-123' },
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('respects custom headerName + cookieName options (factory parameterisation)', () => {
        const mw = csrfDoubleSubmit({ headerName: 'x-custom-csrf', cookieName: 'custom_csrf' });
        const req = createReq({
            method: 'POST',
            path: '/api/applications',
            cookies: { auth_token: 'x', custom_csrf: 'val' },
            headers: { 'x-custom-csrf': 'val' },
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        // And the default names DON'T trip the check anymore
        const req2 = createReq({
            method: 'POST',
            path: '/api/applications',
            cookies: { auth_token: 'x', csrf_token: 'mismatch1' },
            headers: { 'x-csrf-token': 'mismatch2' },
        });
        const res2 = createRes();
        const next2 = jest.fn();
        mw(req2, res2, next2);
        expect(next2).not.toHaveBeenCalled();
        expect(res2.status).toHaveBeenCalledWith(403);
    });

    it('respects custom bypassPatterns option (replaces defaults)', () => {
        const mw = csrfDoubleSubmit({
            bypassPatterns: [/^\/webhook$/],
        });
        const req = createReq({
            method: 'POST',
            path: '/webhook',
            cookies: { auth_token: 'x' },
            headers: {},
        });
        const res = createRes();
        const next = jest.fn();
        mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
