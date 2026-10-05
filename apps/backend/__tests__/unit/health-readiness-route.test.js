/**
 * Iter 29 — readiness route unit tests
 *
 * Covers the standalone router exported by `routes/api/health.js`:
 *   GET /          → 200 (liveness, never queries DB)
 *   GET /ready     → 200 when DB healthy + secrets validated
 *                  → 503 when DB unhealthy OR secrets invalid
 *
 * Both backing dependencies (`services/prisma-database` and `config/secrets`)
 * are mocked via jest.mock so the suite never touches a real database or
 * real secret manager.
 */

const express = require('express');

// NOTE: jest.mock is hoisted above all `const` declarations, so the paths
// passed to jest.mock must be string literals (relative to this file). The
// pattern below mirrors how the route module's own `require()` calls will
// resolve `../../services/prisma-database` and `../../config/secrets`.
jest.mock('../../services/prisma-database', () => ({
    healthCheck: jest.fn(),
    prisma: {},
}));

jest.mock('../../config/secrets', () => ({
    validateSecretsForEnvironment: jest.fn(),
    SECRETS_CATALOG: Object.freeze({}),
    getActiveBackend: () => 'env',
}));

const prismaDb = require('../../services/prisma-database');
const secrets = require('../../config/secrets');

function makeApp() {
    const app = express();
    // The route module is required fresh each time so the lazy-load helpers
    // pick up the active jest.mock implementations.
    const router = require('../../routes/api/health');
    app.use('/health', router);
    return app;
}

// Lightweight in-process HTTP helper that does NOT require supertest.
// We bind to an ephemeral port, fire the request, and tear the server down.
const http = require('http');
function call(app, urlPath) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
            const { port } = server.address();
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: urlPath,
                method: 'GET',
            }, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    server.close();
                    let json = null;
                    try { json = JSON.parse(body); } catch { /* tolerate non-JSON */ }
                    resolve({ status: res.statusCode, body, json });
                });
            });
            req.on('error', (err) => {
                server.close();
                reject(err);
            });
            req.end();
        });
    });
}

beforeEach(() => {
    prismaDb.healthCheck.mockReset();
    secrets.validateSecretsForEnvironment.mockReset();
});

describe('[Iter 29] GET /health (liveness)', () => {
    it('returns 200 with status OK and process metadata', async () => {
        const app = makeApp();
        const res = await call(app, '/health');
        expect(res.status).toBe(200);
        expect(res.json.status).toBe('OK');
        expect(typeof res.json.pid).toBe('number');
        expect(typeof res.json.uptimeSeconds).toBe('number');
    });

    it('does NOT call the database healthCheck (liveness must be cheap)', async () => {
        const app = makeApp();
        await call(app, '/health');
        expect(prismaDb.healthCheck).not.toHaveBeenCalled();
    });
});

describe('[Iter 29] GET /health/ready (readiness)', () => {
    it('returns 200 when DB healthy AND secrets valid', async () => {
        prismaDb.healthCheck.mockResolvedValue({ status: 'connected', ms: 4 });
        secrets.validateSecretsForEnvironment.mockReturnValue([]);

        const app = makeApp();
        const res = await call(app, '/health/ready');
        expect(res.status).toBe(200);
        expect(res.json.status).toBe('READY');
        expect(res.json.checks.database.ok).toBe(true);
        expect(res.json.checks.secrets.ok).toBe(true);
        expect(res.json.checks.secrets.detail.errorCount).toBe(0);
    });

    it('returns 503 when database is unreachable', async () => {
        prismaDb.healthCheck.mockResolvedValue({ status: 'disconnected', error: 'ECONNREFUSED' });
        secrets.validateSecretsForEnvironment.mockReturnValue([]);

        const app = makeApp();
        const res = await call(app, '/health/ready');
        expect(res.status).toBe(503);
        expect(res.json.status).toBe('NOT_READY');
        expect(res.json.checks.database.ok).toBe(false);
        expect(res.json.checks.secrets.ok).toBe(true);
    });

    it('returns 503 when secrets validator surfaces missing values', async () => {
        prismaDb.healthCheck.mockResolvedValue({ status: 'connected' });
        secrets.validateSecretsForEnvironment.mockReturnValue([
            { name: 'ENCRYPTION_KEY', reason: 'MISSING_OR_PENDING', spec: { required: 'always' } },
        ]);

        const app = makeApp();
        const res = await call(app, '/health/ready');
        expect(res.status).toBe(503);
        expect(res.json.checks.secrets.ok).toBe(false);
        expect(res.json.checks.secrets.detail.errors).toEqual([
            { name: 'ENCRYPTION_KEY', reason: 'MISSING_OR_PENDING' },
        ]);
    });

    it('returns 503 (not 500) when the database healthCheck throws', async () => {
        prismaDb.healthCheck.mockRejectedValue(new Error('boom'));
        secrets.validateSecretsForEnvironment.mockReturnValue([]);

        const app = makeApp();
        const res = await call(app, '/health/ready');
        // The readiness probe must NEVER 500 — orchestrators interpret 5xx
        // as "this instance is dead" and may take it out of rotation even if
        // the issue is just a transient probe failure.
        expect(res.status).toBe(503);
        expect(res.json.checks.database.ok).toBe(false);
        expect(res.json.checks.database.detail.status).toBe('error');
    });

    it('does NOT leak secret values in the response (only names + reasons)', async () => {
        prismaDb.healthCheck.mockResolvedValue({ status: 'connected' });
        secrets.validateSecretsForEnvironment.mockReturnValue([
            {
                name: 'HEALTH_JWT_SECRET',
                reason: 'TOO_SHORT',
                actualLength: 4,
                spec: { required: 'always', minLength: 32, description: 'JWT signing key' },
            },
        ]);

        const app = makeApp();
        const res = await call(app, '/health/ready');
        // Reason + name are safe; ensure we did NOT serialize the entire spec
        // (which could include `devFallback` factories or other internals).
        const body = res.body;
        expect(body).toContain('HEALTH_JWT_SECRET');
        expect(body).toContain('TOO_SHORT');
        expect(body).not.toContain('devFallback');
        expect(body).not.toContain('JWT signing key');
    });
});
