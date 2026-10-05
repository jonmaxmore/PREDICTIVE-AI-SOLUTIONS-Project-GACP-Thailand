/**
 * AdminService.revokeCertificate — error copy for the codes the mapped
 * table did not cover.
 *
 * Drives the REAL service through the REAL apiClient with only `fetch`
 * mocked, because the defect lives in the seam between them: apiClient
 * takes the backend's `error` field (a machine code) as the display text,
 * `toUserFriendlyError` echoes an unrecognised code verbatim, and its
 * network/timeout catch branch returns English with no status and no
 * code. Mocking apiClient would hide all three.
 *
 * Every case asserts the message the dialog will put in role="alert":
 * Thai, names the cause and the next action, never the raw code, never
 * the client's English fallback.
 */

import { AdminService, REVOKE_ERROR_MESSAGES } from '../admin-service';

const THAI = /[฀-๿]/;
const CERT_ID = 'cert-1';
const REASON = 'ตรวจพบการปลอมแปลงเอกสาร';
const REVOKE_URL = '/api/admin/certificates/cert-1/revoke';

// Backend copy from routes/api/admin/certificates.js MESSAGES — it is
// DISCARDED by apiClient when `error` is present, which is what these
// cases prove the service copes with.
const BACKEND_SERVER_ERROR_TH = 'ระบบไม่สามารถเพิกถอนใบรับรองได้ในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่';
const BACKEND_INVALID_REQUEST_TH = 'คำขอเพิกถอนไม่ถูกต้อง กรุณาตรวจสอบข้อมูลที่คุณกรอกแล้วลองใหม่อีกครั้ง';

type FakeResponse = {
    ok: boolean;
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
    text: () => Promise<string>;
};

function jsonResponse(status: number, body: unknown): FakeResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

function htmlResponse(status: number, html: string): FakeResponse {
    return {
        ok: false,
        status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        json: async () => { throw new Error('not json'); },
        text: async () => html,
    };
}

const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function expectThaiCauseAndAction(message: string, code: string): void {
    expect(message).toMatch(THAI);
    expect(message).not.toContain(code);
    expect(message).not.toMatch(/Unable to connect|Request timeout|Please try again/i);
}

describe('AdminService.revokeCertificate — unmapped error codes render Thai copy', () => {
    it('500 CERTIFICATE_REVOKE_FAILED: message is Thai cause + next action, not the code', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(500, {
            success: false,
            error: 'CERTIFICATE_REVOKE_FAILED',
            message: BACKEND_SERVER_ERROR_TH,
        }));

        const out = await AdminService.revokeCertificate(CERT_ID, REASON);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(REVOKE_URL);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('CERTIFICATE_REVOKE_FAILED');
        expectThaiCauseAndAction(out.message, 'CERTIFICATE_REVOKE_FAILED');
        expect(out.message).toBe(REVOKE_ERROR_MESSAGES.CERTIFICATE_REVOKE_FAILED);
    });

    it('400 INVALID_REVOCATION_REQUEST: message is Thai cause + next action, not the code', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(400, {
            success: false,
            error: 'INVALID_REVOCATION_REQUEST',
            message: BACKEND_INVALID_REQUEST_TH,
        }));

        const out = await AdminService.revokeCertificate(CERT_ID, REASON);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('INVALID_REVOCATION_REQUEST');
        expectThaiCauseAndAction(out.message, 'INVALID_REVOCATION_REQUEST');
        expect(out.message).toBe(REVOKE_ERROR_MESSAGES.INVALID_REVOCATION_REQUEST);
    });

    it('network failure (fetch rejects): code REQUEST_FAILED, message is Thai and does not claim the revoke failed for certain', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

        const out = await AdminService.revokeCertificate(CERT_ID, REASON);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('REQUEST_FAILED');
        expectThaiCauseAndAction(out.message, 'REQUEST_FAILED');
        expect(out.message).toBe(REVOKE_ERROR_MESSAGES.REQUEST_FAILED);
    });

    it('timeout (AbortError): code REQUEST_FAILED, message is Thai, no English client text', async () => {
        const abort = new Error('The operation was aborted');
        abort.name = 'AbortError';
        fetchMock.mockRejectedValueOnce(abort);

        const out = await AdminService.revokeCertificate(CERT_ID, REASON);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('REQUEST_FAILED');
        expectThaiCauseAndAction(out.message, 'REQUEST_FAILED');
    });

    it('502 with a non-JSON body (gateway page): code HTTP_502, message is the Thai server-error copy', async () => {
        fetchMock.mockResolvedValueOnce(htmlResponse(502, '<html><body>Bad Gateway</body></html>'));

        const out = await AdminService.revokeCertificate(CERT_ID, REASON);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('HTTP_502');
        expectThaiCauseAndAction(out.message, 'HTTP_502');
        expect(out.message).not.toMatch(/Bad Gateway/i);
        expect(out.message).toBe(REVOKE_ERROR_MESSAGES.CERTIFICATE_REVOKE_FAILED);
    });

    it('an unknown code the client echoes verbatim still gets Thai copy, never the code', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(422, {
            success: false,
            error: 'SOME_FUTURE_CODE',
            message: 'ข้อความจากเซิร์ฟเวอร์',
        }));

        const out = await AdminService.revokeCertificate(CERT_ID, REASON);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('SOME_FUTURE_CODE');
        expectThaiCauseAndAction(out.message, 'SOME_FUTURE_CODE');
    });
});
