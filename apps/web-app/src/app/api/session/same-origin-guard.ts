import { NextRequest, NextResponse } from 'next/server';

/**
 * Cross-site guard for the session-cookie routes.
 *
 * These routes write auth cookies from a request body, which makes them a
 * session-fixation primitive if any site can call them: an attacker's page
 * posts the ATTACKER's session token, the victim's browser stores it, and the
 * victim then works inside the attacker's account.
 *
 * Three things that look like protection here but are not:
 *   • `sameSite: 'lax'` governs when a cookie is SENT, not whether a
 *     cross-site response may SET one.
 *   • `Content-Type: application/json` does not force a preflight, because
 *     `request.json()` never checks the content type and an HTML form with
 *     `enctype="text/plain"` can emit a body that parses as JSON.
 *   • `httpOnly` stops a page READING the cookie, not this route writing one.
 *
 * So the check has to be on the caller. We use Origin / Sec-Fetch-Site rather
 * than the double-submit `csrf_token` pair used elsewhere in this codebase,
 * because these routes run immediately after login, before a csrf_token cookie
 * necessarily exists.
 *
 * ONE DIRECTION: any signal that says "not us" rejects. A caller that sends
 * NEITHER header is left alone — a browser always sends at least one on a
 * cross-origin POST, so that case is not a CSRF vector, and rejecting it would
 * break server-side callers for no security gain.
 */

/** Sec-Fetch-Site values that mean the request did not come from our own page. */
const FOREIGN_FETCH_SITES = new Set(['cross-site', 'same-site']);

/**
 * Compare on HOST rather than full origin: behind a reverse proxy the scheme
 * Next reconstructs for `request.url` need not match the browser's, but the
 * host the browser used is exactly what it echoes in Origin.
 *
 * Two sources are accepted for "our host" because neither is guaranteed on its
 * own — the `host` header is absent in some runtimes, and `request.url` can be
 * rewritten by the proxy. Matching EITHER is still sound: both describe the
 * authority this very request was addressed to, so an attacker's origin matches
 * neither.
 */
function originHostMatchesRequestHost(request: NextRequest): boolean {
    const origin = request.headers.get('origin');
    if (!origin) {
        return true; // nothing to contradict; Sec-Fetch-Site is checked separately
    }

    let originHost: string;
    try {
        originHost = new URL(origin).host;
    } catch {
        return false; // unparseable Origin
    }

    const ourHosts = new Set<string>();
    const hostHeader = request.headers.get('host');
    if (hostHeader) {
        ourHosts.add(hostHeader);
    }
    try {
        ourHosts.add(new URL(request.url).host);
    } catch {
        // request.url should always parse; ignore if it somehow does not.
    }

    if (ourHosts.size === 0) {
        return false; // an Origin we cannot verify against anything is not trusted
    }
    return ourHosts.has(originHost);
}

/**
 * True when the request demonstrably came from our own pages.
 *
 * @param request incoming request
 */
export function isSameOriginRequest(request: NextRequest): boolean {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && FOREIGN_FETCH_SITES.has(fetchSite)) {
        return false;
    }
    return originHostMatchesRequestHost(request);
}

/**
 * Returns a 403 response when the caller is cross-site, or null to continue.
 *
 * @param request incoming request
 */
export function rejectIfCrossSite(request: NextRequest): NextResponse | null {
    if (isSameOriginRequest(request)) {
        return null;
    }
    return NextResponse.json(
        { success: false, error: 'Cross-site request rejected', code: 'CROSS_SITE_REQUEST' },
        { status: 403 },
    );
}
