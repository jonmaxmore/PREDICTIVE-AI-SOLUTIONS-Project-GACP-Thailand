/**
 * @jest-environment node
 */
/**
 * The CSP the checkout page is actually served with admits Stripe.js and the
 * PromptPay QR modal, and nothing else new (feat/promptpay-qr, 2026-09-27).
 *
 * Read from the REAL middleware output: this runs `middleware()` over a real
 * NextRequest for the checkout route and reads the header off the response
 * it returns, so a directive that exists in the constant but never reaches a
 * response would fail here (security-headers-middleware.test.ts pins the
 * constant; this pins the wire).
 *
 * The hosts are the ones Stripe documents for Stripe.js
 * (docs.stripe.com/security/guide, "Content Security Policy" → "Stripe.js",
 * excerpt in evidence/promptpay-qr-2026-09-27/stripe-csp-doc-excerpt.md):
 *   connect-src  https://api.stripe.com
 *   frame-src    https://*.js.stripe.com https://js.stripe.com https://hooks.stripe.com
 *   script-src   https://*.js.stripe.com https://js.stripe.com
 * The same list also names https://maps.googleapis.com in connect-src and
 * script-src. That host serves the Address Element's autocomplete, which this
 * page does not use, and the third-party-services gate forbids googleapis
 * (scripts/ci/check-third-party-services.js), so it is deliberately absent and
 * pinned absent below.
 */

import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function servedCsp(pathname: string): string {
    // A health session cookie so the protected route is served, not redirected.
    // The token is not a real credential: decideHealthAccess only reads the
    // role claim of an unsigned payload, and redirects are asserted absent.
    const payload = Buffer.from(JSON.stringify({ role: 'HEALTH', canonicalRole: 'health' })).toString('base64url');
    const token = `x.${payload}.y`;
    const req = new NextRequest(`http://localhost${pathname}`, {
        headers: { cookie: `auth_token=${token}` },
    });
    const res = middleware(req);
    expect(res.headers.get('location')).toBeNull();
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).not.toBeNull();
    return csp as string;
}

function directive(csp: string, name: string): string[] {
    const m = csp.match(new RegExp(`(?:^|; )${name} ([^;]+)`));
    expect(m).not.toBeNull();
    return m![1].trim().split(/\s+/);
}

describe('checkout CSP — Stripe.js and the PromptPay modal can load', () => {
    const csp = servedCsp('/health/payments/checkout');

    it('script-src admits Stripe.js (js.stripe.com and its frame subdomains)', () => {
        const src = directive(csp, 'script-src');
        expect(src).toContain('https://js.stripe.com');
        expect(src).toContain('https://*.js.stripe.com');
    });

    it('frame-src admits the Stripe frames the QR modal is drawn in, and keeps self', () => {
        const src = directive(csp, 'frame-src');
        expect(src).toEqual(["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com']);
    });

    it('connect-src admits the Stripe API', () => {
        expect(directive(csp, 'connect-src')).toContain('https://api.stripe.com');
    });

    it('no error-tracking host rides along when no Sentry DSN is baked in', () => {
        expect(csp).not.toMatch(/ingest|sentry/i);
    });

    it('nothing else from Stripe\'s list rides along: no maps host, no wildcard stripe.com, no bare https:', () => {
        expect(csp).not.toContain('maps.googleapis.com'); // third-party-allow: asserts this host is absent
        expect(csp).not.toMatch(/https:\/\/\*\.stripe\.com/);
        for (const name of ['script-src', 'frame-src', 'connect-src']) {
            expect(directive(csp, name)).not.toContain('https:');
        }
        expect(csp).toContain("frame-ancestors 'none'");
    });
});

describe('checkout CSP — with a Sentry DSN baked in, the wire header admits its ingest origin', () => {
    const ORIGINAL = process.env.NEXT_PUBLIC_SENTRY_DSN;

    afterAll(() => {
        if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
        else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL;
    });

    it('connect-src carries the ingest origin next to the Stripe API, and the key never appears', () => {
        process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc123publickey@o4501.ingest.example.test/4502';
        let served = '';
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { middleware: isolated } = require('@/middleware') as typeof import('@/middleware');
            const payload = Buffer.from(JSON.stringify({ role: 'HEALTH', canonicalRole: 'health' })).toString('base64url');
            const req = new NextRequest('http://localhost/health/payments/checkout', {
                headers: { cookie: `auth_token=x.${payload}.y` },
            });
            served = isolated(req).headers.get('Content-Security-Policy') as string;
        });
        const src = directive(served, 'connect-src');
        expect(src).toContain('https://o4501.ingest.example.test');
        expect(src).toContain('https://api.stripe.com');
        expect(served).not.toContain('abc123publickey');
        expect(directive(served, 'frame-src')).toEqual(["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com']);
    });
});
