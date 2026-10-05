import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { INTERNAL_BACKEND_URL } from '@/config/server.config';

const BACKEND_URL = INTERNAL_BACKEND_URL;
const API_PROXY_DEBUG = process.env.API_PROXY_DEBUG === 'true';

/**
 * Generic API Proxy for all /api/* endpoints (excluding /api/v2, /api/auth-*, /api/health, /api/proxy)
 * Forwards requests to backend with auth_token from httpOnly cookie
 */
async function proxyRequest(request: NextRequest, path: string, method: string) {
    try {
        const cookieStore = await cookies();
        const authToken = cookieStore.get('auth_token')?.value;
        const providerToken = cookieStore.get('provider_token')?.value;
        const incomingAuthorization = request.headers.get('authorization');

        // Start with empty headers
        const headers: Record<string, string> = {};

        // 1. Copy Content-Type (Essential for multipart/form-data boundaries)
        const contentType = request.headers.get('content-type');
        if (contentType) {
            headers['Content-Type'] = contentType;
        }

        // 2. Add Authorization header
        // Priority:
        //   1) Explicit Authorization header from caller (mobile/web localStorage token)
        //   2) Health auth cookie
        //   3) Provider auth cookie
        if (incomingAuthorization) {
            headers['Authorization'] = incomingAuthorization;
        } else if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        } else if (providerToken) {
            headers['Authorization'] = `Bearer ${providerToken}`;
        }

        // 3. Forward test headers if needed
        const testUserId = request.headers.get('X-User-ID');
        if (testUserId && !authToken) {
            headers['X-User-ID'] = testUserId;
        }

        // 3.5. Forward the active-entity (workspace) header — Wave C
        // workspace switcher. apps/web-app/src/lib/api/api-client.ts reads
        // localStorage `gacp.activeEntityId` and sends this on every
        // authenticated request so apps/backend/middleware/active-entity-
        // middleware.js can scope entity-owned reads/writes to the
        // workspace the user picked. This proxy used to build its outbound
        // headers from an empty map and never copied this one, so every
        // request silently ran as the user's default (personal) entity no
        // matter which workspace was selected client-side (design-cleanup-
        // 2026-08-21 audit, B1).
        const activeEntityId = request.headers.get('x-active-entity-id');
        if (activeEntityId) {
            headers['x-active-entity-id'] = activeEntityId;
        }

        const queryString = request.nextUrl.searchParams.toString();
        const backendUrl = `${BACKEND_URL}/api/${path}${queryString ? `?${queryString}` : ''}`;

        if (API_PROXY_DEBUG) {
            console.warn(`[API Proxy] ${method} ${backendUrl}`);
        }

        // 4. Forward Body as Stream (don't parse JSON)
        // For GET/HEAD, body must be undefined/null
        const body = (method === 'GET' || method === 'HEAD') ? undefined : request.body;

        const response = await fetch(backendUrl, {
            method,
            headers,
            body,
            // @ts-expect-error - Required for Node.js fetch with ReadableStream body
            duplex: 'half'
        });

        // 5. Return Response
        // Use blob() to handle both JSON and Binary responses correctly
        const responseBody = await response.blob();

        return new NextResponse(responseBody, {
            status: response.status,
            statusText: response.statusText,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'application/json'
            }
        });

    } catch (error: unknown) {
        // Transport failure (backend down / ECONNREFUSED / DNS / aborted) — NOT an
        // upstream HTTP error (those pass through with their real status above).
        // Return a gateway-class status with a generic body; never leak the raw
        // upstream error.message to the client. Matches the auth/health, auth/provider
        // and change-password sibling proxies.
        console.error('[API Proxy] Error:', error);
        return NextResponse.json(
            { success: false, error: 'Backend service unavailable', code: 'BACKEND_UNREACHABLE' },
            { status: 503 }
        );
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyRequest(request, path.join('/'), 'GET');
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyRequest(request, path.join('/'), 'POST');
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyRequest(request, path.join('/'), 'PUT');
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyRequest(request, path.join('/'), 'DELETE');
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyRequest(request, path.join('/'), 'PATCH');
}
