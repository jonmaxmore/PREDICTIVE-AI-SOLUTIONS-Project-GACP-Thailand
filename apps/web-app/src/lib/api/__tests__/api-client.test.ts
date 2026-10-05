/**
 * apiClient envelope tests (Iter R5-C).
 *
 * Covers the R5-C / R1-review-H-3 fix:
 *   - non-2xx responses preserve the raw backend `code` BEFORE
 *     `toUserFriendlyError` rewrites the message, so callers can branch
 *     on machine-readable identifiers (e.g. `PENDING_INVOICES_IN_PERIOD`).
 *   - non-2xx responses harvest sibling fields into `.meta` so structured
 *     metadata (`openInvoices`, `warnings`, `periodCloseId`) reaches the UI.
 *   - 2xx responses leave `code`/`meta` undefined.
 *   - Existing Thai-rewrite behaviour on `.error` is preserved for known
 *     keywords (e.g. 'invalid credentials').
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../api-client';

type MockResponseInit = {
    status: number;
    body: unknown;
    contentType?: string;
};

/**
 * Build a minimal Response-shaped object that satisfies apiClient's
 * runtime contract (status, ok, headers.get, json(), text()) without
 * requiring the global `Response` constructor (not in node-jsdom).
 */
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

// Save the real fetch so we can restore it. globalThis.fetch is read-only
// in some envs, so we directly assign rather than jest.spyOn.
const realFetch = globalThis.fetch;
type FetchMock = jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;

describe('apiClient envelope (R5-C)', () => {
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

    it('populates `code` from `data.error` and `meta` from sibling fields on non-2xx', async () => {
        // Mirrors the backend envelope at
        // apps/backend/routes/api/finance/period-close.js:102-117 —
        // the H-1 fixture from Iter R1 review.
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 409,
            body: {
                success: false,
                error: 'PENDING_INVOICES_IN_PERIOD',
                message: 'There are 5 invoices in this period',
                openInvoices: 5,
                warnings: ['INV-001', 'INV-002'],
            },
        }));

        const res = await client.post('/api/finance/period-close', { year: 2026, month: 4 });

        expect(res.success).toBe(false);
        expect(res.code).toBe('PENDING_INVOICES_IN_PERIOD');
        expect(res.meta).toEqual({
            openInvoices: 5,
            warnings: ['INV-001', 'INV-002'],
        });
        // The Thai-friendly text remains for direct display; the raw code
        // does NOT bleed into the user-facing message.
        expect(typeof res.error).toBe('string');
    });

    it('falls back to `data.code` when `data.error` is missing', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 400,
            body: {
                success: false,
                code: 'VALIDATION_ERROR',
                message: 'Invalid payload',
            },
        }));

        const res = await client.post('/api/test', {});

        expect(res.success).toBe(false);
        expect(res.code).toBe('VALIDATION_ERROR');
    });

    it('leaves `code` and `meta` undefined on 2xx', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 200,
            body: { success: true, data: { ok: true } },
        }));

        const res = await client.get('/api/health');

        expect(res.success).toBe(true);
        expect(res.code).toBeUndefined();
        expect(res.meta).toBeUndefined();
    });

    it('omits `.meta` entirely when no sibling fields exist', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                error: 'FORBIDDEN',
                message: 'Not allowed',
            },
        }));

        const res = await client.get('/api/test');

        expect(res.code).toBe('FORBIDDEN');
        // No siblings beyond success/error/message — meta should be absent.
        expect(res.meta).toBeUndefined();
    });

    it('still rewrites `.error` for known keywords (toUserFriendlyError preserved)', async () => {
        // Even though we now capture the raw `code`, the user-facing
        // `.error` field continues to receive the Thai-friendly rewrite.
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 401,
            body: {
                success: false,
                error: 'Invalid credentials',
                message: 'Invalid credentials',
            },
        }));

        const res = await client.post('/api/auth/login', {
            identifier: 'x',
            password: 'y',
        });

        expect(res.success).toBe(false);
        // Thai rewrite fires on the friendly message.
        expect(res.error).toContain('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
        // Raw code is still captured for callers that branch on it.
        expect(res.code).toBe('Invalid credentials');
    });

    it('populates code/meta on 401 auth endpoints too', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 401,
            body: {
                success: false,
                error: 'ACCOUNT_LOCKED',
                message: 'Account locked',
                lockedUntil: '2026-05-18T00:00:00Z',
                attempts: 5,
            },
        }));

        const res = await client.post('/api/auth/login', {
            identifier: 'x',
            password: 'y',
        });

        expect(res.success).toBe(false);
        expect(res.code).toBe('ACCOUNT_LOCKED');
        expect(res.meta).toEqual({
            lockedUntil: '2026-05-18T00:00:00Z',
            attempts: 5,
        });
    });
});

/**
 * Farm-worker Wave C adversarial-verify MUST F2 — the blanket 403 rewrite
 * ('คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาเข้าสู่ระบบใหม่หรือติดต่อเจ้าหน้าที่')
 * clobbered the routes' own correct workspace-denial Thai copy AND told
 * permission-denied workers to re-login (wrong: their session is fine —
 * they lack a farm-operation permission). Entity-permission denials must
 * pass the server's own message through; every OTHER 403 keeps the
 * generic rewrite.
 */
describe('apiClient 403 entity-permission denial pass-through (Wave-C F2)', () => {
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

    const THAI_ERROR_SHAPE = 'คุณไม่มีสิทธิ์บันทึกการเก็บเกี่ยวในพื้นที่ทำงานนี้';
    const THAI_MESSAGE_SHAPE = 'คุณไม่มีสิทธิ์จัดการต้นปลูกในพื้นที่ทำงานนี้';
    const GENERIC_403_TH = 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาเข้าสู่ระบบใหม่หรือติดต่อเจ้าหน้าที่';

    // Retargeted 2026-08-25: this case used to post to /api/plant-units/u1/confirm
    // and cite plant-unit-ownership.js. Both were deleted with per-plant tracking
    // (R8, design note 2026-08-20-planting-tnt-design). What the
    // case is FOR is the SHAPE — Thai copy arriving in `message` rather than
    // `error` — so it now uses POST /api/cultivation-logs, which is live and
    // whose controller still ships shape B (cultivation-log-controller.js:51-58).
    it('passes through the route\'s Thai copy — shape A: Thai in `error` (harvest-batches.js)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                code: 'ENTITY_PERMISSION_DENIED',
                permission: 'HARVEST_RECORD',
                error: THAI_ERROR_SHAPE,
            },
        }));

        const res = await client.post('/api/planting-cycles/c1/harvest-batches', {});

        expect(res.success).toBe(false);
        expect(res.status).toBe(403);
        expect(res.error).toBe(THAI_ERROR_SHAPE);
        // NOT the re-login copy — the session is fine.
        expect(res.error).not.toBe(GENERIC_403_TH);
    });

    it('passes through the route\'s Thai copy — shape B: Thai in `message` (cultivation-log-controller.js)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                code: 'ENTITY_PERMISSION_DENIED',
                permission: 'ACTIVITY_IRRIGATION',
                message: THAI_MESSAGE_SHAPE,
            },
        }));

        const res = await client.post('/api/cultivation-logs', {});

        expect(res.success).toBe(false);
        expect(res.error).toBe(THAI_MESSAGE_SHAPE);
    });

    it('normalizes `.code` to ENTITY_PERMISSION_DENIED for both shapes (F1(b) eviction detector relies on it)', async () => {
        // Shape A: rawCode = data.error||data.code would harvest the THAI
        // MESSAGE as the code — the denial branch must normalize instead.
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                code: 'ENTITY_PERMISSION_DENIED',
                permission: 'QR_GENERATE',
                error: THAI_ERROR_SHAPE,
            },
        }));
        const resA = await client.post('/api/planting-cycles/c1/plot-qrs/generate', {});
        expect(resA.code).toBe('ENTITY_PERMISSION_DENIED');

        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                code: 'ENTITY_PERMISSION_DENIED',
                permission: 'ACTIVITY_IRRIGATION',
                message: THAI_MESSAGE_SHAPE,
            },
        }));
        const resB = await client.post('/api/cultivation-logs', {});
        expect(resB.code).toBe('ENTITY_PERMISSION_DENIED');
    });

    it('keeps `permission` reachable via `.meta` (sibling-field harvest unchanged)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                code: 'ENTITY_PERMISSION_DENIED',
                permission: 'FARM_CREATE',
                error: 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน',
            },
        }));

        const res = await client.post('/api/farms', {});
        expect(res.meta).toEqual({ permission: 'FARM_CREATE' });
    });

    it('falls back to the generic workspace-denial Thai copy when the denial body carries no human message (shape C: code in `error`)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: {
                success: false,
                error: 'ENTITY_PERMISSION_DENIED',
            },
        }));

        const res = await client.post('/api/farms', {});
        expect(res.error).toBe('ไม่มีสิทธิ์ดำเนินการนี้ ติดต่อเจ้าของ workspace');
        expect(res.code).toBe('ENTITY_PERMISSION_DENIED');
    });

    it('keeps the generic rewrite for every NON-permission 403 (session guard, bare Forbidden)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: { success: false, error: 'Forbidden' },
        }));

        const res = await client.get('/api/provider/work');
        expect(res.error).toBe(GENERIC_403_TH);
    });

    it('never treats a 403 with a non-JSON body as a permission denial (no shape to trust)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 403,
            body: '<html>Forbidden</html>',
            contentType: 'text/html',
        }));

        const res = await client.get('/api/anything');
        // Existing empty-message generic — NOT the workspace-denial copy.
        expect(res.error).toBe('ไม่สามารถดำเนินการได้ (HTTP 403)');
        expect(res.error).not.toBe('ไม่มีสิทธิ์ดำเนินการนี้ ติดต่อเจ้าของ workspace');
        expect(res.code).toBeUndefined();
    });
});

/**
 * Gap 24 (audit batch-2 FE cluster) — the SUCCESS envelope strip
 * (`res.data = body.data ?? body`) silently DROPPED every sibling field
 * that sits ALONGSIDE the data array/object (counts / total / pagination /
 * summary / meta). The ERROR branch already harvests siblings into `.meta`
 * (extractEnvelopeMeta) — this asymmetry meant a Scheduler/Admin list page
 * that reads `res.meta.counts` on a 2xx got `undefined` and blanked/crashed.
 *
 * Fix: on 2xx, ALSO harvest siblings onto `.meta` (mirror the error branch)
 * WITHOUT changing `res.data` (existing consumers rely on the unwrapped
 * `body.data ?? body`).
 */
describe('apiClient success-envelope sibling harvest (Gap 24)', () => {
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

    it('harvests counts/total siblings into .meta on 2xx WITHOUT changing .data (the DoD fixture)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 200,
            body: {
                success: true,
                data: [{ id: 1 }, { id: 2 }],
                counts: { active: 1, revoked: 0 },
                total: 5,
            },
        }));

        const res = await client.get('/api/provider/scheduler/list');

        expect(res.success).toBe(true);
        // data is UNCHANGED — the unwrapped array, exactly as before.
        expect(res.data).toEqual([{ id: 1 }, { id: 2 }]);
        // siblings are now reachable, mirroring the error branch.
        expect(res.meta).toEqual({ counts: { active: 1, revoked: 0 }, total: 5 });
    });

    it('harvests pagination/summary siblings into .meta on 2xx', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 200,
            body: {
                success: true,
                data: [{ id: 'a' }],
                pagination: { page: 2, pageSize: 20, totalPages: 7 },
                summary: { sum: 12345 },
            },
        }));

        const res = await client.get('/api/finance/invoices');

        expect(res.data).toEqual([{ id: 'a' }]);
        expect(res.meta).toEqual({
            pagination: { page: 2, pageSize: 20, totalPages: 7 },
            summary: { sum: 12345 },
        });
    });

    it('omits .meta entirely when the 2xx envelope has NO siblings beside data (no crash)', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 200,
            body: { success: true, data: { ok: true } },
        }));

        const res = await client.get('/api/health');

        expect(res.data).toEqual({ ok: true });
        expect(res.meta).toBeUndefined();
    });

    it('leaves .data as the whole body when there is no `data` key (unwrap unchanged) + harvests its siblings', async () => {
        // Non-enveloped payload: no `data` key → res.data is the whole body
        // (existing `body.data ?? body` behaviour — NOT changed). meta mirrors
        // the error branch (harvest of every non-reserved key).
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 200,
            body: { items: [1, 2, 3], total: 3 },
        }));

        const res = await client.get('/api/legacy/list');

        expect(res.data).toEqual({ items: [1, 2, 3], total: 3 });
        expect(res.meta).toEqual({ items: [1, 2, 3], total: 3 });
    });

    it('pins the {data:null} conflation as UNCHANGED (res.data still falls back to the whole body; siblings still harvested)', async () => {
        // Audit note: `body.data ?? body` conflates an explicit data:null with
        // "no envelope", so res.data becomes the whole body. That behaviour is
        // OUT OF SCOPE to change (existing consumers rely on it); this test
        // pins it so the meta addition provably does not disturb it.
        fetchMock.mockResolvedValueOnce(mockJsonResponse({
            status: 200,
            body: { success: true, data: null, total: 0 },
        }));

        const res = await client.get('/api/finance/summary');

        expect(res.success).toBe(true);
        // data:null falls through to the whole body — unchanged legacy behaviour.
        expect(res.data).toEqual({ success: true, data: null, total: 0 });
        // sibling still harvested (data + success are reserved/stripped from meta).
        expect(res.meta).toEqual({ total: 0 });
    });
});
