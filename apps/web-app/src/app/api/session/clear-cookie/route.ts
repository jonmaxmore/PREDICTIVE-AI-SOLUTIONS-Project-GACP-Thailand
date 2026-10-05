import { NextRequest, NextResponse } from 'next/server';
import {
    getExpiredSessionCookieOptions,
    getSessionCookieNames,
} from '../session-cookie';
import { rejectIfCrossSite } from '../same-origin-guard';

/**
 * POST /api/session/clear-cookie
 *
 * Clears all known session cookies on the frontend origin so middleware and
 * client state do not drift after logout or timeout flows.
 */
export async function POST(request: NextRequest) {
    // Same guard as set-cookie. Forcing a logout cross-site is a nuisance
    // rather than a takeover, but the two routes should not differ on whether
    // a stranger may write this origin's session cookies.
    const crossSite = rejectIfCrossSite(request);
    if (crossSite) {
        return crossSite;
    }

    const response = NextResponse.json({ success: true });

    getSessionCookieNames().forEach((cookieName) => {
        response.cookies.set(cookieName, '', getExpiredSessionCookieOptions(cookieName));
    });

    return response;
}
