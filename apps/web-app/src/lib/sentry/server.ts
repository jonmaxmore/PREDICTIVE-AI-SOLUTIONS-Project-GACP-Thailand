/**
 * Next.js server-side Sentry (Node runtime). Imported lazily by
 * src/instrumentation.ts, and only when a DSN was baked into the build.
 *
 * The DSN is the build-time NEXT_PUBLIC_SENTRY_DSN (one web project for both
 * halves of the app). Environment and release are read at RUNTIME from the
 * container — SENTRY_ENVIRONMENT and GIT_SHA — because one image serves both
 * demo and staging. The edge runtime (middleware) is not instrumented.
 */

import * as Sentry from '@sentry/nextjs';
import { sentryScrubOptions, scrubbingTransport } from '@gacp/error-reporting/scrub';
import { readWebSentryConfig, sentryBuildEnv, sentryServerRuntimeEnv } from '@/lib/config/sentry';

export function initSentryServer(): boolean {
    const build = sentryBuildEnv();
    const runtime = sentryServerRuntimeEnv();
    const config = readWebSentryConfig(
        {
            ...build,
            environment: runtime.environment ?? build.environment,
            release: runtime.release ?? build.release,
        },
        runtime.nodeEnv,
    );
    if (!config.enabled) return false;
    Sentry.init({
        dsn: config.dsn,
        environment: config.environment,
        ...(config.release ? { release: config.release } : {}),
        tracesSampleRate: config.tracesSampleRate,
        ...sentryScrubOptions(),
        includeLocalVariables: false,
        transport: scrubbingTransport(Sentry.makeNodeTransport),
    });
    return true;
}
