'use strict';

/**
 * L-2 (audit 2026-06-11) — cookie `Secure` flag policy.
 * Production always sets Secure (gacpth.com is TLS-only); COOKIE_SECURE=false
 * must NOT be able to disable it in production.
 */

const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_COOKIE_SECURE = process.env.COOKIE_SECURE;

// isSecureCookie reads process.env at call time, so no module reset needed.
const { isSecureCookie } = require('../../utils/cookie-security');

describe('isSecureCookie (L-2)', () => {
    afterEach(() => {
        process.env.NODE_ENV = ORIG_NODE_ENV;
        if (ORIG_COOKIE_SECURE === undefined) { delete process.env.COOKIE_SECURE; }
        else { process.env.COOKIE_SECURE = ORIG_COOKIE_SECURE; }
    });

    it('production is ALWAYS Secure, even when COOKIE_SECURE=false', () => {
        process.env.NODE_ENV = 'production';
        process.env.COOKIE_SECURE = 'false';
        expect(isSecureCookie()).toBe(true);
    });

    it('production is Secure when COOKIE_SECURE is unset', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.COOKIE_SECURE;
        expect(isSecureCookie()).toBe(true);
    });

    it('non-production opts in via COOKIE_SECURE=true (e.g. local HTTPS)', () => {
        process.env.NODE_ENV = 'development';
        process.env.COOKIE_SECURE = 'true';
        expect(isSecureCookie()).toBe(true);
    });

    it('non-production defaults to NOT Secure (local HTTP dev)', () => {
        process.env.NODE_ENV = 'development';
        process.env.COOKIE_SECURE = 'false';
        expect(isSecureCookie()).toBe(false);
    });
});
