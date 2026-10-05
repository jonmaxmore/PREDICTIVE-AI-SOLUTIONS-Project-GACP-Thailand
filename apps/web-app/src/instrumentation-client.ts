/**
 * Runs in the browser before the app hydrates (Next.js 15.3+ convention).
 *
 * Error tracking (Sentry, re-added 2026-10-02 with PII scrubbing): the SDK is
 * imported only when a DSN was baked into this build. NEXT_PUBLIC_SENTRY_DSN is
 * inlined by `next build`, so without one this whole branch is dead code and the
 * SDK chunk is never requested. See src/lib/config/sentry.ts.
 */
import { isSentryConfigured } from '@/lib/config/sentry';

if (isSentryConfigured()) {
    void import('@/lib/sentry/client').then(({ initSentryClient }) => {
        initSentryClient();
    });
}
