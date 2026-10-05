'use strict';

/**
 * A real Express app wired to Sentry exactly the way server.js wires it:
 * initSentry() from config/sentry.js reading this process's environment, then
 * routes, then attachSentryErrorHandler(), then a terminal error handler.
 *
 * Spawned as a CHILD PROCESS by sentry-express-envelope.test.js so the Sentry
 * SDK's process-wide hooks (unhandledRejection, http diagnostics channels) never
 * leak into the jest process that runs the rest of the suite.
 *
 * Prints one JSON line `{ "port": n }` on stdout once it is listening.
 */
const http = require('http');
const path = require('path');

const { initSentry, attachSentryErrorHandler } = require('../../../config/sentry');

const Sentry = initSentry();

const express = require('express');

const app = express();
app.use(express.json());

// The error message deliberately embeds a value from the body, a header and
// the query string, the way a careless `throw new Error(\`... ${x}\`)` would.
// The path carries an ID too (route parameter).
app.post('/api/applications/:nationalId/lookup', (req) => {
    throw new Error(
        `[TEST] ไม่พบผู้ยื่น ${req.body.nationalId} ${req.get('x-applicant-email')} ${req.query.token}`,
    );
});

// An unhandled promise rejection carrying an ID. The process is expected to
// report it and then exit non-zero (Node's own default for an unhandled
// rejection), not to keep serving.
app.post('/api/applications/reject', (req, res) => {
    Promise.reject(new Error(`[TEST] rejection ${req.body.nationalId}`));
    res.status(202).json({ queued: true });
});

// A search box: the officer types a name, the route fails.
app.get('/api/v2/provider/applications', () => {
    throw new Error('[TEST] search failed');
});

// An outbound call whose query carries a name, then a failure: the http.client
// span and breadcrumb carry that URL.
app.get('/api/echo', (_req, res) => res.json({ ok: true }));
app.get('/api/outbound', (req, _res, next) => {
    const { port } = req.socket.address();
    http.get(`http://127.0.0.1:${port}/api/echo?q=${encodeURIComponent(req.query.who || '')}`, (r) => {
        r.resume();
        r.on('end', () => next(new Error('[TEST] after outbound')));
    }).on('error', next);
});

// The same, with the name in the PATH of the outbound call (percent-encoded Thai).
app.get('/api/echo/:who', (_req, res) => res.json({ ok: true }));
app.get('/api/outbound-path', (req, _res, next) => {
    const { port } = req.socket.address();
    http.get(`http://127.0.0.1:${port}/api/echo/${encodeURIComponent(req.query.who || '')}`, (r) => {
        r.resume();
        r.on('end', () => next(new Error('[TEST] after outbound path')));
    }).on('error', next);
});

// A context shaped like the one @sentry/nextjs sets on the web server.
app.get('/api/nextjs-context', (req) => {
    Sentry.setContext('nextjs', { request_path: `/health/applications/${encodeURIComponent(req.query.who || '')}`, router_kind: 'App Router' });
    throw new Error('[TEST] nextjs context');
});

// Real Prisma errors, when the test hands this process a scratch database.
if (process.env.SENTRY_FIXTURE_DATABASE_URL) {
     
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.SENTRY_FIXTURE_DATABASE_URL } } });
    // A validation error: Prisma prints the whole argument tree, values included.
    app.post('/api/prisma/validation', async (req, _res, next) => {
        try {
            await prisma.user.create({ data: { ...req.body, bogusField: 1 } });
        } catch (e) { next(e); }
    });
    // Raw-query errors: Postgres echoes the failing row and the duplicate key.
    app.post('/api/prisma/raw', async (req, _res, next) => {
        try {
            await prisma.$executeRawUnsafe(req.body.sql);
        } catch (e) { next(e); }
    });
}

// Test-only introspection: what did this process load and connect to?
app.get('/__report', (_req, res) => {
    const sdkLoaded = Object.keys(require.cache).some((file) => file.includes(`${path.sep}@sentry${path.sep}`));
    res.json({ sdkLoaded, connects: globalThis.__outboundConnects || null });
});

attachSentryErrorHandler(app, Sentry);

 
app.use((err, _req, res, _next) => {
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR' });
});

const server = app.listen(0, '127.0.0.1', () => {
    process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
