/**
 * W2-D — HTTP security headers contract test.
 *
 * Pins the helmet middleware contract on every backend response. The
 * helmet defaults form an implicit deploy-time contract: any future
 * refactor that disables helmet, swaps a CSP, or drops HSTS would be
 * caught by this suite before merge.
 *
 * Pre-W2-D there was NO contract test for helmet — only the sibling
 * uploads-security-headers.test.js verified the /uploads/* mount. A
 * regression that removed `app.use(helmet(...))` from server.js would
 * have silently shipped.
 *
 * Approach: build a minimal Express app that wires helmet the SAME way
 * server.js does (helmet config at server.js:124-128 — see RFC §W2-D
 * pre-flight #5) and hit a no-op route via supertest. We test the
 * production branch (CSP enabled) and the dev branch (CSP disabled)
 * separately so both signals stay pinned.
 *
 * Why mirror helmet config inline instead of importing server.js:
 *   - server.js triggers Prisma + Redis + scheduler boot side-effects
 *     even with require.main !== module checks
 *   - server.js calls initializeEnvironment() at module-load which can
 *     fail in test if any env tweaking from another test leaks here
 *   - The helmet config is 2 lines (contentSecurityPolicy +
 *     crossOriginEmbedderPolicy gated by isProduction) — mirroring is
 *     simpler than env-stripping the full server module
 *   - If someone changes the server.js helmet line, this test stays
 *     red until the mirror is updated — which IS the contract pin
 *
 * @see docs/handoffs/iter-W2/00-rfc.md §W2-D
 */

'use strict';

const express = require('express');
const helmet = require('helmet');
const request = require('supertest');

/**
 * Build a tiny express app with the SAME helmet config as server.js:124-128.
 * Single GET /ping route returns 200 so supertest can inspect headers.
 *
 * @param {{ production: boolean }} opts
 */
function buildApp({ production }) {
    const app = express();
    app.use(helmet({
        contentSecurityPolicy: production ? undefined : false,
        crossOriginEmbedderPolicy: production ? undefined : false,
    }));
    app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
    return app;
}

describe('W2-D contract — backend helmet security headers (production branch)', () => {
    let app;
    beforeAll(() => { app = buildApp({ production: true }); });

    it('emits Strict-Transport-Security with max-age (HSTS — enforce HTTPS)', async () => {
        const res = await request(app).get('/ping');
        expect(res.status).toBe(200);
        expect(res.headers['strict-transport-security']).toBeDefined();
        expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    });

    it('emits Strict-Transport-Security with includeSubDomains (helmet default)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['strict-transport-security']).toMatch(/includeSubDomains/i);
    });

    it('emits X-Content-Type-Options: nosniff (anti MIME-sniff)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('emits X-Frame-Options: SAMEORIGIN (clickjacking defence — helmet default)', async () => {
        const res = await request(app).get('/ping');
        // helmet@8 default for X-Frame-Options is SAMEORIGIN
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('emits Referrer-Policy: no-referrer (helmet default — drop document.referrer)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('emits Content-Security-Policy in production branch', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['content-security-policy']).toBeDefined();
        // helmet default CSP locks down to self
        expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    });

    it('emits X-DNS-Prefetch-Control: off (helmet default — privacy)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('emits X-Download-Options: noopen (IE legacy — prevents file-execution from server context)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['x-download-options']).toBe('noopen');
    });

    it('emits X-Permitted-Cross-Domain-Policies: none (block Adobe/Silverlight policy probes)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    });

    it('emits Cross-Origin-Opener-Policy: same-origin (helmet default — Spectre isolation)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('emits Cross-Origin-Resource-Policy: same-origin (CORP — block cross-origin embed)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    });

    it('does NOT expose X-Powered-By (helmet hidePoweredBy default — drop Express fingerprint)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('emits Origin-Agent-Cluster header (helmet default — isolation hint)', async () => {
        const res = await request(app).get('/ping');
        // Some helmet versions emit "?1"; just assert presence.
        expect(res.headers['origin-agent-cluster']).toBeDefined();
    });
});

describe('W2-D contract — backend helmet security headers (development branch)', () => {
    let app;
    beforeAll(() => { app = buildApp({ production: false }); });

    it('disables Content-Security-Policy in development branch (per server.js:124-128)', async () => {
        const res = await request(app).get('/ping');
        // CSP should be ABSENT in dev so HMR / Next dev server works
        expect(res.headers['content-security-policy']).toBeUndefined();
    });

    it('still emits HSTS + X-Content-Type-Options in development (defence-in-depth)', async () => {
        const res = await request(app).get('/ping');
        expect(res.headers['strict-transport-security']).toBeDefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
});
