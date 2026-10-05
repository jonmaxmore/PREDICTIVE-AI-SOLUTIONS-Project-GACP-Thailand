/**
 * An API that answers HTML has broken its contract, whatever the status code.
 *
 * Measured against the running demo backend on 2026-09-08 (evidence in
 * a local job log — the API audit probe):
 *
 *   GET    /api/plots            404, body starts "<!DOCTYPE html>", ~1.1 KB
 *   GET    /api/does-not-exist   404, same
 *   DELETE /api/applications/my  404, same   (the path exists for GET; the METHOD does not)
 *
 * Nothing under /api catches an unmatched path, so the request falls through to
 * Express's default finalhandler, which emits an HTML error page. Every JSON
 * client — the web app's api-client, an integrating ministry, a generated SDK —
 * receives a document it cannot parse and, on the demo host, one carrying an
 * injected Cloudflare challenge script.
 *
 * The unsupported-method case is worse than untidy: 404 says "this resource does
 * not exist" when the resource does exist and only the verb is wrong. A client
 * cannot tell a typo in the path from a typo in the method.
 *
 * These tests drive the same mount order server.js uses — router first, then the
 * JSON 404 — so they fail if the handler is removed or ever mounted before the
 * routes it is meant to follow.
 */

const express = require('express');
const request = require('supertest');

const { apiNotFoundHandler } = require('../../middleware/api-not-found');

/** A miniature of server.js's mount order: some real routes, then the catch-all. */
function buildApp() {
    const app = express();
    const router = express.Router();
    router.get('/applications/my', (_req, res) => res.json({ success: true, data: [] }));
    router.post('/applications/draft', (_req, res) => res.status(201).json({ success: true, data: { id: 'x' } }));
    app.use('/api', router);
    app.use('/api/v1', router);
    app.use('/api', apiNotFoundHandler);
    app.use('/api/v1', apiNotFoundHandler);
    return app;
}

describe('an unmatched /api path answers JSON', () => {
    it('does not return HTML', async () => {
        const res = await request(buildApp()).get('/api/does-not-exist');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(String(res.text)).not.toMatch(/<!DOCTYPE html>/i);
    });

    it('carries the same envelope keys the rest of the API uses', async () => {
        const res = await request(buildApp()).get('/api/does-not-exist');
        expect(res.body).toMatchObject({
            success: false,
            code: 'ROUTE_NOT_FOUND',
        });
        expect(typeof res.body.error).toBe('string');
        expect(typeof res.body.message).toBe('string');
        // Thai copy, because this platform's users read Thai and its other
        // error responses already carry messageTh.
        expect(typeof res.body.messageTh).toBe('string');
    });

    it('names the path and method it could not route, so a client can debug it', async () => {
        const res = await request(buildApp()).get('/api/nope/deeper');
        expect(res.body.path).toBe('/api/nope/deeper');
        expect(res.body.method).toBe('GET');
    });

    it('answers on the /api/v1 alias too', async () => {
        const res = await request(buildApp()).get('/api/v1/does-not-exist');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    });
});

describe('a path that exists under another method answers 405, not 404', () => {
    it('returns 405 with an Allow header listing the methods that do exist', async () => {
        const res = await request(buildApp()).delete('/api/applications/my');
        expect(res.status).toBe(405);
        expect(res.headers.allow).toBeDefined();
        expect(res.headers.allow.split(/,\s*/)).toEqual(expect.arrayContaining(['GET']));
        expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('still answers JSON', async () => {
        const res = await request(buildApp()).put('/api/applications/draft');
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.status).toBe(405);
        expect(res.headers.allow.split(/,\s*/)).toEqual(expect.arrayContaining(['POST']));
    });

    it('does not claim 405 for a path that genuinely does not exist', async () => {
        const res = await request(buildApp()).delete('/api/no-such-resource');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    });
});

describe('routes that DO match are untouched', () => {
    it('a matching GET still returns its own body', async () => {
        const res = await request(buildApp()).get('/api/applications/my');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: [] });
    });

    it('a matching POST still returns 201', async () => {
        const res = await request(buildApp()).post('/api/applications/draft');
        expect(res.status).toBe(201);
    });
});
