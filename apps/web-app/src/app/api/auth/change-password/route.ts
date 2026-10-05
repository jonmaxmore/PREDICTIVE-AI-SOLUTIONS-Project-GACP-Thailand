import { NextRequest, NextResponse } from 'next/server';
import { getBackendCandidates, SERVER_REQUEST_TIMEOUT_MS } from '@/config/server.config';

const REQUEST_TIMEOUT_MS = SERVER_REQUEST_TIMEOUT_MS;

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }

  const setCookie = headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

function normalizeChangePasswordPayload(input: unknown): { oldPassword: string; newPassword: string } | null {
  const payload = input && typeof input === 'object'
    ? (input as Record<string, unknown>)
    : {};

  // Keep compatibility with older client shape:
  // { currentPassword, newPassword } -> { oldPassword, newPassword }
  const oldPassword = String(payload.oldPassword || payload.currentPassword || '').trim();
  const newPassword = String(payload.newPassword || '').trim();

  if (!oldPassword || !newPassword) {
    return null;
  }

  return { oldPassword, newPassword };
}

async function forwardToBackend(
  request: NextRequest,
  payload: { oldPassword: string; newPassword: string },
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const authorization = request.headers.get('authorization');
  if (authorization) {
    headers['Authorization'] = authorization;
  }

  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  let lastError: unknown = null;
  for (const backendBaseUrl of getBackendCandidates()) {
    const backendUrl = `${backendBaseUrl}/api/auth/health/change-password`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(backendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: unknown) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to connect to auth backend');
}

async function parseBackendBody(response: Response): Promise<{ data: unknown; contentType: string }> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    return { data, contentType: 'application/json' };
  }

  const text = await response.text().catch(() => '');
  return { data: text, contentType };
}

function buildProxyResponse(response: Response, data: unknown, contentType: string): NextResponse {
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

export async function POST(request: NextRequest) {
  try {
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const payload = normalizeChangePasswordPayload(rawBody);
    if (!payload) {
      return NextResponse.json({
        success: false,
        error: 'Current password and new password are required',
      }, { status: 400 });
    }

    const response = await forwardToBackend(request, payload);
    const parsed = await parseBackendBody(response);
    return buildProxyResponse(response, parsed.data, parsed.contentType);
  } catch (error: unknown) {
    console.error('[Auth Change Password Proxy] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Auth service unavailable', code: 'BACKEND_UNREACHABLE' },
      { status: 503 },
    );
  }
}
