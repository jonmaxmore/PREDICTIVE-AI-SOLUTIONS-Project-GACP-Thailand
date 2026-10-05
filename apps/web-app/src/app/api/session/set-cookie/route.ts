import { NextRequest, NextResponse } from 'next/server';
import {
    getSessionCookieOptions,
    isValidSessionCookieName,
} from '../session-cookie';
import { rejectIfCrossSite } from '../same-origin-guard';

/**
 * POST /api/session/set-cookie
 * 
 * Sets an auth cookie server-side so that the Next.js middleware can read it
 * on subsequent requests. This route is intentionally NOT under /api/auth/*
 * because Nginx routes /api/auth/(health|provider)/* directly to backend:8000,
 * bypassing the Next.js frontend entirely.
 * 
 * Body: { token: string, cookieName: 'provider_token' | 'auth_token' }
 */
export async function POST(request: NextRequest) {
    try {
        // This route writes an auth cookie from the request body, so an
        // unguarded cross-site caller can plant THEIR session in the victim's
        // browser (session fixation). Checked before the body is even read.
        const crossSite = rejectIfCrossSite(request);
        if (crossSite) {
            return crossSite;
        }

        const body = await request.json();
        const { token, cookieName } = body;

        if (!token || !cookieName) {
            return NextResponse.json(
                { success: false, error: 'Missing token or cookieName' },
                { status: 400 }
            );
        }

        if (!isValidSessionCookieName(cookieName) || cookieName === 'refresh_token' || cookieName === 'csrf_token') {
            return NextResponse.json(
                { success: false, error: 'Invalid cookie name' },
                { status: 400 }
            );
        }

        const response = NextResponse.json({ success: true });
        response.cookies.set(cookieName, token, getSessionCookieOptions(cookieName));

        return response;
    } catch {
        return NextResponse.json(
            { success: false, error: 'Invalid request' },
            { status: 400 }
        );
    }
}
