/**
 * GACP Platform - Production Server
 * Entry point for the backend application
 * Database: PostgreSQL (Prisma)
 */

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// SECURITY: Validate Environment Variables at Startup
// This must run BEFORE any other initialization to catch missing secrets early
const { initializeEnvironment } = require('./config/env-validator');
try {
    initializeEnvironment();
} catch (error) {
    console.error('STARTUP FAILED - Environment validation failed');
    console.error(error.message);
    process.exit(1);
}

// SECURITY (W2-C): Defence-in-depth — refuse production boot if any
// production-required secret in SECRETS_CATALOG is missing, holds the
// PENDING_FINANCE_CONFIRMATION sentinel, or is shorter than its minLength.
// In dev/test this is a silent no-op so local workflows are not disturbed.
const { validateProductionSecretsAtBoot, validateSigningKeyAtBoot } = require('./config/boot-secret-guard');
try {
    validateProductionSecretsAtBoot();
} catch (error) {
    console.error('STARTUP FAILED - Production secret sentinel guard error');
    console.error(error.message);
    process.exit(1);
}

// RULING 2 (2026-08-22): refuse to boot when the certificate signing key is
// missing, unusable, or not the pinned key. Runs here — before the app is
// built — because the failure it prevents is silent: the retired behaviour
// generated a replacement key, which invalidates every certificate already
// issued. Only active where a key is required (production, or
// REQUIRE_SIGNING_KEY=true); dev still generates a throwaway key, loudly.
try {
    validateSigningKeyAtBoot();
} catch (error) {
    console.error('STARTUP FAILED - certificate signing key guard error');
    console.error(error.message);
    process.exit(1);
}

// Error tracking (Sentry) — re-added 2026-10-02 by operator decision, with PII
// scrubbing. Off unless SENTRY_DSN is set; with no DSN the SDK is never loaded.
// Initialised here, before Express is required, so the SDK can instrument it.
// config/sentry.js says what is scrubbed; runbook docs/operations/sentry-error-tracking.md.
const { initSentry, attachSentryErrorHandler } = require('./config/sentry');
const Sentry = initSentry();

const logger = require('./shared/logger');
const { sendErrorResponse, classifyPrismaError, safeErrorMessage } = require('./shared/api-response');
const {
    attachClientIp,
    getRequestIp,
    isTrustedProxyIp,
    normalizeIp,
} = require('./utils/client-ip');

function redactDatabaseUrl(url) {
    if (!url || typeof url !== 'string') { return url; }
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '***';
        }
        return parsed.toString();
    } catch {
        const re = new RegExp('://([^:/]+):([^@]+)@', 'g');
        return url.replace(re, '://$1:***@');
    }
}
logger.info('SERVER STARTUP - DATABASE_URL:', redactDatabaseUrl(process.env.DATABASE_URL));
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const prismaDatabase = require('./services/prisma-database'); // PostgreSQL
const redisService = require('./services/redis-service');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { apiVersionMiddleware } = require('./middleware/api-version');

// Import Modules
const apiRoutes = require('./routes/api');
const plotsRouter = require('./routes/api/cultivation/plots');
const publicTraceRouter = require('./routes/public-trace');
const promMetrics = require('./shared/prometheus');

const app = express();
const port = process.env.PORT || 3000; // NOTE: Database and Redis connection moved to after app.listen() for graceful degradation
const isProduction = process.env.NODE_ENV === 'production';
// NODE_ENV carries three deployed values here, not two: `development`,
// `staging` (docker-compose.staging.yml:64) and `production`. Staging is a
// public host, so the debug surfaces that belong on a developer's machine —
// stack traces in error bodies, CSP/COEP switched off, Swagger open by
// default — must key off "am I a developer machine?", not off "am I not
// production?". `isProduction` keeps its own meaning and its own callers
// (notably the CORS allowlist below, where staging genuinely wants the
// developer-port defaults).
const exposesDebugSurfaces = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

const normalizeOriginValue = (value) => String(value || '').trim().replace(/\/+$/, '');
const parseOriginList = (value) => String(value || '')
    .split(',')
    .map((entry) => normalizeOriginValue(entry))
    .filter(Boolean);

// Trust only proxies allowed by hardened client-ip policy (private ranges / explicit allowlist).
app.set('trust proxy', (ip) => isTrustedProxyIp(normalizeIp(ip)));

const rateLimit = require('express-rate-limit');
const { createIdpRateLimit } = require('./middleware/idp-rate-limit');

// Middleware
// JSON and form bodies: 1 MB, except the herb bulk-import path (5 MB). Was 10 MB
// on every path (BACK-01). Still captures req.rawBody for webhook signature
// verification. Numbers and reasons are in middleware/body-parsers.js.
const { mountBodyParsers } = require('./middleware/body-parsers');
mountBodyParsers(app);

// Input Sanitization — Defense-in-depth XSS/injection prevention.
// Lab webhook callbacks are signed payloads whose body must not be mutated
// before HMAC verification, so we exclude them from sanitization.
const { sanitizeInput } = require('./middleware/sanitize-input');
const SANITIZE_BYPASS = /^\/api(?:\/v\d+)?\/callbacks(?:\/|$)/;
app.use((req, res, next) => {
    if (SANITIZE_BYPASS.test(req.path)) { return next(); }
    return sanitizeInput(req, res, next);
});

// Attach request id on every request for traceability and client-side callback debugging.
app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'];
    req.id = typeof requestId === 'string' && requestId.trim() ? requestId : crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
});
app.use(attachClientIp);

// Service Availability Check (Graceful 503)
app.use(require('./middleware/service-availability'));

// Security Hardening
app.use(helmet({
    contentSecurityPolicy: exposesDebugSurfaces ? false : undefined,
    crossOriginEmbedderPolicy: exposesDebugSurfaces ? false : undefined,
}));

// CORS Configuration
const productionDefaultOrigins = [
    'https://gacpth.com',
    'https://www.gacpth.com',
    'https://admin.gacpth.com',
    'http://localhost:3000',
    'https://localhost',
];
const developmentDefaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'https://localhost',
];
const envDrivenOrigins = [
    ...parseOriginList(process.env.CORS_ORIGIN),
    ...parseOriginList(process.env.CORS_ORIGINS),
    ...parseOriginList(process.env.FRONTEND_URL),
    ...parseOriginList(process.env.PUBLIC_WEB_URL),
    ...parseOriginList(process.env.APP_PUBLIC_URL),
];
const allowedOrigins = new Set(
    (isProduction ? productionDefaultOrigins : developmentDefaultOrigins)
        .map(normalizeOriginValue)
        .concat(envDrivenOrigins),
);

// Public trace API — open CORS for downstream partners
// (e-commerce, pharmacies, exporters can scan QR and verify from any domain)
app.use('/api/trace', cors({
    origin: '*',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
    maxAge: 86400,
}));

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) { return callback(null, true); }
        const normalizedOrigin = normalizeOriginValue(origin);
        // Allow 127.0.0.1 with any port (for IDE proxy testing)
        if (normalizedOrigin.startsWith('http://127.0.0.1:')) { return callback(null, true); }
        if (!allowedOrigins.has(normalizedOrigin)) {
            // callback(null, false) — DENY, do not THROW. Passing an Error here makes
            // the cors middleware call next(err), which reaches the global error
            // handler and answers 500. Measured on demo 2026-09-08: a preflight from
            // an unknown Origin returned HTTP 500 with an INTERNAL_SERVER_ERROR body,
            // and so did a plain GET carrying one. That turns every bot, scanner and
            // mis-configured partner into a server-error entry, buries real 500s in
            // monitoring, and hands anyone a one-request way to manufacture them.
            // A denial is not a failure: with no allow-origin header the browser
            // blocks the response itself, which is the whole mechanism.
            return callback(null, false);
        }
        return callback(null, true);
    },
    credentials: true,
}));

// Rate Limiting
function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldSkipAuthRateLimit() {
    const isTest = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test';
    const isCI = String(process.env.CI || '').trim().toLowerCase() === 'true';
    const isDisabled = String(process.env.DISABLE_AUTH_RATE_LIMIT || '').trim().toLowerCase() === 'true';
    return isTest || isCI || isDisabled;
}

function authRateLimitHandler(message) {
    return (req, res) => {
        res.status(429).json({
            success: false,
            code: 'RATE_LIMITED',
            error: message,
            requestId: req.id || 'unknown',
        });
    };
}

const globalLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
    max: parsePositiveInt(process.env.RATE_LIMIT_MAX, 1000), // Limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => getRequestIp(req),
    message: 'Too many requests from this IP, please try again later.',
});

const authLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes (was 1 hour)
    max: parsePositiveInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, 50), // 50 failed attempts per IP per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => getRequestIp(req),
    skip: shouldSkipAuthRateLimit,
    skipSuccessfulRequests: true, // Don't count successful logins
    handler: authRateLimitHandler('Too many login attempts. Please try again later.'),
});

const registerLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.AUTH_REGISTER_RATE_LIMIT_WINDOW_MS, 30 * 60 * 1000), // 30 minutes (was 1 hour)
    max: parsePositiveInt(process.env.AUTH_REGISTER_RATE_LIMIT_MAX, 20),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => getRequestIp(req),
    skip: shouldSkipAuthRateLimit,
    handler: authRateLimitHandler('Too many registration attempts. Please try again later.'),
});

const checkIdentifierLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.AUTH_CHECK_IDENTIFIER_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000), // 10 minutes
    max: parsePositiveInt(process.env.AUTH_CHECK_IDENTIFIER_RATE_LIMIT_MAX, 45),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => getRequestIp(req),
    skip: shouldSkipAuthRateLimit,
    handler: authRateLimitHandler('Too many identifier checks. Please wait and try again.'),
});

// Changing your own password needs the current one, so a stolen session could
// try passwords against it. Before 2026-09-26 the applicant door had only the
// global 1000/15min IP cap. One limiter now guards BOTH own-password doors
// (applicant + staff, the staff one new on 2026-09-26) and counts failures only:
// a successful change never uses up the budget.
const changePasswordLimiter = rateLimit({
    windowMs: parsePositiveInt(process.env.AUTH_CHANGE_PASSWORD_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
    max: parsePositiveInt(process.env.AUTH_CHANGE_PASSWORD_RATE_LIMIT_MAX, 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => getRequestIp(req),
    skip: shouldSkipAuthRateLimit,
    skipSuccessfulRequests: true,
    handler: authRateLimitHandler('Too many password change attempts. Please wait and try again.'),
});

// L-6 (audit 2026-06-11) gave password reset its own limiter. There is no reset
// path left to guard: the request endpoint went 2026-09-16 (no forgot-password
// by email or SMS) and the staff-issued token redemption 2026-09-17 (operator:
// no account recovery), so the limiter and its mount went with them.

app.use('/api', globalLimiter);
// Mount the per-endpoint auth limiters on BOTH the unversioned path and the
// /api/v1 alias. The API router is mounted on both `/api` and `/api/v1` (below),
// but these limiters previously only matched `/api/auth/...`, so EVERY one was
// trivially bypassed by hitting `/api/v1/auth/...` (audit M-2). Express app.use
// is prefix-match, so each (prefix, path) pair must be registered explicitly.
// Reusing the same limiter instance across both prefixes shares the per-IP
// counter — an attacker can't double the budget by alternating prefixes.
for (const prefix of ['/api', '/api/v1']) {
    app.use(`${prefix}/auth/health/login`, authLimiter);
    app.use(`${prefix}/auth/provider/login`, authLimiter);
    // AUTH-01 P2: OAuth IdP endpoints (authorize-url + callback) share the
    // SAME limiter instance as the login routes — authorize-url mints state
    // cookies and callback drives outbound IdP token exchanges, both
    // brute-forceable login surfaces (mandate §D3). Prefix mount covers
    // every /auth/idp/:provider/* sub-path on both API prefixes.
    //
    // ONE carve-out: GET /providers steps out of the strict login limiter —
    // its per-IP bucket is SHARED with the login routes above, so one NAT
    // office fumbling 50 logins in 15 minutes would take the public states
    // feed (and with it the ministry-mandated buttons) down. globalLimiter
    // still covers abuse. The wrapper lives in middleware/idp-rate-limit.js
    // as a factory because the E1 deep review PROVED the inline form was
    // pinned only by source regexes: inverting the branch passed every test.
    // The factory's own suite mounts it in express and counts real requests.
    app.use(`${prefix}/auth/idp`, createIdpRateLimit({ authLimiter }));
    app.use(`${prefix}/auth/health/register`, registerLimiter);
    app.use(`${prefix}/auth/health/check-identifier`, checkIdentifierLimiter);
    app.use(`${prefix}/auth/health/change-password`, changePasswordLimiter);
    app.use(`${prefix}/auth/provider/change-password`, changePasswordLimiter);
}

// Payment & Webhook Rate Limiting
const { paymentLimiter } = require('./middleware/rate-limiter');
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 webhook calls per minute
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req => getRequestIp(req),
    message: 'Too many webhook requests',
});
app.use('/api/payments/create', paymentLimiter);
app.use('/api/payments/phase1', paymentLimiter);
app.use('/api/payments/phase2', paymentLimiter);
// W11-2 — /checkout was the one money-creating payments route left outside this
// budget: it mints a Stripe PaymentIntent per call
// (routes/api/finance/payments.js → createCheckoutForApplication), and only the
// 100-req/min globalLimiter stood in front of it. Same existing middleware, no
// money logic touched. Pinned by payment-limiter-covers-checkout.test.js.
app.use('/api/payments/checkout', paymentLimiter);
app.use('/api/callbacks', webhookLimiter);

app.use(compression());
// W1-2 — the `:url` token in morgan's `combined` format prints the query string
// verbatim, and shared/logger.js has no scrubbing transport. Signed `/uploads`
// URLs carry their signature in the query string (the only place a browser
// <img> can put one), so override the token BEFORE mounting morgan so no
// credential ever reaches an access log. Non-secret params stay readable.
const { redactUrlForLog } = require('./shared/log-redact');
morgan.token('url', (req) => redactUrlForLog(req.originalUrl || req.url));
app.use(morgan('combined', { stream: logger.stream }));
app.use(cookieParser());

// CSRF protection for cookie-based auth (double-submit cookie).
// Extracted to apps/backend/middleware/csrf-middleware.js (W2-D) so the
// branching logic can be unit-tested in isolation. Defaults preserve the
// original closure behaviour 1:1.
const csrfDoubleSubmit = require('./middleware/csrf-middleware');
app.use(csrfDoubleSubmit());

// Serve uploaded files statically
// PDPA Section 27 hardening — see middleware/uploads-security-headers.js for full rationale.
// MUST run BEFORE express.static so the headers land on every served file (biometric photos,
// GACP audit photos, GPS-tagged field images, CAR documents).
const uploadsSecurityHeaders = require('./middleware/uploads-security-headers');
// SEC-AUDIT-002: gate PRECISELY the sensitive /uploads paths (ID-card/avatar root
// files), NOT the whole mount — a blanket gate broke the public
// consumer trace page's lab-report links. Subfolders that may host intended-public
// assets stay public. See middleware/uploads-access.js + the remediation log; the
// broader signed-URL/bucket-separation fix for application-draft docs is deferred.
// gateSlipObjectAccess is now a fail-closed stub: the bank-slip rail is retired
// (Stripe-only, 2026-09-06), no slip objects are written, and any /uploads/slips/*
// request is answered 404 before express.static can stream bytes. It stays mounted
// so a stale URL cannot become servable if the static mount ever moves.
const { gateSensitiveUploads, gateSlipObjectAccess } = require('./middleware/uploads-access');
app.use('/uploads', gateSensitiveUploads, gateSlipObjectAccess, uploadsSecurityHeaders, express.static(path.join(__dirname, 'public/uploads')));
app.use('/trace', publicTraceRouter);
// API Versioning
app.use(apiVersionMiddleware);

// Mount Routes
app.use('/api', apiRoutes); // Unified API routes (no /v2 prefix)
app.use('/api/v1', apiRoutes); // Versioned alias — /api/v1/health → same as /api/health
app.use('/api', plotsRouter); // [NEW] Mount Plot Routes
app.use('/api/v1', plotsRouter); // Versioned alias


// W4-D — `/api-docs` Swagger UI mount.
//
// Dev / test: ON by default (operability for builders).
// Staging / production: OFF by default — operability info-leak hardening.
// W4-D wrote this gate as `!isProduction`, which read as "dev and test" but
// also let staging, a public host, serve the spec. Ops can still flip the
// `OPENAPI_DOCS_ENABLED=true` env flag to opt-in on either deployed
// environment during integrator-support windows. See
// `apps/backend/config/secrets.js` SECRETS_CATALOG entry and
// `docs/handoffs/iter-W4/W4-D.md`.
//
// Two routes are mounted as a pair:
//   GET /api-docs               → swagger-ui HTML
//   GET /api-docs/swagger.json  → raw OpenAPI 3.0 JSON spec
// `swagger-ui-express` does not auto-expose the JSON, so we add the JSON
// route explicitly so integrators can `curl` the spec without scraping.
const enableApiDocs = exposesDebugSurfaces || process.env.OPENAPI_DOCS_ENABLED === 'true';
if (enableApiDocs) {
    app.get('/api-docs/swagger.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(swaggerSpec));
    });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Health Check - Both /health and /api/health for compatibility
app.get(['/health', '/api/health'], async (req, res) => {
    try {
        const dbHealth = await prismaDatabase.healthCheck();
        res.json({
            status: 'OK',
            timestamp: new Date(),
            environment: process.env.NODE_ENV,
            database: dbHealth,
            redis: {
                connected: redisService.isAvailable(),
            },
        });
    } catch (error) {
        res.status(503).json({
            status: 'ERROR',
            timestamp: new Date(),
            error: error.message,
        });
    }
});

// Prometheus metrics — scraped by the monitoring stack over the internal
// network (not exposed publicly). Returns the text exposition format
// (Content-Type: text/plain; version=0.0.4), distinct from the JSON at
// /api/metrics used by the admin dashboard.
app.get('/metrics', async (_req, res) => {
    try {
        promMetrics.refreshAppMetrics();
        res.set('Content-Type', promMetrics.register.contentType);
        res.end(await promMetrics.register.metrics());
    } catch (error) {
        res.status(500).end(error.message);
    }
});

// Unmatched /api paths answer JSON, not Express's HTML error page — and a path that
// exists under a different verb answers 405 with an Allow header instead of a
// misleading 404. Mounted here deliberately: after every API router, before the
// global error handler. See middleware/api-not-found.js for the measurements.
const { apiNotFoundHandler } = require('./middleware/api-not-found');
app.use('/api', apiNotFoundHandler);
app.use('/api/v1', apiNotFoundHandler);

// Sentry's error handler sits after every route and before the global handler,
// so it sees the error first and passes it on unchanged. Only 5xx are reported.
// A no-op when SENTRY_DSN is unset.
attachSentryErrorHandler(app, Sentry);

// Global Error Handler
const { requestLimitRefusal } = require('./middleware/request-limit-errors');
app.use((err, req, res, _next) => {
    // A body past a multer or body-parser limit is the sender's doing: 413/400
    // with a catalogued code and Thai, one warn line, no stack (BACK-16).
    const limitRefusal = requestLimitRefusal(err, req);
    if (limitRefusal) {
        logger.warn(limitRefusal.logMessage, limitRefusal.logMeta);
        return sendErrorResponse(res, req, limitRefusal.response);
    }

    logger.error(err.stack);

    // Map propagated/uncaught Prisma client-caused errors to the right status
    // (bad input -> 400, missing record -> 404, unique/FK -> 409) instead of
    // letting them fall through to a blanket 500.
    const prismaMapped = classifyPrismaError(err);
    const statusCode = prismaMapped
        ? prismaMapped.status
        : (Number.isInteger(err?.statusCode) ? err.statusCode : 500);
    const code = prismaMapped
        ? prismaMapped.code
        : (err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED'));
    const message = statusCode >= 500
        ? 'Internal server error'
        : (prismaMapped ? safeErrorMessage(err) : (err.message || 'Request failed'));

    // `messageTh` is left to `sendErrorResponse`, which resolves it from
    // DEFAULT_ERROR_MESSAGES in shared/api-response.js (the Thai catalogue
    // mirrored by shared/error-codes.js) for the resolved `code`. This slot
    // used to be filled with the English 'Internal server error' on 5xx —
    // a field named `messageTh` carrying English, which the web client reads
    // first (apps/web-app/src/lib/api/api-client.ts:316) and shows to the
    // applicant. Restating any Thai string here would fork that catalogue.
    return sendErrorResponse(res, req, {
        status: statusCode,
        code,
        message,
        details: exposesDebugSurfaces && err.stack ? { stack: err.stack } : null,
    });
});

async function gracefulShutdown(signal) {
    logger.info(`\n ${signal} received — shutting down gracefully...`);
    
    // Stop accepting new connections
    if (server) {
        server.close(() => logger.info('HTTP server closed'));
    }
    
    // Disconnect database
    try {
        await prismaDatabase.disconnect();
        logger.info('PostgreSQL disconnected');
    } catch { /* ignore */ }
    
    // Disconnect Redis
    try {
        await redisService.disconnect();
        logger.info('Redis disconnected');
    } catch { /* ignore */ }
    
    logger.info('Goodbye!');
    
    // Force exit after 10s if connections don't close
    setTimeout(() => {
        logger.warn('Force exit after 10s timeout');
        process.exit(1);
    }, 10000).unref();
}

// Start Server & Graceful Shutdown
let server = null;
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
    server = app.listen(port, '0.0.0.0', () => {
        logger.info(`GACP Backend running on port ${port}`);
        logger.info(`Server accepting requests on 0.0.0.0:${port}`);
        logger.info(`Environment: ${process.env.NODE_ENV}`);

        if (process.env.NODE_ENV !== 'test') {
            setImmediate(async () => {
                try {
                    await prismaDatabase.connect();
                    logger.info('PostgreSQL connected (Prisma)');

                    // The database must be at the migration level this tree was built for.
                    // 2026-08-26: the tree had three migrations the shared database had never
                    // seen; the boot passed, every read passed, health passed, and the first
                    // WRITE to a new column — an auditor's onsite photograph — returned 500.
                    // Same shape as the receipt-allocator check below and the signing-key
                    // guard above: a server that would fail its first important write is
                    // better off refusing to serve. Strict in production (and under
                    // REQUIRE_MIGRATIONS_CURRENT=true); a loud ERROR line elsewhere, so a
                    // developer sees "you forgot to migrate" instead of "the photo door is
                    // broken". It never applies anything — a boot that mutates schema is the
                    // seed-on-require defect wearing a different hat.
                    try {
                        const { assertMigrationLevelAtBoot } = require('./config/migration-level-guard');
                        await assertMigrationLevelAtBoot(prismaDatabase.prisma, { logger });
                    } catch (migrationErr) {
                        logger.error(`[boot] CRITICAL - ${migrationErr.message}`);
                        process.exit(1);
                    }

                    try {
                        await redisService.connect();
                        logger.info('Redis connected');
                    } catch (redisErr) {
                        logger.warn(`Redis failed to connect: ${redisErr.message}. Running without caching.`);
                    }

                    // [R6-B] Boot-time canonical-allocator verification.
                    // The receipt-sequence migration must exist before any receipt-
                    // numbering call runs, otherwise the upsert-in-transaction will
                    // throw and (worst case in legacy code paths) silently fall
                    // back to in-memory sequences. R5-B hardened the runtime path;
                    // this hook makes a misconfigured prod boot fail loud with
                    // exit(1) before any cron / receipt request can race in.
                    try {
                        const receiptNumberingService = require('./services/receipt-numbering-service');
                        const allocatorCheck = await receiptNumberingService.assertCanonicalAllocator();
                        if (!allocatorCheck.ok) {
                            if (process.env.NODE_ENV === 'production') {
                                logger.error(
                                    `[boot] CRITICAL - receipt-sequence migration missing: ${allocatorCheck.reason}. `
                                    + 'Run `npx prisma migrate deploy`.',
                                );
                                process.exit(1);
                            }
                            logger.warn(`[boot] receipt-sequence allocator unavailable (non-prod): ${allocatorCheck.reason}`);
                        } else {
                            logger.info('[boot] receipt-sequence allocator verified');
                        }
                    } catch (assertErr) {
                        logger.warn(`[boot] assertCanonicalAllocator threw: ${assertErr.message}`);
                    }

                    // ธงค้นหาด้วย HMAC ต้องเปิดหลังคอลัมน์ถูกเติมเสมอ ไม่ใช่ก่อน
                    // 2026-09-07 บน demo เปิดธงไว้โดยที่ backfill ไม่เคยรัน ⇒ เกษตรกร 3 ราย
                    // และพนักงานทั้ง 5 ราย = ทุกบัญชีที่มีอยู่ ล็อกอินไม่ได้เลย และหน้าจอบอกว่า
                    // "ไม่พบผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" ซึ่งชี้ไปผิดทางสนิท
                    // เว็บที่บูตขึ้นแต่ไม่มีใครล็อกอินได้ แย่กว่าเว็บที่ไม่ยอมบูตแล้วบอกเหตุผล
                    try {
                        const { checkLookupColumnsBackfilled, describeMissing } = require('./services/auth/lookup-column-readiness');
                        const readiness = await checkLookupColumnsBackfilled(prismaDatabase.prisma);
                        if (!readiness.ok) {
                            if (process.env.NODE_ENV === 'production') {
                                logger.error(`[boot] CRITICAL - ${describeMissing(readiness.missing)}`);
                                process.exit(1);
                            }
                            logger.warn(`[boot] ${describeMissing(readiness.missing)}`);
                        } else if (readiness.enabled) {
                            logger.info('[boot] national-id lookup columns verified');
                        }
                    } catch (readinessErr) {
                        logger.warn(`[boot] lookup-column readiness check threw: ${readinessErr.message}`);
                    }

                    try {
                        require('./jobs/scheduler');
                        logger.info('Cron jobs started');
                    } catch (schedulerErr) {
                        logger.warn(`Scheduler failed to start: ${schedulerErr.message}`);
                    }

                    // B-JOB-11 fix (2026-06-04): initialise BullMQ queue workers
                    // (SLA-breach processor + webhook DLQ). Previously initQueues()
                    // had ZERO callers, so the daily SLA-breach scan never ran in
                    // production. Non-fatal + non-test only; initQueues handles
                    // Redis availability via the queue 'ready'/'error' events.
                    if (process.env.NODE_ENV !== 'test') {
                        try {
                            require('./services/queue-service').initQueues();
                            logger.info('Queue workers initialised');
                        } catch (queueErr) {
                            logger.warn(`Queue workers failed to start: ${queueErr.message}`);
                        }
                    }

                    // [F-PDF-COLD-START-TIMEOUT] Boot-time Puppeteer warm-up (2026-08-20).
                    // First certificate-PDF request after a cold backend boot pays the
                    // Puppeteer browser-launch cost inline and can trip puppeteer's own
                    // 30s launch timeout (evidence/phase0/FINDINGS.md:177-178 — walk C15:
                    // attempt 1 = 503, attempts 2-4 succeeded once the singleton browser
                    // was already warm). Kick off a non-blocking warm-up here so the
                    // browser (and the setContent/font render path) is already primed
                    // before the first real download request arrives. warmUp() is
                    // fail-soft internally — a missing/broken Chromium on this deploy
                    // target logs one warn line and never throws — and this call is
                    // deliberately NOT awaited so a slow/failed warm-up can never block
                    // the rest of boot.
                    try {
                        require('./services/pdf/pdf-generator.service').warmUp()
                            .then(() => logger.info('[boot] PDF warm-up complete'))
                            .catch((warmErr) => logger.warn(`[boot] PDF warm-up failed (fail-soft): ${warmErr.message}`));
                    } catch (warmSyncErr) {
                        logger.warn(`[boot] PDF warm-up failed to start: ${warmSyncErr.message}`);
                    }
                } catch (dbErr) {
                    logger.error('PostgreSQL connection failed');
                    logger.error(dbErr);
                }
            });
        }
    });
}

module.exports = app;
