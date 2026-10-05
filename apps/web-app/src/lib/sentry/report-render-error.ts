'use client';

/**
 * Report an error caught by a Next.js error boundary (global-error.tsx and
 * PortalErrorPage). React does not rethrow an error a boundary caught, so the
 * SDK's global handlers never see it; this hands it over explicitly.
 *
 * A no-op without a baked DSN: the SDK is not imported.
 */
import { useEffect } from 'react';
import { isSentryConfigured } from '@/lib/config/sentry';

export function useReportRenderError(error: Error | undefined): void {
    useEffect(() => {
        if (!error || !isSentryConfigured()) return;
        void import('@sentry/nextjs').then((Sentry) => {
            Sentry.captureException(error);
        });
    }, [error]);
}
