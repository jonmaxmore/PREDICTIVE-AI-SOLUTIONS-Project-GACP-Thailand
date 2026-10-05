/**
 * คำขอที่ตั้งใจไม่ส่งโทเคน จะ "หมดอายุ" ไม่ได้
 *
 * วัดจริงบนเครื่อง (2026-09-07): ผู้ใช้ที่ล็อกอินอยู่ นั่งอยู่หน้า /health/home แล้วเปิดหน้า
 * สาธารณะ /verify กดปุ่ม "โหลดทะเบียน" →
 *     401 GET /api/interoperability/v1/trust/registry   (ประตูนี้ต้องมี partner key)
 *     200 POST /api/session/clear-cookie                 ← ระบบล้าง session ให้เอง
 *     เด้งไป /auth/health/login?expired=true             ← ถูกเตะออกจากระบบ
 * คือกดปุ่มบนหน้าสาธารณะ แล้วหลุดจากบัญชีตัวเอง
 *
 * ต้นเหตุอยู่ที่ความหมายของสองสวิตช์ที่ควรเป็นเรื่องเดียวกันแต่แยกกันอยู่:
 *   skipAuth              = "อย่าแนบโทเคนของฉันไปกับคำขอนี้"
 *   suppressAuthRedirect  = "401 ของคำขอนี้ ไม่ใช่ session ฉันหมดอายุ"
 * คำขอที่ไม่ได้ส่งข้อมูลยืนยันตัวตนไปเลย จะได้ 401 กลับมาเสมอ และ 401 นั้นแปลว่า
 * "ประตูนี้ต้องมีกุญแจ" ไม่เคยแปลว่า "กุญแจของคุณหมดอายุ" — จึงเป็นไปไม่ได้ที่ผู้เรียก
 * จะตั้ง skipAuth แล้วต้องการพฤติกรรมเตะออกจากระบบ
 *
 * แก้ที่ต้นทางแทนที่จะไล่เติม suppressAuthRedirect ทีละจุดเรียก เพราะจุดเรียกถัดไปที่ลืม
 * จะพาบั๊กเดิมกลับมา — คลาสเดียวกับ guards-match-shape-not-declaration
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../api-client';
import { AuthService } from '../../services/auth-service';

// A real page unloads after its one sign-out navigation; the singleton here does
// not, so its "already leaving" state must not leak from one test into the next.
beforeEach(() => {
    AuthService.__resetSignOutStateForTests();
});

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

const PARTNER_KEY_REFUSAL = {
    success: false,
    error: 'Partner API key required',
    code: 'PARTNER_KEY_MISSING',
};

describe('401 ของคำขอที่ไม่ได้ส่งโทเคน', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;
    let clearSession: jest.SpiedFunction<typeof AuthService.clearSession>;

    beforeEach(() => {
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
        clearSession = jest.spyOn(AuthService, 'clearSession').mockImplementation(() => {});
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        clearSession.mockRestore();
    });

    it('ไม่ล้าง session ของผู้ใช้', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, PARTNER_KEY_REFUSAL));

        await client.get('/api/interoperability/v1/trust/registry?limit=10', { skipAuth: true });

        expect(clearSession).not.toHaveBeenCalled();
    });

    it('คืนคำปฏิเสธให้ผู้เรียกอ่านเอง พร้อมรหัสจริงของประตู', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, PARTNER_KEY_REFUSAL));

        const res = await client.get('/api/interoperability/v1/trust/registry?limit=10', { skipAuth: true });

        expect(res.success).toBe(false);
        expect(res.code).toBe('PARTNER_KEY_MISSING');
        expect(res.error).toBeTruthy();
    });

    it('คำขอปกติที่ส่งโทเคนไป ยังถือว่า 401 คือ session หมดอายุเหมือนเดิม', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, { success: false, error: 'Unauthorized' }));

        await client.get('/api/applications/my');

        expect(clearSession).toHaveBeenCalled();
    });

    it('ผู้เรียกยังสั่งทับได้ ถ้าจะให้ 401 หมายถึงหมดอายุจริง ๆ แม้ไม่ส่งโทเคน', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, { success: false, error: 'Unauthorized' }));

        await client.get('/api/applications/my', { skipAuth: true, suppressAuthRedirect: false });

        expect(clearSession).toHaveBeenCalled();
    });
});
