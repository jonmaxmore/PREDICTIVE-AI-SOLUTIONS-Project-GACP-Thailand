/**
 * @jest-environment node
 *
 * Same root-cause defect as src/app/api/auth/health/[...path]/route.ts:
 * hardcoded 'Content-Type: application/json' + request.json() destroyed
 * multipart bodies, and no Authorization forwarding meant Bearer-token
 * clients got 401. See that file's route.test.ts for the full writeup.
 */
import { jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';

function headersOf(fetchMock: jest.MockedFunction<typeof fetch>): Record<string, string> {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return init.headers as Record<string, string>;
}

function bodyBytesOf(fetchMock: jest.MockedFunction<typeof fetch>): Buffer {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return Buffer.from(init.body as ArrayBuffer);
}

async function callPost(request: NextRequest, path: string[]) {
    return POST(request, { params: Promise.resolve({ path }) });
}

async function callGet(request: NextRequest, path: string[]) {
    return GET(request, { params: Promise.resolve({ path }) });
}

describe('/api/auth/provider/[...path] proxy', () => {
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

        const boundary = '----WebKitFormBoundaryXYZ789';
        const multipartBody =
            `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="document"; filename="d.pdf"\r\n' +
            'Content-Type: application/pdf\r\n\r\n' +
            '%PDF-fake-bytes\r\n' +
            `--${boundary}--\r\n`;

        const request = new NextRequest('http://localhost:3000/api/auth/provider/documents/upload', {
            method: 'POST',
            headers: {
                'content-type': `multipart/form-data; boundary=${boundary}`,
                authorization: 'Bearer provider-access-token',
            },
            body: multipartBody,
        });

        const response = await callPost(request, ['documents', 'upload']);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual(expect.objectContaining({ success: true }));
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

        const request = new NextRequest('http://localhost:3000/api/auth/provider/me', {
            method: 'GET',
            headers: { authorization: 'Bearer provider-access-token' },
        });

        await callGet(request, ['me']);

        expect(headersOf(fetchMock)['Authorization']).toBe('Bearer provider-access-token');
    });

    it('maps the provider_token cookie to a Bearer header when no Authorization header is sent, without dropping the Cookie header', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/provider/me', {
            method: 'GET',
            headers: { cookie: 'provider_token=provider-cookie-value' },
        });

        await callGet(request, ['me']);

        const headers = headersOf(fetchMock);
        expect(headers['Authorization']).toBe('Bearer provider-cookie-value');
        expect(headers['Cookie']).toBe('provider_token=provider-cookie-value');
    });

    it('forwards the x-csrf-token header (required by the backend double-submit CSRF check whenever the provider_token cookie is present)', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/provider/documents/upload', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: 'provider_token=provider-cookie-value; csrf_token=csrf-value-xyz',
                'x-csrf-token': 'csrf-value-xyz',
            },
            body: JSON.stringify({}),
        });

        await callPost(request, ['documents', 'upload']);

        expect(headersOf(fetchMock)['x-csrf-token']).toBe('csrf-value-xyz');
    });

    it('still forwards a JSON POST body correctly', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        global.fetch = fetchMock;

        const requestBody = { email: 'provider@example.com', password: 'Passw0rd!' };
        const request = new NextRequest('http://localhost:3000/api/auth/provider/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        const response = await callPost(request, ['login']);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(JSON.parse(bodyBytesOf(fetchMock).toString('utf-8'))).toEqual(requestBody);
    });

    it('passes through Set-Cookie from the backend response', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'set-cookie': 'provider_token=new-session-token; HttpOnly; Path=/',
                },
            })
        );
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/provider/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'provider@example.com', password: 'Passw0rd!' }),
        });

        const response = await callPost(request, ['login']);

        expect(response.headers.get('set-cookie')).toBe('provider_token=new-session-token; HttpOnly; Path=/');
    });

    it('still handles the local set-cookie endpoint without forwarding to the backend', async () => {
        const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
        global.fetch = fetchMock;

        const request = new NextRequest('http://localhost:3000/api/auth/provider/set-cookie', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'abc', cookieName: 'provider_token' }),
        });

        const response = await callPost(request, ['set-cookie']);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual(expect.objectContaining({ success: true }));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(response.headers.get('set-cookie')).toContain('provider_token=abc');
    });
});
