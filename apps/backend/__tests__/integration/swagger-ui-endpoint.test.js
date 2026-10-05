/**
 * W4-D — Swagger UI mount integration test.
 *
 * Pins the runtime contract for the `/api-docs` swagger-ui-express mount
 * and the companion `/api-docs/swagger.json` raw-spec route added in
 * `server.js` for this iteration.
 *
 * Approach (mirrors the W2-D `contract/security-headers.test.js` pattern):
 *   - Build a tiny in-memory Express app that wires `/api-docs` the
 *     SAME way `server.js:300-318` does (no DB / Redis / Prisma boot
 *     side-effects).
 *   - Hit it via supertest to verify the HTML lands at /api-docs and
 *     the JSON spec lands at /api-docs/swagger.json.
 *
 * Why not import server.js directly: per the W2-D test rationale
 * (lines 20-30 of contract/security-headers.test.js), server.js boots
 * Prisma + Redis + the scheduler even with `require.main !== module`
 * guards, which would require live infra in test. Mirroring the 3-line
 * gate inline keeps the contract pinned without that overhead.
 *
 * If the gate in server.js diverges, this mirror stops representing the
 * real behaviour — that's WHY the test mirrors verbatim: any drift
 * should be picked up at code-review on the server.js diff alongside
 * this test file.
 *
 * Contracts under test:
 *   1. With the gate enabled, GET /api-docs/ returns HTML containing
 *      the swagger-ui boot marker.
 *   2. With the gate enabled, GET /api-docs/swagger.json returns 200
 *      with an OpenAPI 3.0.0 JSON body.
 *   3. With the gate DISABLED (prod default), GET /api-docs returns 404.
 */

'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const request = require('supertest');

const swaggerSpec = require('../../config/swagger');

/**
 * Build a tiny express app that mirrors `server.js:300-318` (the
 * W4-D gate) for a given (isProduction, OPENAPI_DOCS_ENABLED) input.
 *
 * @param {{ production: boolean, openapiDocsEnabled: boolean }} opts
 */
function buildApp({ production, openapiDocsEnabled }) {
    const app = express();
    const enableApiDocs = !production || openapiDocsEnabled === true;
    if (enableApiDocs) {
        app.get('/api-docs/swagger.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(swaggerSpec));
        });
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    }
    // 404 fallback so disabled-state requests return 404 not 200 with the
    // default express empty body. supertest will see status 404.
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
    return app;
}

describe('[W4-D] Swagger UI mount — gate ENABLED (dev or prod with flag)', () => {
    let app;
    beforeAll(() => {
        app = buildApp({ production: false, openapiDocsEnabled: false });
    });

    it('GET /api-docs/ returns 200 HTML containing the swagger-ui boot marker', async () => {
        const res = await request(app).get('/api-docs/');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        // swagger-ui-express writes a script tag pointing at swagger-ui-init.js.
        // If the mount is broken (e.g. setup not called), this match fails.
        expect(res.text).toMatch(/swagger-ui/i);
    });

    it('GET /api-docs/swagger.json returns 200 with valid OpenAPI 3.0.0 JSON', async () => {
        const res = await request(app).get('/api-docs/swagger.json');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/json/);
        const body = typeof res.body === 'object' && res.body !== null
            ? res.body
            : JSON.parse(res.text);
        expect(body.openapi).toBe('3.0.0');
        expect(body.info).toBeDefined();
        expect(body.info.title).toBeDefined();
        expect(body.paths).toBeDefined();
        // Path count floor matches the unit test floor.
        expect(Object.keys(body.paths).length).toBeGreaterThanOrEqual(6);
    });

    it('GET /api-docs/swagger.json with the prod-flag-enabled gate behaves identically', async () => {
        const prodApp = buildApp({ production: true, openapiDocsEnabled: true });
        const res = await request(prodApp).get('/api-docs/swagger.json');
        expect(res.status).toBe(200);
        const body = typeof res.body === 'object' && res.body !== null
            ? res.body
            : JSON.parse(res.text);
        expect(body.openapi).toBe('3.0.0');
    });
});

describe('[W4-D] Swagger UI mount — gate DISABLED (prod default)', () => {
    let app;
    beforeAll(() => {
        app = buildApp({ production: true, openapiDocsEnabled: false });
    });

    it('GET /api-docs returns 404 when OPENAPI_DOCS_ENABLED is unset in production', async () => {
        const res = await request(app).get('/api-docs/');
        expect(res.status).toBe(404);
    });

    it('GET /api-docs/swagger.json also returns 404 when the gate is off', async () => {
        const res = await request(app).get('/api-docs/swagger.json');
        expect(res.status).toBe(404);
    });
});
