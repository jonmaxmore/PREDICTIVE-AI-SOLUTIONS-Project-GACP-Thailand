/**
 * trace-fetch — shared fetch-outcome classification for ALL public /trace/**
 * client views (product, plant, batch, lot, plot-cycle).
 *
 * These are public trust surfaces (QR scans printed on product packaging), so
 * the one thing they must never do is claim a definitive "ไม่พบข้อมูล / not
 * found" verdict when NO verdict was reached. This module tells the two cases
 * apart, mirroring the /verify/[cert-number] page:
 *
 *   'ok'          — backend answered 2xx + success:true. Render the trace.
 *   'not-found'   — backend ANSWERED with a definitive verdict:
 *                     • 2xx + success:false            (envelope flag)
 *                     • 404 + envelope                 (record not found)
 *                     • 410 + envelope                 (cert revoked/expired
 *                       gate — the body.message carries the honest reason,
 *                       e.g. "ใบรับรองหมดอายุแล้ว")
 *                   Only these statuses are verdicts on the trace routes
 *                   (apps/backend/routes/api/trace/*).
 *   'unavailable' — NO verdict was reached: network error, non-JSON body
 *                   (gateway HTML error page), any 5xx (including the Next.js
 *                   proxy's 503 {code:'BACKEND_UNREACHABLE'} when the backend
 *                   is down — src/app/api/[...path]/route.ts), or any other
 *                   non-verdict status (401/403/429/...). The page must render
 *                   the neutral amber "ไม่สามารถตรวจสอบได้ในขณะนี้" state with
 *                   a retry, NEVER the red not-found card.
 */

export interface TraceEnvelope {
    success?: boolean;
    message?: string;
}

export type TraceFetchOutcome<T extends TraceEnvelope> =
    | { kind: 'ok'; payload: T }
    | { kind: 'not-found'; message: string | null }
    | { kind: 'unavailable' };

/**
 * Pure classifier — pass the HTTP status and the parsed JSON body
 * (or null when the body could not be parsed as JSON).
 */
export function classifyTraceResponse<T extends TraceEnvelope>(
    status: number,
    payload: T | null,
): TraceFetchOutcome<T> {
    // Unparseable body = we never saw a backend envelope → no verdict.
    if (payload === null || typeof payload !== 'object') {
        return { kind: 'unavailable' };
    }

    if (status >= 200 && status < 300) {
        if (payload.success === true) {
            return { kind: 'ok', payload };
        }
        // Backend answered 2xx with a definitive success:false flag.
        return { kind: 'not-found', message: payload.message ?? null };
    }

    // The ONLY non-2xx statuses the trace backend uses for definitive
    // verdicts: 404 unknown, 410 revoked/expired, 400 malformed/blank QR
    // (e.g. a whitespace-only code — resolve-generic.js trims to empty).
    if (status === 400 || status === 404 || status === 410) {
        return { kind: 'not-found', message: payload.message ?? null };
    }

    // 5xx (backend failure / proxy BACKEND_UNREACHABLE) and any other
    // non-verdict status: no verdict was reached.
    return { kind: 'unavailable' };
}

/**
 * Fetch wrapper the trace client views call. Never throws.
 */
export async function fetchTraceEnvelope<T extends TraceEnvelope>(
    url: string,
): Promise<TraceFetchOutcome<T>> {
    let status: number;
    let payload: T | null;
    try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        status = response.status;
        try {
            payload = await response.json() as T;
        } catch {
            payload = null;
        }
    } catch {
        // Network/transport failure — the request never completed.
        return { kind: 'unavailable' };
    }
    return classifyTraceResponse(status, payload);
}
