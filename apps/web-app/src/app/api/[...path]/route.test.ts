/**
 * @jest-environment node
 *
 * C4-08 guard: the generic API proxy must NOT leak the raw upstream
 * error.message to the client and must return a gateway-class status
 * (503 BACKEND_UNREACHABLE) on transport failure — matching the
 * auth/health, auth/provider and change-password sibling proxies.
 */
import { jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
jest.mock('@/config/server.config', () => ({
  INTERNAL_BACKEND_URL: 'http://backend:8000',
}));

// jest.mock calls are hoisted above this import, so ./route picks up the mocks.
import { GET } from './route';

function buildRequest() {
  return new NextRequest('http://localhost:3000/api/some/path', { method: 'GET' });
}

describe('/api/[...path] generic proxy — transport failure', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('returns 503 BACKEND_UNREACHABLE without leaking the raw error.message', async () => {
    const secret = 'ECONNREFUSED 10.0.0.1:8000 connect to internal host';
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockRejectedValue(new Error(secret));
    global.fetch = fetchMock;

    const response = await GET(buildRequest(), {
      params: Promise.resolve({ path: ['some', 'path'] }),
    });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual(
      expect.objectContaining({ success: false, code: 'BACKEND_UNREACHABLE' }),
    );
    // The raw upstream/transport error must never reach the client body.
    expect(JSON.stringify(payload)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(fetchMock).toHaveBeenCalled();
  });
});

/**
 * R2 (remove workspace mode): the workspace header is retired. The proxy
 * must not carry `x-active-entity-id` to the backend even if an old browser
 * tab still sends it.
 */
describe('/api/[...path] generic proxy — retired active-entity header', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('the proxy does not forward x-active-entity-id', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;

    const request = new NextRequest('http://localhost:3000/api/applications/my', {
      method: 'GET',
      headers: { 'x-active-entity-id': 'ent-juristic-123' },
    });

    await GET(request, { params: Promise.resolve({ path: ['applications', 'my'] }) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-active-entity-id']).toBeUndefined();
  });
});
