/**
 * api-client-active-entity-mismatch.test.ts
 *
 * reports/design-cleanup-2026-08-21/01-IDENTITY-AND-VOCABULARY.md B1 trap:
 * once the proxy (route.ts / proxy-forward.ts) forwards `x-active-entity-id`
 * to the backend, a STALE value left in localStorage (a revoked membership,
 * a switched account, etc.) now actually reaches
 * apps/backend/middleware/active-entity-middleware.js, which 403s with
 * `{ success:false, error:'Forbidden', message:'...', code:'ACTIVE_ENTITY_MISMATCH' }`.
 *
 * Before this fix the api-client's generic 403 branch would harvest
 * `rawCode = data.error || data.code` — since `data.error` is the literal
 * string 'Forbidden', the real code ('ACTIVE_ENTITY_MISMATCH') never
 * surfaced, and the blanket 403 copy told the user to re-login (wrong: the
 * session is fine, only the stale workspace selection is bad). This test
 * pins the recovery: detect the code, clear the stale
 * `gacp.activeEntityId` localStorage key (same key
 * ActiveEntityProvider/api-client already read/write), and return an honest
 * Thai message instead of the re-login copy.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../api-client';

const STORAGE_KEY = 'gacp.activeEntityId';

function mockJsonResponse(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

const realFetch = globalThis.fetch;
type FetchMock = jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;

describe('apiClient — ACTIVE_ENTITY_MISMATCH recovery (B1 trap)', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;

    beforeEach(() => {
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
        window.localStorage.clear();
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        window.localStorage.clear();
    });

    it('clears the stale gacp.activeEntityId and returns an honest recovery message on ACTIVE_ENTITY_MISMATCH', async () => {
        window.localStorage.setItem(STORAGE_KEY, 'ent-stale-revoked');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, {
            success: false,
            error: 'Forbidden',
            message: 'Active entity does not match an active membership',
            code: 'ACTIVE_ENTITY_MISMATCH',
        }));

        const res = await client.get('/api/applications/my');

        expect(res.success).toBe(false);
        expect(res.status).toBe(403);
        expect(res.code).toBe('ACTIVE_ENTITY_MISMATCH');
        // Honest copy: names the cause (stale/invalid workspace selection) and
        // the next action (automatic fallback + retry) — NOT the generic
        // "re-login or contact staff" 403 rewrite, which is actively wrong
        // here (the session is fine).
        expect(res.error).not.toContain('เข้าสู่ระบบใหม่');
        expect(res.error).toContain('ลองใหม่');
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does NOT clear localStorage or special-case the message for a plain 403 Forbidden (no ACTIVE_ENTITY_MISMATCH code)', async () => {
        window.localStorage.setItem(STORAGE_KEY, 'ent-still-valid');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, {
            success: false,
            error: 'Forbidden',
        }));

        const res = await client.get('/api/provider/work');

        expect(res.success).toBe(false);
        expect(res.code).not.toBe('ACTIVE_ENTITY_MISMATCH');
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('ent-still-valid');
    });
});
