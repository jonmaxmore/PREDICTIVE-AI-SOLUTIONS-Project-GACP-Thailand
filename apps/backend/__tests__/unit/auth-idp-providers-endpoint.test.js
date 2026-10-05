'use strict';
/**
 * GET /api/auth/idp/providers — the states-only feed the login chooser renders
 * from. getAuthProviders() (auth-providers.js:150) was documented as "P2
 * endpoint / P4 FE" the day it was written; this is that endpoint, mounted at
 * last. Until it existed the chooser hardcoded THAID_AWAITING_CREDENTIALS=true
 * (login-chooser.tsx:164), so no delivered credential could ever clear a badge.
 *
 * The one property that matters most: STATES ONLY. getProviderConfig() carries
 * client secrets and stays backend-internal; a response that grew a `config`
 * or `url` field would hand the OAuth wiring to every anonymous visitor.
 */
const express = require('express');
const request = require('supertest');

function buildApp() {
    const router = require('../../routes/api/auth/auth-idp');
    const app = express();
    app.use(express.json());
    app.use('/api/auth/idp', router);
    return app;
}

describe('GET /api/auth/idp/providers', () => {
    const saved = { ...process.env };
    afterEach(() => {
        process.env = { ...saved };
        jest.resetModules();
    });

    it('answers 200 with every provider key and its effective state', async () => {
        const app = buildApp();
        const r = await request(app).get('/api/auth/idp/providers');
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
        const keys = r.body.data.providers.map((p) => p.key).sort();
        expect(keys).toEqual(['healthid', 'local', 'providerid', 'thaid']);
        for (const p of r.body.data.providers) {
            expect(['enabled', 'staging_only', 'coming_soon']).toContain(p.state);
            expect(typeof p.enabled).toBe('boolean');
        }
    });

    it('pins a POSITIVE state — local resolves enabled, so a handler that answers coming_soon for everything cannot pass', async () => {
        // Audit finding on the first build: every assertion accepted any state in
        // the vocabulary, so a handler mutated to return coming_soon across the
        // board — the exact "badge lies" failure spec §3.1 exists to prevent —
        // passed all five tests. local has no REQUIRED_ENV and defaults enabled,
        // in every environment this suite runs in, so it is the stable positive.
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        const local = r.body.data.providers.find((p) => p.key === 'local');
        expect(local.state).toBe('enabled');
        expect(local.enabled).toBe(true);
    });

    it('DISCRIMINATES: staging_only on real production reports enabled:false while the state string alone would read as usable', async () => {
        // The deep review called the previous coverage tautological — it
        // compared the endpoint to isProviderEnabled() in the same process,
        // which any consistent bug passes. This case pins an asymmetry that
        // only the resolved flag captures: a provider REQUESTED staging_only,
        // fully configured, on NODE_ENV=production with no staging slot. The
        // state stays 'staging_only'; usable it is not. The first chooser
        // build guessed 'usable' from the string — exactly this trap.
        process.env.NODE_ENV = 'production';
        delete process.env.GACP_DEPLOY_SLOT;
        process.env.AUTH_THAID_STATE = 'staging_only';
        process.env.AUTH_THAID_CLIENT_ID = 'x';
        process.env.AUTH_THAID_CLIENT_SECRET = 'x';
        process.env.AUTH_THAID_REDIRECT_URI = 'https://x.example/cb';
        process.env.AUTH_THAID_AUTHORIZE_URL = 'https://x.example/auth';
        process.env.AUTH_THAID_TOKEN_URL = 'https://x.example/token';
        process.env.AUTH_THAID_INTROSPECT_URL = 'https://x.example/introspect';
        process.env.AUTH_THAID_SCOPE = 'openid pid';
        jest.resetModules();
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        const thaid = r.body.data.providers.find((p) => p.key === 'thaid');
        expect(thaid.state).toBe('staging_only');
        expect(thaid.enabled).toBe(false);
    });

    it('resolves enabled for the frontend — staging_only is not a state a browser can interpret', async () => {
        // Whether staging_only means "usable here" depends on isProduction() and
        // the staging slot, which only the backend knows. The endpoint therefore
        // ships the verdict, not homework: enabled must agree with
        // isProviderEnabled() for every provider, every time.
        jest.resetModules();
        const { isProviderEnabled } = require('../../config/auth-providers');
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        for (const p of r.body.data.providers) {
            expect(p.enabled).toBe(isProviderEnabled(p.key));
        }
    });

    it('reflects the fail-closed resolver, not the raw defaults — thaid without env is coming_soon', async () => {
        // EMPTY, not deleted. `delete` does not survive the require below: this
        // repo's modules pull in dotenv, which skips keys already present in
        // process.env but happily re-adds a key that was removed — so on any
        // machine whose apps/backend/.env carries real ThaiD sandbox credentials
        // (this one does), the variable came straight back and the test asserted
        // its opposite. An empty string is present, so dotenv leaves it alone,
        // and the resolver's Boolean(process.env[name]) reads it as missing
        // (config/auth-providers.js:117).
        process.env.AUTH_THAID_CLIENT_ID = ''; // one missing var is enough to fail closed
        jest.resetModules();
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        const thaid = r.body.data.providers.find((p) => p.key === 'thaid');
        expect(thaid.state).toBe('coming_soon');
    });

    it('never leaks anything beyond key, state and the resolved enabled flag', async () => {
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        for (const p of r.body.data.providers) {
            expect(Object.keys(p).sort()).toEqual(['enabled', 'key', 'state']);
        }
    });

    it('is never cached — a delivered credential must flip the badge without a deploy', async () => {
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        expect(r.headers['cache-control']).toBe('no-store');
    });

    it('requires no authentication — the login page has no session yet', async () => {
        // Pins 200 exactly. The first version asserted only "not 401/403",
        // which a 404 satisfies — the implementer's own RED artifact showed it
        // green with the route absent. An assertion that cannot fail while the
        // feature is missing is not an assertion about the feature.
        const r = await request(buildApp()).get('/api/auth/idp/providers');
        expect(r.status).toBe(200);
    });
});
