/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { POST } from './route';

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/auth/change-password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('/api/auth/change-password route', () => {
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

  it('returns 400 when passwords are missing', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const request = buildRequest({ currentPassword: '', newPassword: '' });
    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('required'),
    }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps currentPassword to oldPassword and forwards auth headers', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;

    const request = buildRequest(
      { currentPassword: 'OldPass123!', newPassword: 'NewPass123!' },
      {
        cookie: 'auth_token=token; csrf_token=abc123',
        authorization: 'Bearer sample',
        'x-csrf-token': 'abc123',
      },
    );

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({ success: true }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://backend:8000/api/auth/health/change-password');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(expect.objectContaining({
      Cookie: 'auth_token=token; csrf_token=abc123',
      Authorization: 'Bearer sample',
      'x-csrf-token': 'abc123',
    }));
    expect(init.body).toBe(JSON.stringify({
      oldPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    }));
  });

  it('returns 503 when backend is unreachable', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockRejectedValue(new Error('network failed'));
    global.fetch = fetchMock;

    const request = buildRequest({
      oldPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    });
    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual(expect.objectContaining({
      success: false,
      code: 'BACKEND_UNREACHABLE',
    }));
    expect(fetchMock).toHaveBeenCalled();
  });
});
