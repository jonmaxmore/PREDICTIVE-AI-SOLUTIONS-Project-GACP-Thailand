/**
 * Browser-side Sentry. Loaded only when a DSN was baked into the build
 * (src/instrumentation-client.ts imports this module lazily behind that check),
 * so a build without one never downloads the SDK.
 *
 * Every event, transaction and breadcrumb passes the shared PII scrubber
 * (packages/error-reporting/src/scrub.js) via `sentryScrubOptions()`.
 * No Session Replay, no user feedback widget, low trace sampling.
 */

import * as Sentry from '@sentry/nextjs';
import { sentryScrubOptions, scrubbingTransport } from '@gacp/error-reporting/scrub';
import { readWebSentryConfig, sentryBuildEnv, type WebSentryEnv } from '@/lib/config/sentry';

type BrowserOptions = Parameters<typeof Sentry.init>[0];

/** Integrations that record or collect user input: never installed. */
const FORBIDDEN_INTEGRATIONS = /replay|feedback/i;

export interface InitSentryClientOptions {
    env?: WebSentryEnv;
    /** Fallback environment; defaults to the page's hostname. */
    hostname?: string;
    /** Tests only: records what would be sent (still wrapped by scrubbingTransport). */
    transport?: BrowserOptions['transport'];
}

export function buildClientOptions(
    config: Extract<ReturnType<typeof readWebSentryConfig>, { enabled: true }>,
    transport?: BrowserOptions['transport'],
): BrowserOptions {
    return {
        dsn: config.dsn,
        environment: config.environment,
        ...(config.release ? { release: config.release } : {}),
        tracesSampleRate: config.tracesSampleRate,
        ...sentryScrubOptions(),
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        integrations: (defaults) => defaults.filter((integration) => !FORBIDDEN_INTEGRATIONS.test(integration.name)),
        // Every envelope is scrubbed once more on its way out (sessions and
        // streamed spans never pass beforeSend).
        transport: scrubbingTransport(transport ?? Sentry.makeFetchTransport),
    };
}

/**
 * Initialise the browser SDK. Returns false (and does nothing) without a DSN.
 */
export function initSentryClient(options: InitSentryClientOptions = {}): boolean {
    const hostname = options.hostname ?? (typeof window !== 'undefined' ? window.location.hostname : undefined);
    const config = readWebSentryConfig(options.env ?? sentryBuildEnv(), hostname);
    if (!config.enabled) return false;
    Sentry.init(buildClientOptions(config, options.transport));
    return true;
}
