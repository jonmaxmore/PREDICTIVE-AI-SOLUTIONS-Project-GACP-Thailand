import { NextRequest, NextResponse } from 'next/server';

/**
 * Shared low-level pieces for the auth/health and auth/provider proxy
 * routes (`src/app/api/auth/health/[...path]/route.ts` and
 * `src/app/api/auth/provider/[...path]/route.ts`).
 *
 * Both routes proxy Next.js -> Express backend and, before this file
 * existed, carried byte-for-byte duplicate header/body/response handling.
 * That duplication is why a multipart upload (`me/avatar`, `register`'s
 * idCardImage) silently lost its body and boundary on both routes at once:
 * one bug, pasted twice. This module is the ONE implementation now.
 */

export function getSetCookieHeaders(headers: Headers): string[] {
    const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
    if (typeof withGetSetCookie.getSetCookie === 'function') {
        return withGetSetCookie.getSetCookie();
    }

    const setCookie = headers.get('set-cookie');
    return setCookie ? [setCookie] : [];
}

export interface ForwardHeadersOptions {
    /**
     * Name of the auth cookie to map to `Authorization: Bearer <token>`
     * when the caller did not already send an Authorization header
     * ('auth_token' for health, 'provider_token' for provider) — mirrors
     * the mapping in src/app/api/[...path]/route.ts.
     */
    cookieName: string;
}

/**
 * Build the header set sent to the backend for a proxied request.
 *
 * - Content-Type is copied from the incoming request VERBATIM — this is
 *   what carries a multipart boundary (`multipart/form-data; boundary=...`).
 *   Only defaults to application/json when the caller sent none at all.
 * - Authorization forwards the incoming header when present (Bearer-token
 *   clients: the Flutter app, scripts, tests) or, when absent, maps the
 *   named auth cookie to a Bearer header.
 * - Cookie is still forwarded RAW/unchanged alongside it — the backend's
 *   own authenticateHealth/authenticateProvider middleware reads
 *   req.cookies itself and checks it before Authorization
 *   (apps/backend/middleware/auth-middleware.js), so dropping this would
 *   break existing cookie-based sessions, including login.
 */
export function buildForwardHeaders(
    request: NextRequest,
    options: ForwardHeadersOptions
): Record<string, string> {
    const headers: Record<string, string> = {};

    const contentType = request.headers.get('content-type');
    headers['Content-Type'] = contentType || 'application/json';

    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
    }

    const incomingAuthorization = request.headers.get('authorization');
    if (incomingAuthorization) {
        headers['Authorization'] = incomingAuthorization;
    } else {
        const cookieToken = request.cookies.get(options.cookieName)?.value;
        if (cookieToken) {
            headers['Authorization'] = `Bearer ${cookieToken}`;
        }
    }

    // Double-submit CSRF header (apps/backend/middleware/csrf-middleware.js):
    // required on every state-changing request that carries the auth_token /
    // provider_token cookie. Bearer-only clients never set this cookie, so
    // the backend skips the check for them; cookie-session clients (the web
    // UI, and this curl-with-cookie-jar proof) need it forwarded or every
    // cookie-authenticated POST through this proxy — not just uploads —
    // 403s with CSRF_MISMATCH. src/app/api/auth/change-password/route.ts
    // already forwards this same header.
    const csrfToken = request.headers.get('x-csrf-token');
    if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
    }

    // Active-entity (workspace) header — Wave C workspace switcher (design-
    // cleanup-2026-08-21 audit, B1). apps/web-app/src/lib/api/api-client.ts
    // sends this so apps/backend/middleware/active-entity-middleware.js can
    // scope entity-owned reads/writes to the workspace the user picked. This
    // shared header builder is used by BOTH the auth/health and auth/provider
    // proxies (src/app/api/auth/health/[...path]/route.ts and
    // src/app/api/auth/provider/[...path]/route.ts) — same mirror-header gap
    // as the generic /api/[...path] proxy (route.ts).
    const activeEntityId = request.headers.get('x-active-entity-id');
    if (activeEntityId) {
        headers['x-active-entity-id'] = activeEntityId;
    }

    const xForwardedFor = request.headers.get('x-forwarded-for');
    if (xForwardedFor) {
        headers['X-Forwarded-For'] = xForwardedFor;
    }

    const xRealIp = request.headers.get('x-real-ip');
    if (xRealIp) {
        headers['X-Real-IP'] = xRealIp;
    }

    const forwarded = request.headers.get('forwarded');
    if (forwarded) {
        headers['Forwarded'] = forwarded;
    }

    const userAgent = request.headers.get('user-agent');
    if (userAgent) {
        headers['User-Agent'] = userAgent;
    }

    const requestId = request.headers.get('x-request-id');
    if (requestId) {
        headers['X-Request-ID'] = requestId;
    }

    return headers;
}

/**
 * Read the raw request body ONCE, as bytes — never request.json() — so a
 * multipart body's exact bytes (and its boundary-delimited parts) survive
 * the proxy unchanged. Returned as an ArrayBuffer (not streamed) because
 * forwardToBackend retries across multiple backend URL candidates; a
 * ReadableStream can only be consumed once, an ArrayBuffer can be reused
 * for every retry attempt.
 */
export async function readForwardBody(
    request: NextRequest,
    method: string
): Promise<ArrayBuffer | undefined> {
    if (method === 'GET' || method === 'HEAD') {
        return undefined;
    }
    try {
        const buffer = await request.arrayBuffer();
        return buffer.byteLength > 0 ? buffer : undefined;
    } catch {
        return undefined;
    }
}

export async function parseBackendBody(
    response: Response
): Promise<{ data: unknown; contentType: string }> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => ({} as Record<string, unknown>));
        return { data, contentType: 'application/json' };
    }

    const text = await response.text().catch(() => '');
    return { data: text, contentType };
}

export function buildProxyResponse(
    response: Response,
    data: unknown,
    contentType: string
): NextResponse {
    const nextResponse = contentType.includes('application/json')
        ? NextResponse.json(data, { status: response.status })
        : new NextResponse(String(data || ''), {
            status: response.status,
            headers: { 'Content-Type': contentType || 'text/plain; charset=utf-8' },
        });
    const setCookies = getSetCookieHeaders(response.headers);
    setCookies.forEach((cookie) => nextResponse.headers.append('Set-Cookie', cookie));
    return nextResponse;
}
