import { NextRequest, NextResponse } from 'next/server';
import { getBackendCandidates, SERVER_REQUEST_TIMEOUT_MS } from '@/config/server.config';
import {
    buildForwardHeaders,
    readForwardBody,
    parseBackendBody,
    buildProxyResponse,
} from '../../_lib/proxy-forward';

const REQUEST_TIMEOUT_MS = SERVER_REQUEST_TIMEOUT_MS;
const AUTH_COOKIE_NAME = 'auth_token';

async function forwardToBackend(
    method: 'GET' | 'POST',
    endpoint: string,
    request: NextRequest,
    body?: ArrayBuffer,
    queryString = ''
): Promise<Response> {
    const headers = buildForwardHeaders(request, { cookieName: AUTH_COOKIE_NAME });

    const requestOrigin = request.nextUrl.origin;
    let fetchError: unknown = null;
    for (const backendBaseUrl of getBackendCandidates()) {
        try {
            const candidateOrigin = new URL(backendBaseUrl).origin;
            // Skip self-proxy loops if backend is misconfigured to point to frontend origin.
            if (candidateOrigin === requestOrigin) {
                continue;
            }
        } catch {
            // Ignore invalid URL and let fetch throw below.
        }

        const normalizedQuery = queryString && queryString !== '?' ? queryString : '';
        const backendUrl = `${backendBaseUrl}/api/auth/health/${endpoint}${normalizedQuery}`;
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
    console.error('[Auth Health Proxy] Error:', error);
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

        const body = await readForwardBody(request, 'POST');

        const response = await forwardToBackend('POST', endpoint, request, body, request.nextUrl.search);
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
        const response = await forwardToBackend('GET', endpoint, request, undefined, request.nextUrl.search);
        const parsed = await parseBackendBody(response);
        return buildProxyResponse(response, parsed.data, parsed.contentType);
    } catch (error: unknown) {
        return serverErrorResponse(error);
    }
}
