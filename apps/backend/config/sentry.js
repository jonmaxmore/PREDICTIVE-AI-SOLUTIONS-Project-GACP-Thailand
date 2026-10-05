'use strict';

/**
 * Error tracking with Sentry — re-added 2026-10-02 by operator decision, with
 * personal-data scrubbing as the first-class requirement (PDPA).
 *
 * OFF BY DEFAULT. Nothing happens unless SENTRY_DSN is set: the SDK is not even
 * loaded (the `require('@sentry/node')` below sits behind the DSN check), so a
 * process without a DSN makes no network call to Sentry and carries none of its
 * process hooks. Proven at the wire by
 * __tests__/unit/sentry-express-envelope.test.js ("off by default").
 *
 * WHAT IS SENT. Every event, transaction and breadcrumb passes the shared
 * scrubber in packages/error-reporting/src/scrub.js — the same module the web
 * app uses — before it leaves the process. That module is the one place that
 * says what is removed (request bodies, cookies, Authorization, query strings on
 * auth/payment routes, national/tax IDs, emails, Thai phone numbers, JWTs,
 * bearer tokens, Stripe ids and secrets, database passwords, everything about
 * the user but a UUID). If it cannot scrub an event it drops it.
 *
 * Environment (read here, in config/, and nowhere else):
 *   SENTRY_DSN                 the backend project's DSN; unset/blank = off
 *   SENTRY_ENVIRONMENT         staging | demo | ...; falls back to GACP_DEPLOY_SLOT, then NODE_ENV
 *   SENTRY_TRACES_SAMPLE_RATE  0..1, default 0.05; anything unusable = the default
 *   GIT_SHA                    baked into the image by the Dockerfile; becomes the release
 *
 * Runbook: docs/operations/sentry-error-tracking.md
 */

const { sentryScrubOptions, scrubbingTransport } = require('@gacp/error-reporting/scrub');

const DEFAULT_TRACES_SAMPLE_RATE = 0.05;

function trimmed(value) {
    if (typeof value !== 'string') {return undefined;}
    const t = value.trim();
    return t === '' ? undefined : t;
}

function parseSampleRate(raw) {
    const text = trimmed(raw);
    if (text === undefined) {return DEFAULT_TRACES_SAMPLE_RATE;}
    const rate = Number(text);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {return DEFAULT_TRACES_SAMPLE_RATE;}
    return rate;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ enabled: false } | { enabled: true, dsn: string, environment: string,
 *            release: string | undefined, tracesSampleRate: number }}
 */
function readSentryConfig(env = process.env) {
    const dsn = trimmed(env.SENTRY_DSN);
    if (!dsn) {return { enabled: false };}
    return {
        enabled: true,
        dsn,
        environment: trimmed(env.SENTRY_ENVIRONMENT)
            || trimmed(env.GACP_DEPLOY_SLOT)
            || trimmed(env.NODE_ENV)
            || 'development',
        release: trimmed(env.GIT_SHA),
        tracesSampleRate: parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    };
}

/**
 * The options handed to Sentry.init. Separate from initSentry so the contract
 * is testable without starting an SDK.
 */
function buildSentryOptions(config, Sentry, { transport } = {}) {
    return {
        dsn: config.dsn,
        environment: config.environment,
        release: config.release,
        tracesSampleRate: config.tracesSampleRate,
        // dataCollection (nothing personal collected), sendDefaultPii: false,
        // traceLifecycle 'static', beforeSend / beforeSendTransaction / beforeBreadcrumb
        ...sentryScrubOptions(),
        // Local variables are where request bodies and decrypted records sit.
        includeLocalVariables: false,
        // No profiling: no profiling integration is installed and no profile
        // sample rate is set.
        integrations: [
            // Report an unhandled rejection, then exit non-zero — Node's own
            // default. The SDK's default ('warn') would keep a process serving
            // after a rejection that Node would have stopped.
            Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
        ],
        // Every envelope is scrubbed once more on its way out, whatever produced
        // it (sessions and streamed spans never pass beforeSend).
        transport: scrubbingTransport(transport || Sentry.makeNodeTransport),
    };
}

/**
 * Initialise Sentry when SENTRY_DSN is set. Returns the SDK module, or null
 * when error tracking is off. Call it before `require('express')`.
 *
 * @param {{ env?: Record<string, string | undefined>, transport?: Function }} [options]
 *   `transport` replaces the SDK's network transport — the smoke script uses it
 *   to record what is sent. It is wrapped by scrubbingTransport like the default.
 */
function initSentry({ env = process.env, transport } = {}) {
    const config = readSentryConfig(env);
    if (!config.enabled) {return null;}
     
    const Sentry = require('@sentry/node');
    Sentry.init(buildSentryOptions(config, Sentry, { transport }));
    return Sentry;
}

/**
 * Mount Sentry's Express error handler. Call after every route and before the
 * app's own error handler. A no-op when Sentry is off. Only 5xx (and errors
 * with no status) are reported — the SDK's default.
 */
function attachSentryErrorHandler(app, Sentry) {
    if (!Sentry) {return;}
    Sentry.setupExpressErrorHandler(app);
}

module.exports = {
    DEFAULT_TRACES_SAMPLE_RATE,
    readSentryConfig,
    buildSentryOptions,
    initSentry,
    attachSentryErrorHandler,
};
