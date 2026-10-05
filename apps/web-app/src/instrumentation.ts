/**
 * Next.js server instrumentation hook.
 *
 * Error tracking (Sentry, re-added 2026-10-02 with PII scrubbing): initialised
 * in the Node runtime only, and only when a DSN was baked into this build — the
 * SDK module is imported lazily behind that check. The edge runtime (middleware)
 * is not instrumented. See src/lib/config/sentry.ts and
 * docs/operations/sentry-error-tracking.md.
 */
import { isSentryConfigured } from '@/lib/config/sentry';

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === 'nodejs' && isSentryConfigured()) {
        const { initSentryServer } = await import('@/lib/sentry/server');
        initSentryServer();
    }
}

/** Server-side request errors (server components, route handlers, actions). */
export async function onRequestError(...args: unknown[]): Promise<void> {
    if (process.env.NEXT_RUNTIME !== 'nodejs' || !isSentryConfigured()) return;
    const Sentry = await import('@sentry/nextjs');
    (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
