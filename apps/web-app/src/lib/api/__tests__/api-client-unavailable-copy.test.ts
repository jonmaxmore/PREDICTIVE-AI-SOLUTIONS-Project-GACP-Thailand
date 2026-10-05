/**
 * W1-COPY — honest backend-unavailable copy.
 *
 * Bug: `toUserFriendlyError` mapped EVERY 'service unavailable' error to
 * 'ระบบกำลังเริ่มต้น กรุณารอสักครู่แล้วลองใหม่' ("the system is starting").
 * With the backend fully DOWN the Next proxy returns 503
 * `{ error: 'Backend service unavailable' | 'Auth service unavailable',
 *    code: 'BACKEND_UNREACHABLE' }` — the system is not "starting", it is
 * unreachable. A farmer failing to log in was told a half-truth that
 * implies waiting will fix it.
 *
 * Fix under test: the generic 'service unavailable' keyword now maps to
 * the honest-neutral 'ยังเชื่อมต่อระบบไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
 * while the genuinely-starting backend signal
 * ('database connection is initializing') KEEPS the starting copy —
 * the code distinguishes the two cases.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../api-client';

type MockResponseInit = {
    status: number;
    body: unknown;
    contentType?: string;
};

function mockJsonResponse({ status, body, contentType = 'application/json' }: MockResponseInit): Response {
    const text = JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null,
        },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(text),
    } as unknown as Response;
}

const realFetch = globalThis.fetch;
type FetchMock = jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;

const HONEST_UNREACHABLE_TH = 'ยังเชื่อมต่อระบบไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
const GENUINELY_STARTING_TH = 'ระบบกำลังเริ่มต้น กรุณารอสักครู่แล้วลองใหม่';

describe('toUserFriendlyError — backend-unavailable copy (W1-COPY)', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;

    beforeEach(() => {
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    });

    it('login 503 (Auth service unavailable / BACKEND_UNREACHABLE) → honest "cannot connect" copy, NOT "system is starting"', async () => {
        // Exact proxy envelope from src/app/api/auth/health/[...path]/route.ts:120
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 503,
            body: { success: false, error: 'Auth service unavailable', code: 'BACKEND_UNREACHABLE' },
        }));

        const res = await client.post('/api/auth/health/login', { identifier: 'x', password: 'y' });

        expect(res.success).toBe(false);
        expect(res.error).toBe(HONEST_UNREACHABLE_TH);
        expect(res.error).not.toContain('ระบบกำลังเริ่มต้น');
    });

    it('generic 503 (Backend service unavailable) → honest "cannot connect" copy', async () => {
        // Exact proxy envelope from src/app/api/[...path]/route.ts:86
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 503,
            body: { success: false, error: 'Backend service unavailable', code: 'BACKEND_UNREACHABLE' },
        }));

        const res = await client.get('/api/certificates/c1');

        expect(res.success).toBe(false);
        expect(res.status).toBe(503);
        expect(res.error).toBe(HONEST_UNREACHABLE_TH);
    });

    it('genuinely-starting backend (database connection is initializing) KEEPS the starting copy', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 503,
            body: { success: false, error: 'Database connection is initializing, please retry' },
        }));

        const res = await client.get('/api/health');

        expect(res.success).toBe(false);
        expect(res.error).toBe(GENUINELY_STARTING_TH);
    });
});
