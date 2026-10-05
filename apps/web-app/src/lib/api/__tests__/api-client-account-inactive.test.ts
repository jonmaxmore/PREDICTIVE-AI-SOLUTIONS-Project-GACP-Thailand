/**
 * บัญชีที่ถูกระงับ ต้องหลุดออกจากระบบ และต้องได้รู้ว่าเพราะอะไร
 *
 * wave 1 (SECU-03) ทำให้หลังบ้านตอบ ACCOUNT_INACTIVE ทุกประตูเมื่อบัญชีถูกระงับหรือถูกลบ:
 *   - authenticate* ทุกตัว     → 403 { error:'Forbidden', message:'<ไทย> / <อังกฤษ>', code }
 *   - POST /auth/health/refresh → 403 sendErrorResponse (มี messageTh)
 *   - GET  /auth/provider/me    → 401 { code, error, message, messageTh }
 *   - ประตูล็อกอินทั้งสอง       → 403 sendErrorResponse (มี messageTh)
 *
 * แต่ api-client เห็น 403 เป็น "ไม่มีสิทธิ์" ทั่วไป: เก็บ session ไว้ บอกผู้ใช้ให้ "เข้าสู่ระบบใหม่
 * หรือติดต่อเจ้าหน้าที่" แล้วปล่อยให้คนที่ถูกระงับนั่งกดหน้าจอที่พังทุกปุ่มต่อไป ส่วน 401 ของ
 * /provider/me บอกว่า "Session expired" ซึ่งไม่จริง
 *
 * ไฟล์นี้วางหน้าปัจจุบันไว้ที่หน้าล็อกอิน (api-client ไม่พาไปไหนเมื่ออยู่หน้าล็อกอินแล้ว) เพื่อดู
 * เฉพาะผลต่อ session และข้อความ — หน้าที่ต้องพาไป ตรวจใน account-inactive-login-redirect.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../api-client';
import { AuthService } from '../../services/auth-service';

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

/** สิ่งที่ผู้ใช้ต้องได้อ่าน: บัญชีถูกระงับ และให้ติดต่อเจ้าหน้าที่กรมฯ — ไม่มีคำสัญญาว่าจะกู้คืนได้ */
const SUSPENDED = /ถูกระงับการใช้งาน/;
const CONTACT_DTAM = /ติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก/;
const NO_RECOVERY_PROMISE = /กู้|คืนสิทธิ์|เปิดใช้งานอีกครั้ง|ปลดระงับ/;
const GENERIC_403 = 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาเข้าสู่ระบบใหม่หรือติดต่อเจ้าหน้าที่';

/** auth-middleware.js rejectInactiveAccount — ไม่มี messageTh */
const MIDDLEWARE_BODY = {
    success: false,
    error: 'Forbidden',
    message: 'บัญชีถูกระงับการใช้งาน / Account is inactive',
    code: 'ACCOUNT_INACTIVE',
};

/** sendErrorResponse ของ /refresh และประตูล็อกอิน — มี messageTh จาก catalog */
const BACKEND_MESSAGE_TH = 'บัญชีของคุณถูกระงับการใช้งาน หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (จากหลังบ้าน)';
const CATALOG_BODY = {
    success: false,
    code: 'ACCOUNT_INACTIVE',
    error: 'Account is inactive',
    message: 'Account is inactive',
    messageTh: BACKEND_MESSAGE_TH,
};

/** auth-provider.js GET /me — 401 พร้อมประโยคจาก catalog (รีวิวรอบแรก: เดิมเป็นประโยคของตัวเอง ไม่มี messageTh) */
const PROVIDER_ME_BODY = {
    success: false,
    code: 'ACCOUNT_INACTIVE',
    error: 'Account is inactive',
    message: 'บัญชีของคุณถูกระงับการใช้งาน หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก / Account is inactive',
    messageTh: 'บัญชีของคุณถูกระงับการใช้งาน หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
};

describe('ACCOUNT_INACTIVE จาก API ใด ๆ ปิด session', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;
    let clearSession: jest.SpiedFunction<typeof AuthService.clearSession>;
    let emit: jest.SpiedFunction<typeof AuthService.emit>;

    beforeEach(() => {
        window.history.pushState({}, '', '/auth/health/login');
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
        clearSession = jest.spyOn(AuthService, 'clearSession').mockImplementation(() => {});
        emit = jest.spyOn(AuthService, 'emit').mockImplementation(() => {});
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        clearSession.mockRestore();
        emit.mockRestore();
        window.history.pushState({}, '', '/');
    });

    it('403 จากตัวกลางตรวจ token: ล้าง session แบบเดียวกับ refresh ที่ถูกปฏิเสธ', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, MIDDLEWARE_BODY));

        await client.get('/api/applications/my');

        expect(clearSession).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('session_expired');
    });

    it('403 จากตัวกลาง: บอกว่าบัญชีถูกระงับ ให้ติดต่อเจ้าหน้าที่กรมฯ ไม่ใช่ข้อความ 403 ทั่วไป', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, MIDDLEWARE_BODY));

        const res = await client.get('/api/applications/my');

        expect(res.success).toBe(false);
        expect(res.status).toBe(403);
        expect(res.code).toBe('ACCOUNT_INACTIVE');
        expect(res.error).not.toBe(GENERIC_403);
        expect(res.error).toMatch(SUSPENDED);
        expect(res.error).toMatch(CONTACT_DTAM);
        expect(res.error).not.toMatch(NO_RECOVERY_PROMISE);
    });

    it('เมื่อหลังบ้านส่ง messageTh มา ใช้ประโยคของหลังบ้าน', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, CATALOG_BODY));

        const res = await client.post('/api/applications/draft', { a: 1 });

        expect(res.error).toBe(BACKEND_MESSAGE_TH);
        expect(clearSession).toHaveBeenCalledTimes(1);
    });

    it('401 ACCOUNT_INACTIVE (GET /auth/provider/me) ก็ปิด session และไม่อ้างว่า "หมดอายุ"', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, PROVIDER_ME_BODY));

        const res = await client.get('/api/auth/provider/me');

        expect(clearSession).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('session_expired');
        expect(res.code).toBe('ACCOUNT_INACTIVE');
        expect(res.status).toBe(401);
        expect(res.error).not.toMatch(/expired/i);
        expect(res.error).toMatch(SUSPENDED);
        expect(res.error).toMatch(CONTACT_DTAM);
    });

    it('คำขอที่ปิดการเด้งออกของ 401 ไว้ ก็ยังปิด session — บัญชีถูกระงับ ไม่ใช่ประตูนี้ไม่ให้เข้า', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, PROVIDER_ME_BODY));

        const res = await client.get('/api/finance/credit-notes', { suppressAuthRedirect: true });

        expect(clearSession).toHaveBeenCalledTimes(1);
        expect(res.code).toBe('ACCOUNT_INACTIVE');
    });
});

describe('ACCOUNT_INACTIVE จากประตูล็อกอิน', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;
    let clearSession: jest.SpiedFunction<typeof AuthService.clearSession>;

    beforeEach(() => {
        window.history.pushState({}, '', '/auth/provider/login');
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
        clearSession = jest.spyOn(AuthService, 'clearSession').mockImplementation(() => {});
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        clearSession.mockRestore();
        window.history.pushState({}, '', '/');
    });

    it.each([
        '/auth/health/login',
        '/auth/provider/login',
    ])('%s: คืน messageTh ของหลังบ้าน แทนข้อความ 403 ทั่วไป', async (endpoint) => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, CATALOG_BODY));

        const res = await client.post(endpoint, { password: 'x' });

        expect(res.success).toBe(false);
        expect(res.code).toBe('ACCOUNT_INACTIVE');
        expect(res.error).toBe(BACKEND_MESSAGE_TH);
    });

    it('ไม่ยุ่งกับ session ที่มีอยู่ — คนที่ล็อกอินไม่ผ่าน ไม่ได้เป็นเจ้าของ session นั้น', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, CATALOG_BODY));

        await client.post('/auth/health/login', { password: 'x' });

        expect(clearSession).not.toHaveBeenCalled();
    });
});

describe('ตัวควบคุม: 403 อื่นยังเป็นแบบเดิม', () => {
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

    it('403 Forbidden ธรรมดา ไม่ปิด session และยังใช้ข้อความ 403 เดิม', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, { success: false, error: 'Forbidden', code: 'FORBIDDEN' }));

        const res = await client.get('/api/provider/applications');

        expect(clearSession).not.toHaveBeenCalled();
        expect(res.error).toBe(GENERIC_403);
    });

    it('ข้อความที่แค่มีคำว่า ACCOUNT_INACTIVE แต่ code เป็นอย่างอื่น ไม่นับ', async () => {
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, { success: false, error: 'ACCOUNT_INACTIVE_REVIEWER', code: 'REVIEWER_INACTIVE' }));

        await client.get('/api/provider/applications');

        expect(clearSession).not.toHaveBeenCalled();
    });
});
