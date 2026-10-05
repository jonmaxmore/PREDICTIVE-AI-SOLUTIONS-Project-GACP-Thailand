/**
 * sentry.ts — the web app's Sentry settings, read in ONE place.
 *
 * Sentry was re-added 2026-10-02 by operator decision, with personal-data
 * scrubbing (packages/error-reporting/src/scrub.js, shared with the backend).
 *
 * OFF BY DEFAULT. Without NEXT_PUBLIC_SENTRY_DSN nothing is initialised, the
 * SDK chunk is never fetched, and no request goes to Sentry
 * (src/lib/sentry/__tests__/sentry-client-envelope.test.ts, "off by default").
 *
 * Build-time, public (inlined into the browser bundle by `next build`; a
 * Dockerfile ARG in the builder stage — setting them on a running container
 * changes nothing):
 *   NEXT_PUBLIC_SENTRY_DSN                  the web project's DSN (ingest-only, public by design)
 *   NEXT_PUBLIC_SENTRY_ENVIRONMENT          optional; unset → the page's hostname, because one
 *                                           image serves both demo and staging
 *   NEXT_PUBLIC_SENTRY_RELEASE              set by the Dockerfile from the GIT_SHA build arg
 *   NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE   optional; 0..1, default 0.05
 * Runtime, server only (read by the Next server process, never shipped):
 *   SENTRY_ENVIRONMENT                      staging | demo — set per container in compose
 *   GIT_SHA                                 baked into the runner stage; the server's release
 *
 * This file imports neither the SDK nor the scrubber, so the edge middleware
 * can use `sentryIngestOrigin` for its CSP without pulling either in.
 */

export const DEFAULT_TRACES_SAMPLE_RATE = 0.05;

export interface WebSentryEnv {
    dsn?: string | undefined;
    environment?: string | undefined;
    release?: string | undefined;
    tracesSampleRate?: string | undefined;
}

export type WebSentryConfig =
    | { enabled: false }
    | {
          enabled: true;
          dsn: string;
          environment: string;
          release: string | undefined;
          tracesSampleRate: number;
      };

function trimmed(value: string | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t === '' ? undefined : t;
}

function parseSampleRate(raw: string | undefined): number {
    const text = trimmed(raw);
    if (text === undefined) return DEFAULT_TRACES_SAMPLE_RATE;
    const rate = Number(text);
    return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_TRACES_SAMPLE_RATE;
}

/**
 * The build-time values. Each NEXT_PUBLIC_* is written out literally so
 * `next build` can inline it.
 */
export function sentryBuildEnv(): WebSentryEnv {
    return {
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    };
}

/**
 * The Next server's runtime values (never shipped to the browser): one image
 * serves demo and staging, so the server reads its environment and release from
 * the container at runtime. Blank reads as undefined.
 */
export function sentryServerRuntimeEnv(): { environment?: string; release?: string; nodeEnv?: string } {
    const environment = trimmed(process.env.SENTRY_ENVIRONMENT);
    const release = trimmed(process.env.GIT_SHA);
    const nodeEnv = trimmed(process.env.NODE_ENV);
    return {
        ...(environment ? { environment } : {}),
        ...(release ? { release } : {}),
        ...(nodeEnv ? { nodeEnv } : {}),
    };
}

/** True when a DSN was baked into this build. */
export function isSentryConfigured(env: WebSentryEnv = sentryBuildEnv()): boolean {
    return trimmed(env.dsn) !== undefined;
}

/**
 * @param fallbackEnvironment used when no environment is configured: the
 *   page's hostname in the browser, SENTRY_ENVIRONMENT/NODE_ENV on the server.
 */
export function readWebSentryConfig(env: WebSentryEnv, fallbackEnvironment?: string): WebSentryConfig {
    const dsn = trimmed(env.dsn);
    if (!dsn) return { enabled: false };
    return {
        enabled: true,
        dsn,
        environment: trimmed(env.environment) ?? trimmed(fallbackEnvironment) ?? 'development',
        release: trimmed(env.release),
        tracesSampleRate: parseSampleRate(env.tracesSampleRate),
    };
}

/**
 * The scheme + host the browser posts events to, for the CSP `connect-src`.
 * The DSN's public key (its userinfo part) is NOT part of an origin, so it never
 * appears in the header. Unset or unparseable → null → nothing is added.
 */
export function sentryIngestOrigin(dsn: string | undefined = process.env.NEXT_PUBLIC_SENTRY_DSN): string | null {
    const value = trimmed(dsn);
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.origin;
    } catch {
        return null;
    }
}
