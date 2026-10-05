import { NextRequest, NextResponse } from 'next/server';
import { getBackendCandidates, SERVER_REQUEST_TIMEOUT_MS } from '@/config/server.config';
import {
    getSessionCookieOptions,
    isValidSessionCookieName,
} from '../../../session/session-cookie';
import {
    buildForwardHeaders,
    readForwardBody,
    parseBackendBody,
    buildProxyResponse,
} from '../../_lib/proxy-forward';

const REQUEST_TIMEOUT_MS = SERVER_REQUEST_TIMEOUT_MS;
const AUTH_COOKIE_NAME = 'provider_token';

async function forwardToBackend(
    method: 'GET' | 'POST',
    endpoint: string,
    request: NextRequest,
    body?: ArrayBuffer
): Promise<Response> {
    const headers = buildForwardHeaders(request, { cookieName: AUTH_COOKIE_NAME });

    const requestOrigin = request.nextUrl.origin;
    let fetchError: unknown = null;
    for (const backendBaseUrl of getBackendCandidates()) {
        try {
            const candidateOrigin = new URL(backendBaseUrl).origin;
            if (candidateOrigin === requestOrigin) {
                continue;
            }
        } catch {
            // Ignore invalid URL
        }

        const backendUrl = `${backendBaseUrl}/api/auth/provider/${endpoint}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const response = await fetch(backendUrl, {
                    method,
                    headers,
                    ...(body !== undefined ? { body } : {}),
                    signal: controller.signal,
                });
                return response;
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (error: unknown) {
            fetchError = error;
        }
    }

    throw fetchError || new Error('Unable to connect to auth backend');
}

function serverErrorResponse(error: unknown): NextResponse {
    console.error('[Auth Provider Proxy] Error:', error);
    return NextResponse.json(
        { success: false, error: 'Auth service unavailable', code: 'BACKEND_UNREACHABLE' },
        { status: 503 }
    );
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        const endpoint = path.join('/');

        // Handle set-cookie locally — sets provider_token cookie server-side
        // so the Next.js middleware can read it on subsequent requests.
        if (endpoint === 'set-cookie') {
            try {
                const body = await request.json();
                const { token, cookieName } = body;
                if (!token || !isValidSessionCookieName(cookieName) || cookieName !== 'provider_token') {
                    return NextResponse.json({ success: false, error: 'Invalid' }, { status: 400 });
                }
                const res = NextResponse.json({ success: true });
                res.cookies.set('provider_token', token, getSessionCookieOptions('provider_token'));
                res.headers.set('X-GACP-Deprecated-Route', '/api/session/set-cookie');
                return res;
            } catch {
                return NextResponse.json({ success: false, error: 'Bad request' }, { status: 400 });
            }
        }

        const body = await readForwardBody(request, 'POST');

        const response = await forwardToBackend('POST', endpoint, request, body);
        const parsed = await parseBackendBody(response);
        return buildProxyResponse(response, parsed.data, parsed.contentType);
    } catch (error: unknown) {
        return serverErrorResponse(error);
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        const endpoint = path.join('/');
        const response = await forwardToBackend('GET', endpoint, request);
        const parsed = await parseBackendBody(response);
        return buildProxyResponse(response, parsed.data, parsed.contentType);
    } catch (error: unknown) {
        return serverErrorResponse(error);
    }
}
