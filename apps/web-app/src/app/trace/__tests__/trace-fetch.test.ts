/**
 * W1-TRACE — shared fetch-outcome classifier for the public /trace/** surfaces.
 *
 * The bug being fixed: every trace client-view collapsed BOTH of these into the
 * same red "ไม่พบข้อมูล / not found" card:
 *   (a) the backend ANSWERED with a definitive verdict (404 not-found envelope,
 *       410 revoked/expired gate, or 2xx + success:false), and
 *   (b) the backend was UNREACHABLE (proxy 503 BACKEND_UNREACHABLE, upstream
 *       5xx, network error, non-JSON error page).
 *
 * Case (b) must NEVER claim "not found" on a public trust surface (QR scan on
 * product packaging) — it renders a neutral amber "ไม่สามารถตรวจสอบได้ในขณะนี้"
 * state instead, mirroring the /verify/[cert-number] page.
 *
 * Backend status semantics (apps/backend/routes/api/trace/*):
 *   404 + {success:false,message}  → definitive not-found verdict
 *   410 + {success:false,message}  → definitive revoked/expired verdict
 *   500 + {success:false,message}  → backend failure, NO verdict
 * Proxy semantics (src/app/api/[...path]/route.ts):
 *   503 + {success:false,code:'BACKEND_UNREACHABLE'} → transport failure
 */

import { classifyTraceResponse, fetchTraceEnvelope } from '../trace-fetch';

describe('classifyTraceResponse', () => {
    it('returns ok for 200 + success:true', () => {
        const payload = { success: true, data: { lotNumber: 'LOT-1' } };
        expect(classifyTraceResponse(200, payload)).toEqual({ kind: 'ok', payload });
    });

    it('returns not-found for 200 + success:false (backend answered a definitive flag)', () => {
        expect(classifyTraceResponse(200, { success: false, message: 'ไม่พบข้อมูล' }))
            .toEqual({ kind: 'not-found', message: 'ไม่พบข้อมูล' });
    });

    it('returns not-found for a 404 envelope (definitive backend verdict)', () => {
        expect(classifyTraceResponse(404, { success: false, message: 'ไม่พบข้อมูล Trace สำหรับรหัสนี้' }))
            .toEqual({ kind: 'not-found', message: 'ไม่พบข้อมูล Trace สำหรับรหัสนี้' });
    });

    it('returns not-found for a 410 envelope, keeping the honest revoked/expired reason', () => {
        expect(classifyTraceResponse(410, { success: false, message: 'ใบรับรองหมดอายุแล้ว / Certificate has expired' }))
            .toEqual({ kind: 'not-found', message: 'ใบรับรองหมดอายุแล้ว / Certificate has expired' });
    });

    it('returns not-found with message:null when the envelope has no message', () => {
        expect(classifyTraceResponse(404, { success: false }))
            .toEqual({ kind: 'not-found', message: null });
    });

    it('returns unavailable for the proxy 503 BACKEND_UNREACHABLE envelope — NEVER a verdict', () => {
        expect(classifyTraceResponse(503, { success: false, error: 'Backend service unavailable', code: 'BACKEND_UNREACHABLE' }))
            .toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable for a backend 500 (server failure is not a verdict)', () => {
        expect(classifyTraceResponse(500, { success: false, message: 'Internal server error' }))
            .toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable for 502/504 gateway statuses', () => {
        expect(classifyTraceResponse(502, null)).toEqual({ kind: 'unavailable' });
        expect(classifyTraceResponse(504, { success: false })).toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable when the body was not parseable JSON (nginx HTML error page)', () => {
        expect(classifyTraceResponse(200, null)).toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable for non-verdict 4xx statuses (e.g. 429 rate-limit)', () => {
        expect(classifyTraceResponse(429, { success: false, message: 'Too many requests' }))
            .toEqual({ kind: 'unavailable' });
    });
});

describe('fetchTraceEnvelope', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    function mockFetchResponse(status: number, body: unknown, jsonThrows = false) {
        global.fetch = jest.fn().mockResolvedValue({
            ok: status >= 200 && status < 300,
            status,
            json: jsonThrows
                ? jest.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON'))
                : jest.fn().mockResolvedValue(body),
        }) as unknown as typeof fetch;
    }

    it('returns ok with the payload on 200 + success:true', async () => {
        mockFetchResponse(200, { success: true, data: { batchNumber: 'B-1' } });
        const outcome = await fetchTraceEnvelope('/api/trace/batch/B-1');
        expect(outcome).toEqual({ kind: 'ok', payload: { success: true, data: { batchNumber: 'B-1' } } });
    });

    it('returns unavailable when fetch rejects (network down)', async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
        expect(await fetchTraceEnvelope('/api/trace/x')).toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable when the response body is not JSON', async () => {
        mockFetchResponse(503, null, true);
        expect(await fetchTraceEnvelope('/api/trace/x')).toEqual({ kind: 'unavailable' });
    });

    it('returns not-found for a definitive 404 envelope', async () => {
        mockFetchResponse(404, { success: false, message: 'ไม่พบข้อมูลผลิตภัณฑ์' });
        expect(await fetchTraceEnvelope('/api/trace/x'))
            .toEqual({ kind: 'not-found', message: 'ไม่พบข้อมูลผลิตภัณฑ์' });
    });
});

// Review-pass addition: 400 (malformed/blank QR) is a definitive verdict.
describe('definitive 400 handling (review pass)', () => {
    it('classifies a 400 envelope as not-found, not unavailable', () => {
        expect(classifyTraceResponse(400, { success: false, message: 'ต้องระบุรหัส QR' }).kind).toBe('not-found');
    });
});
