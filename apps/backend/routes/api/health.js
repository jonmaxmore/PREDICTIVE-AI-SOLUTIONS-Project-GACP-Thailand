/**
 * apps/backend/routes/api/health.js — Iter 29 readiness probe
 *
 * Splits liveness from readiness so orchestrators (k8s, systemd-with-watchdog,
 * docker compose healthcheck, blue/green load balancer) can answer two
 * distinct questions:
 *
 *   GET /api/health         → liveness    (200 if the Node process is alive)
 *   GET /api/health/ready   → readiness   (200 only when the process is
 *                                          ACTUALLY able to serve traffic:
 *                                          DB reachable + migrations applied
 *                                          + production secrets validated)
 *
 * The existing inline `/api/health` handlers in `routes/api/index.js` and
 * `server.js` remain authoritative for liveness; this module is intentionally
 * additive — mount it at `/api/health` (the readiness sub-path will not
 * collide because the inline handler is registered for the exact path '/').
 *
 * Mount example (one-line, additive in routes/api/index.js):
 *
 *     router.use('/health', require('./health'));
 *
 * The `/health` mount is fine because express matches the most-specific path
 * first: '/health/ready' here, then the catch-all '/health' handler.
 */

'use strict';

const express = require('express');

const router = express.Router();

// Lazy-load to avoid pulling Prisma / secrets into every test that requires
// this file. Tests typically stub these dependencies.
function loadPrismaHealth() {
    return require('../../services/prisma-database');
}

function loadSecretsValidator() {
    // config/secrets.js is the canonical secret catalog (Iter 27).
    return require('../../config/secrets');
}

/**
 * GET /api/health/ready
 *
 * Readiness contract (drives orchestrator traffic-routing decisions):
 *   200 — all subsystems healthy
 *   503 — any subsystem unhealthy (do NOT route traffic to this instance)
 *
 * Subsystems checked:
 *   1. Database connectivity (prisma-database healthCheck())
 *   2. Migration freshness — healthCheck() returns connected only if
 *      Prisma can issue queries against the current schema, which implies
 *      `prisma migrate deploy` has run successfully.
 *   3. Secrets catalog — validateSecretsForEnvironment(NODE_ENV) must
 *      return [] (zero missing / too-short / sentinel secrets).
 *
 * The response is intentionally verbose so deploys can grep stdout for
 * the failing subsystem without re-running the check.
 */
router.get('/ready', async (req, res) => {
    const startedAt = Date.now();
    const checks = {
        database: { ok: false, detail: null },
        secrets: { ok: false, detail: null },
    };

    // Database — readiness probe must NOT crash if Prisma is unavailable.
    try {
        const prismaDb = loadPrismaHealth();
        const dbResult = await prismaDb.healthCheck();
        checks.database.ok = dbResult && dbResult.status === 'connected';
        checks.database.detail = dbResult || { status: 'unknown' };
    } catch (err) {
        checks.database.ok = false;
        checks.database.detail = { status: 'error', message: err.message };
    }

    // Secrets — readiness fails if any production-required secret is missing,
    // pending, or too short. This catches the "deployed without rotating
    // PAYMENT_WEBHOOK_SECRET" class of regression at startup.
    try {
        const env = process.env.NODE_ENV || 'production';
        const { validateSecretsForEnvironment } = loadSecretsValidator();
        const errors = validateSecretsForEnvironment(env);
        checks.secrets.ok = errors.length === 0;
        checks.secrets.detail = {
            env,
            errorCount: errors.length,
            // Only surface NAMES — values are secret, reasons are safe.
            errors: errors.map((e) => ({ name: e.name, reason: e.reason })),
        };
    } catch (err) {
        checks.secrets.ok = false;
        checks.secrets.detail = { status: 'error', message: err.message };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    const status = allOk ? 200 : 503;
    return res.status(status).json({
        status: allOk ? 'READY' : 'NOT_READY',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        latencyMs: Date.now() - startedAt,
        checks,
    });
});

/**
 * GET /api/health  (liveness — minimal, never touches DB)
 *
 * Returns 200 OK as long as the Node event loop is alive. Used by
 * blue/green load balancers to detect a wedged process. NEVER queries
 * Prisma — that's what /ready is for.
 *
 * Note: this duplicates the inline /api/health handler in
 * routes/api/index.js. The duplication is intentional — when this router
 * is mounted at '/health', express resolves '/health' here ONLY if the
 * mount comes BEFORE the inline handler. Both responses are 200 OK with
 * the same shape, so observability remains consistent regardless of
 * which handler answered.
 */
router.get('/', (_req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
    });
});

module.exports = router;
