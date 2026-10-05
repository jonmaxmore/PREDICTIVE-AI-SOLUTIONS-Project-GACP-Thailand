/**
 * @jest-environment node
 *
 * Root-cause regression: this route is what Next.js selects (over the
 * generic /api/[...path] proxy) for every /api/auth/health/* request. It
 * used to hardcode 'Content-Type: application/json' and call
 * request.json() on every POST body, which silently destroyed multipart
 * uploads (me/avatar, register's idCardImage) and never forwarded the
 * incoming Authorization header, so Bearer-token clients (the Flutter
 * app, scripts, tests) got 401 NO_TOKEN even with a valid token.
 */
import { jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';

function backendUrlOf(fetchMock: jest.MockedFunction<typeof fetch>): string {
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    return url;
}

function headersOf(fetchMock: jest.MockedFunction<typeof fetch>): Record<string, string> {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return init.headers as Record<string, string>;
}

function bodyBytesOf(fetchMock: jest.MockedFunction<typeof fetch>): Buffer {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return Buffer.from(init.body as ArrayBuffer);
}

async function callPost(request: NextRequest, path: string[] = ['me', 'avatar']) {
    return POST(request, { params: Promise.resolve({ path }) });
}

async function callGet(request: NextRequest, path: string[] = ['me']) {
    return GET(request, { params: Promise.resolve({ path }) });
}

describe('/api/auth/health/[...path] proxy', () => {
    const originalInternalApiUrl = process.env.INTERNAL_API_URL;
    const originalBackendUrl = process.env.BACKEND_URL;
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetAllMocks();
        process.env.INTERNAL_API_URL = 'http://backend:8000';
        process.env.BACKEND_URL = '';
    });

    afterEach(() => {
        process.env.INTERNAL_API_URL = originalInternalApiUrl;
        process.env.BACKEND_URL = originalBackendUrl;
        global.fetch = originalFetch;
    });

    it('forwards a multipart POST body with its exact bytes and Content-Type boundary intact', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const boundary = '----WebKitFormBoundaryABC123';
        const multipartBody =
            `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="avatar"; filename="a.png"\r\n' +
            'Content-Type: image/png\r\n\r\n' +
            'FAKE-PNG-BINARY-BYTES-not-a-real-image\r\n' +
            `--${boundary}--\r\n`;

        const request = new NextRequest('http://localhost:3000/api/auth/health/me/avatar', {
            method: 'POST',
            headers: {
                'content-type': `multipart/form-data; boundary=${boundary}`,
                authorization: 'Bearer test-access-token',
            },
            body: multipartBody,
        });

        const response = await callPost(request);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual(expect.objectContaining({ success: true }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(backendUrlOf(fetchMock)).toBe('http://backend:8000/api/auth/health/me/avatar');
        expect(headersOf(fetchMock)['Content-Type']).toBe(`multipart/form-data; boundary=${boundary}`);
        expect(bodyBytesOf(fetchMock).toString('latin1')).toBe(multipartBody);
    });

    it('forwards the incoming Authorization header verbatim', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/health/me', {
            method: 'GET',
            headers: { authorization: 'Bearer test-access-token' },
        });

        await callGet(request);

        expect(headersOf(fetchMock)['Authorization']).toBe('Bearer test-access-token');
    });

    it('maps the auth_token cookie to a Bearer header when no Authorization header is sent, without dropping the Cookie header', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/health/me', {
            method: 'GET',
            headers: { cookie: 'auth_token=cookie-token-value; csrf_token=abc' },
        });

        await callGet(request);

        const headers = headersOf(fetchMock);
        expect(headers['Authorization']).toBe('Bearer cookie-token-value');
        expect(headers['Cookie']).toBe('auth_token=cookie-token-value; csrf_token=abc');
    });

    it('forwards the x-csrf-token header (required by the backend double-submit CSRF check whenever the auth_token cookie is present)', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/health/me/avatar', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: 'auth_token=cookie-token-value; csrf_token=csrf-value-abc',
                'x-csrf-token': 'csrf-value-abc',
            },
            body: JSON.stringify({}),
        });

        await callPost(request);

        expect(headersOf(fetchMock)['x-csrf-token']).toBe('csrf-value-abc');
    });

    it('still forwards a JSON POST body correctly', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: { tokens: { accessToken: 'x' } } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const requestBody = { citizenId: '1234567890123', password: 'Passw0rd!' };
        const request = new NextRequest('http://localhost:3000/api/auth/health/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        const response = await callPost(request, ['login']);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(headersOf(fetchMock)['Content-Type']).toBe('application/json');
        expect(JSON.parse(bodyBytesOf(fetchMock).toString('utf-8'))).toEqual(requestBody);
    });

    it('passes through Set-Cookie from the backend response (login depends on this)', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'set-cookie': 'auth_token=new-session-token; HttpOnly; Path=/',
                },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/health/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ citizenId: '1234567890123', password: 'Passw0rd!' }),
        });

        const response = await callPost(request, ['login']);

        expect(response.headers.get('set-cookie')).toBe('auth_token=new-session-token; HttpOnly; Path=/');
    });

    it('forwards the x-active-entity-id header to the backend (B1 — workspace-switching bug)', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/health/me', {
            method: 'GET',
            headers: {
                authorization: 'Bearer test-access-token',
                'x-active-entity-id': 'ent-juristic-789',
            },
        });

        await callGet(request);

        expect(headersOf(fetchMock)['x-active-entity-id']).toBe('ent-juristic-789');
    });

    it('returns 503 BACKEND_UNREACHABLE without leaking the raw error.message when the backend is unreachable', async () => {
        const secret = 'ECONNREFUSED 10.0.0.1:8000';
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockRejectedValue(new Error(secret));
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/health/me', { method: 'GET' });
        const response = await callGet(request);
        const payload = await response.json();

        expect(response.status).toBe(503);
        expect(payload).toEqual(expect.objectContaining({ success: false, code: 'BACKEND_UNREACHABLE' }));
        expect(JSON.stringify(payload)).not.toContain(secret);
    });
});
