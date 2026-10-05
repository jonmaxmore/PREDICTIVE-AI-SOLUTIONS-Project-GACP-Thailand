/**
 * AdminService.previewCertificateRevision / reviseCertificateLocation —
 * Thai copy for CERTIFICATE_PLANT_UNKNOWN.
 *
 * Drives the REAL service through the REAL apiClient with only `fetch`
 * mocked, because the defect lives in the seam between them: the door
 * answers `{ error: <code>, message: <Thai> }`, apiClient takes `error`
 * (the machine code) as the display text and drops the body's `message`,
 * so the service's own vocabulary is the ONLY place Thai copy can come
 * from. A code missing from that vocabulary falls through to the generic
 * "refresh and retry" line, which tells the admin to retry something that
 * only editing the application's plant can fix.
 *
 * Both the preview and the press are asserted: the door refuses on the
 * same code from both (services/certificate-service.js _resolveRevisionTarget).
 */

import { AdminService } from '../admin-service';

const THAI = /[฀-๿]/;
const CERT_ID = 'cert-1';
const REASON = 'แก้ไขข้อมูลที่ตั้งตามบันทึกฟาร์ม';
const PREVIEW_URL = '/api/admin/certificates/cert-1/revise-location/preview';
const REVISE_URL = '/api/admin/certificates/cert-1/revise-location';

// The catalog row's messageTh (apps/backend/shared/error-codes.js
// CERTIFICATE_PLANT_UNKNOWN), exactly as routes/api/admin/certificates.js
// catalogued() emits it. apiClient discards it when `error` is present.
const BACKEND_PLANT_UNKNOWN_TH = 'ไม่สามารถออกใบรับรองได้ เนื่องจากชนิดพืชในคำขอไม่อยู่ในทะเบียนชนิดพืชของระบบ หรือคำขอไม่ได้ระบุชนิดพืช ระบบไม่ได้บันทึกการเปลี่ยนแปลงใด ๆ กรุณาเลือกชนิดพืชในคำขอจากรายการที่ระบบกำหนด แล้วบันทึกผลการตรวจอีกครั้ง';

// The service's generic revise fallback: acceptable for a code nobody
// knows, wrong for this one because retrying cannot fix the plant.
const GENERIC_RETRY_FRAGMENT = 'รีเฟรชหน้าจอเพื่อดูสถานะใบรับรอง';

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

function plantUnknownDoorBody(): unknown {
    return {
        success: false,
        error: 'CERTIFICATE_PLANT_UNKNOWN',
        message: BACKEND_PLANT_UNKNOWN_TH,
        plantReference: 'durian',
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

function expectPlantRegisterCauseAndAction(message: string): void {
    expect(message).toMatch(THAI);
    expect(message).not.toContain('CERTIFICATE_PLANT_UNKNOWN');
    expect(message).not.toMatch(/Unable to connect|Request timeout|Please try again/i);
    // Cause: the application's plant is not one the plant register knows.
    expect(message).toContain('ชนิดพืช');
    expect(message).toContain('ทะเบียนพืช');
    // Next action: edit the application, then reopen the dialog.
    expect(message).toContain('แก้ไขคำขอ');
    expect(message).toContain('เปิดหน้าต่างนี้อีกครั้ง');
    // Never the generic retry line.
    expect(message).not.toContain(GENERIC_RETRY_FRAGMENT);
}

describe('AdminService revision doors — 422 CERTIFICATE_PLANT_UNKNOWN renders the plant-register copy', () => {
    it('preview: error is the code, message names the plant register and editing the application', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(422, plantUnknownDoorBody()));

        const out = await AdminService.previewCertificateRevision(CERT_ID);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(PREVIEW_URL);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('CERTIFICATE_PLANT_UNKNOWN');
        expectPlantRegisterCauseAndAction(out.message);
    });

    it('press: error is the code, message names the plant register and editing the application', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(422, plantUnknownDoorBody()));

        const out = await AdminService.reviseCertificateLocation(CERT_ID, REASON);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(REVISE_URL);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.error).toBe('CERTIFICATE_PLANT_UNKNOWN');
        expectPlantRegisterCauseAndAction(out.message);
    });

    it('preview and press share ONE copy for the code (no drift between the two doors)', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse(422, plantUnknownDoorBody()))
            .mockResolvedValueOnce(jsonResponse(422, plantUnknownDoorBody()));

        const preview = await AdminService.previewCertificateRevision(CERT_ID);
        const press = await AdminService.reviseCertificateLocation(CERT_ID, REASON);

        expect(preview.ok).toBe(false);
        expect(press.ok).toBe(false);
        if (preview.ok || press.ok) return;
        expect(press.message).toBe(preview.message);
    });
});
