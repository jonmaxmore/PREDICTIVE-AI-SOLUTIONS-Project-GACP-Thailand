/**
 * Server-side read of GET /api/pricing/fees, for server components.
 *
 * Goes straight to the backend (INTERNAL_BACKEND_URL, server.config.ts), the
 * way the API proxy does, because a server component has no browser origin to
 * resolve a relative '/api' path against. The response is cached by Next for
 * PRICING_REVALIDATE_SECONDS (300 s), so these pages show what the fee engine
 * (apps/backend/config/business-rules.js, served by GET /api/pricing/fees)
 * answered at most that long ago. SystemConfig fee.* rows are not applied
 * (loader unwired, operator ruling 2026-10-03).
 *
 * Never throws. Anything other than a readable, complete fee table resolves to
 * null, and the page shows FEES_UNAVAILABLE_TH instead of a number.
 */

import { INTERNAL_BACKEND_URL, SERVER_REQUEST_TIMEOUT_MS } from '@/config/server.config';
import { PRICING_FEES_PATH, parsePublicFees, type PublicFees } from './public-fees';

/** How long a served fee table may be reused by a server-rendered page. */
export const PRICING_REVALIDATE_SECONDS = 300;

export async function fetchPublicFees(): Promise<PublicFees | null> {
    try {
        const res = await fetch(`${INTERNAL_BACKEND_URL}${PRICING_FEES_PATH}`, {
            headers: { Accept: 'application/json' },
            next: { revalidate: PRICING_REVALIDATE_SECONDS },
            signal: typeof AbortSignal.timeout === 'function'
                ? AbortSignal.timeout(SERVER_REQUEST_TIMEOUT_MS)
                : undefined,
        } as RequestInit);
        if (!res.ok) return null;
        const body = (await res.json()) as { success?: boolean; data?: unknown };
        if (!body || body.success !== true) return null;
        return parsePublicFees(body.data);
    } catch {
        return null;
    }
}
