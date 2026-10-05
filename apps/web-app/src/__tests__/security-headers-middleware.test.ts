/**
 * W2-D — web-app security-headers middleware unit test.
 *
 * Pins the `securityHeaders` constant exported from
 * `apps/web-app/src/middleware.ts` (lines 67-95). The Next.js middleware
 * applies this object on EVERY non-API response via the matcher at
 * lines 199-203. A future refactor that drops `X-Frame-Options: DENY`,
 * loosens CSP, or removes HSTS preload would be caught here before
 * shipping.
 *
 * Why this test exists:
 *   - Pre-W2-D there was NO test for the security headers contract on
 *     the web-app surface. The 7 test files under src/lib/__tests__
 *     cover route helpers + middleware-helpers but not the headers.
 *   - The CSP string is concat'd from 11 directives — a typo (drop
 *     `frame-ancestors 'none'`) would re-open clickjacking surface.
 *   - The connect-src includes `${backendOrigin}` from env — if the env
 *     is unset, the directive becomes `connect-src 'self' undefined ...`
 *     which is undetectable until a fetch fails in production.
 *
 * Approach: import the NAMED export and assert each directive / header
 * literal. No NextRequest/NextResponse mocking needed — we test the
 * data, not the wiring (the wiring is integration / e2e scope).
 *
 * See: docs/handoffs/iter-W2/00-rfc.md §W2-D
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

// next/server pulls in Edge runtime globals (Request, Response, etc.)
// that jsdom doesn't define. The middleware module only uses NextResponse
// for the runtime path — pinning the `securityHeaders` constant does not
// need a working response factory. Stub it so the import resolves.
jest.mock('next/server', () => ({
    NextResponse: class { static next() { return new (this as never)(); } static redirect() { return new (this as never)(); } },
    NextRequest: class {},
}));

import { securityHeaders } from '@/middleware';

describe('W2-D web-app middleware securityHeaders — top-level keys', () => {
    it('emits X-Frame-Options: DENY (clickjacking defence — frame-ancestors backup)', () => {
        expect(securityHeaders['X-Frame-Options']).toBe('DENY');
    });

    it('emits X-Content-Type-Options: nosniff (anti MIME-sniff)', () => {
        expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
    });

    it('emits X-XSS-Protection: 1; mode=block (legacy browser defence)', () => {
        expect(securityHeaders['X-XSS-Protection']).toBe('1; mode=block');
    });

    it('emits Referrer-Policy: strict-origin-when-cross-origin (drop full referrer cross-origin)', () => {
        expect(securityHeaders['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });

    it('emits Permissions-Policy: camera/microphone denied, geolocation first-party only', () => {
        // F-PERMISSIONS-POLICY-KILLS-FIELD-GPS (2026-08-19, Phase 0 C12 real
        // walk): the blanket `geolocation=()` disabled the Geolocation API for
        // the platform's OWN onsite field app (/provider/audits/[id]/inspect) —
        // the GPS check-in errored "Geolocation has been disabled in this
        // document by permissions policy", photos then carried no coordinates
        // and the ≥5-photo evidence gate could never be satisfied. First-party
        // (self) restores the field tool; third-party iframes stay denied.
        const policy = securityHeaders['Permissions-Policy'];
        expect(policy).toContain('camera=()');
        expect(policy).toContain('microphone=()');
        expect(policy).toContain('geolocation=(self)');
        expect(policy).not.toContain('geolocation=()');
    });

    it('emits Strict-Transport-Security max-age=31536000 with includeSubDomains + preload (HSTS preload list eligible)', () => {
        const hsts = securityHeaders['Strict-Transport-Security'];
        expect(hsts).toContain('max-age=31536000');
        expect(hsts).toContain('includeSubDomains');
        expect(hsts).toContain('preload');
    });
});

describe('W2-D web-app middleware securityHeaders — CSP directives', () => {
    let csp: string;
    beforeAll(() => { csp = securityHeaders['Content-Security-Policy']; });

    it('contains default-src directive limiting to self', () => {
        expect(csp).toContain("default-src 'self'");
    });

    it('contains script-src + style-src + img-src + font-src directives', () => {
        expect(csp).toContain('script-src');
        expect(csp).toContain('style-src');
        expect(csp).toContain('img-src');
        expect(csp).toContain('font-src');
    });

    it('contains connect-src + frame-src + frame-ancestors + base-uri + form-action directives (full 11-directive surface)', () => {
        expect(csp).toContain('connect-src');
        expect(csp).toContain('frame-src');
        // frame-ancestors 'none' is the clickjacking belt to X-Frame-Options' suspenders
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("form-action 'self'");
    });

    it('connect-src includes backendOrigin from env (not literal undefined)', () => {
        const m = csp.match(/connect-src ([^;]+)/);
        expect(m).not.toBeNull();
        // Whatever NEXT_PUBLIC_BACKEND_ORIGIN resolves to at module load,
        // it MUST NOT be the literal string 'undefined' — that would mean
        // the env was unset and the directive is broken.
        expect(m![1]).not.toMatch(/\bundefined\b/);
        expect(m![1]).toContain("'self'");
    });
});

describe('CSP — data-sovereignty contract', () => {
    // This platform handles Thai citizens' registration data and the exact
    // coordinates of their farms. The CSP is the enforcement layer for the
    // rule that none of it may reach a host outside our control: even if a
    // future edit reintroduces a foreign URL in a component, the browser must
    // refuse to fetch it. These assertions are deliberately about the
    // *values* of the directives, not merely that the directives exist.
    let csp: string;
    beforeAll(() => { csp = securityHeaders['Content-Security-Policy']; });

    const directive = (name: string): string => {
        const m = csp.match(new RegExp(`(?:^|; )${name} ([^;]+)`));
        expect(m).not.toBeNull();
        return m![1];
    };

    it('names no foreign map, identity or analytics-vendor host anywhere', () => {
        // cloudflareinsights is the one deliberate exception (cookieless
        // beacon, reviewed separately) and is asserted by name below rather
        // than being caught by a blanket pattern.
        for (const host of [
            'openstreetmap.org', // third-party-allow: names the host in order to forbid it
            'tile.osm', // third-party-allow: names the host in order to forbid it
            'google.com', // third-party-allow: names the host in order to forbid it
            'googleapis.com', // third-party-allow: names the host in order to forbid it
            'gstatic.com', // third-party-allow: names the host in order to forbid it
            'identitytoolkit',
            'securetoken',
            'firebaseio.com', // third-party-allow: names the host in order to forbid it
            'mapbox.com', // third-party-allow: names the host in order to forbid it
        ]) {
            expect(csp).not.toContain(host);
        }
    });

    it('frame-src allows same-origin frames and Stripe\'s payment frames only', () => {
        // An <iframe> whose src carries farm coordinates discloses the
        // location on page load, with no click required — the worst shape
        // this leak can take. Nothing off-origin may be framed except the
        // frames Stripe documents for Stripe.js, in which the PromptPay QR
        // modal is drawn (operator ruling 2026-09-27). The page hands those
        // frames a client secret and the payer's email, no location data.
        expect(directive('frame-src')).toBe(
            "'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
        );
    });

    it('img-src carries no blanket https: — a tile or tracking pixel must not reach any host', () => {
        // A bare `https:` source-expression permits an image request to
        // *every* HTTPS host on the internet, which is exactly the hole a
        // map tile server or a tracking pixel would travel through.
        const imgSrc = directive('img-src');
        expect(imgSrc.split(/\s+/)).not.toContain('https:');
        expect(imgSrc).toContain("'self'");
        // data: and blob: stay: QR codes render as data URIs and document
        // previews as object URLs, neither of which leaves the browser.
        expect(imgSrc).toContain('data:');
        expect(imgSrc).toContain('blob:');
    });

    it('img-src still admits the backend origin, where uploaded documents live', () => {
        const imgSrc = directive('img-src');
        expect(imgSrc).not.toMatch(/\bundefined\b/);
        // Same env-derived origin connect-src uses; document previews are
        // served from there when not proxied through the Next rewrite.
        const backend = directive('connect-src')
            .split(/\s+/)
            .find((token) => token.startsWith('http') && !token.startsWith('http://localhost'));
        if (backend) {
            expect(imgSrc).toContain(backend);
        }
    });
});

describe('CSP — Sentry ingest (error tracking, re-added 2026-10-02)', () => {
    // A DSN is ingest-only and public by design, but it is baked per build, so
    // the CSP derives the one extra connect-src origin from it instead of
    // allowlisting a wildcard. The DSN's public key is userinfo, which is not
    // part of an origin and must never appear in the header.
    const DSN = 'https://abc123publickey@o4501.ingest.example.test/4502';
    const ORIGINAL = process.env.NEXT_PUBLIC_SENTRY_DSN;

    function cspWith(dsn: string | undefined): string {
        if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
        else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
        let header = '';
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            header = (require('@/middleware') as typeof import('@/middleware')).securityHeaders['Content-Security-Policy'];
        });
        return header;
    }

    function connectSrc(csp: string): string[] {
        const m = csp.match(/(?:^|; )connect-src ([^;]+)/);
        expect(m).not.toBeNull();
        return m![1].trim().split(/\s+/);
    }

    afterAll(() => {
        if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
        else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL;
    });

    it('admits exactly the DSN ingest origin in connect-src when a DSN is baked in', () => {
        const src = connectSrc(cspWith(DSN));
        expect(src).toContain('https://o4501.ingest.example.test');
        expect(src).toContain("'self'");
        expect(src).toContain('https://api.stripe.com');
    });

    it('never carries the DSN public key, a wildcard host or a bare https:', () => {
        const csp = cspWith(DSN);
        expect(csp).not.toContain('abc123publickey');
        expect(csp).not.toContain('/4502');
        expect(csp).not.toMatch(/\*\.ingest/);
        for (const name of ['connect-src', 'script-src', 'img-src', 'frame-src']) {
            const m = csp.match(new RegExp(`(?:^|; )${name} ([^;]+)`));
            expect(m![1].split(/\s+/)).not.toContain('https:');
        }
    });

    it('adds the ingest origin to connect-src only — not to script-src, img-src or frame-src', () => {
        const csp = cspWith(DSN);
        for (const name of ['script-src', 'img-src', 'frame-src']) {
            const m = csp.match(new RegExp(`(?:^|; )${name} ([^;]+)`));
            expect(m![1]).not.toContain('ingest.example.test');
        }
    });

    it('adds nothing when no DSN is set (off by default)', () => {
        const without = cspWith(undefined);
        expect(without).not.toMatch(/ingest|sentry/i);
        expect(connectSrc(without)).toEqual(connectSrc(cspWith('   ')));
    });

    it('adds nothing for an unparseable or non-http DSN', () => {
        const baseline = connectSrc(cspWith(undefined));
        expect(connectSrc(cspWith('not a url'))).toEqual(baseline);
        expect(connectSrc(cspWith('javascript:alert(1)'))).toEqual(baseline);
    });
});
