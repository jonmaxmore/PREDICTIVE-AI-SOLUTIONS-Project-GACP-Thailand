/**
 * บัญชีที่ถูกระงับ ถูกพาไปหน้าล็อกอินของพอร์ทัลตัวเอง พร้อมเหตุผล
 *
 * ต่อจาก api-client-account-inactive.test.ts: เมื่อ API ตอบ ACCOUNT_INACTIVE และผู้ใช้ยังอยู่ใน
 * หน้าภายใน ต้องไปหน้าล็อกอินของพอร์ทัลที่ถูก (เจ้าหน้าที่ /provider และ /admin → หน้าเจ้าหน้าที่,
 * ที่เหลือ → หน้าประชาชน) พร้อม ?reason=account_inactive ให้หน้าล็อกอินบอกเหตุผล
 * ไม่ใช่ ?expired=true ซึ่งแปลว่า "หมดเวลา" และไม่จริง
 *
 * รีวิวรอบแรก (2026-09-17): เทสเดิมจำลอง clearSession ทิ้ง จึงไม่เห็นว่าการเปลี่ยนหน้าเกิดขึ้น
 * ก่อน POST /api/session/clear-cookie ตอบ — provider_token เป็น httpOnly ลบได้ทางนั้นทางเดียว
 * cookie จึงติดไปกับการเปลี่ยนหน้า (หรือคำขอลบถูกยกเลิก) แล้ว middleware ส่งเจ้าหน้าที่กลับ
 * แดชบอร์ด ชุด "ออกจากหน้าหลัง cookie ฝั่งเซิร์ฟเวอร์ถูกลบ" ด้านล่างใช้ clearSession ตัวจริง
 * และถือคำตอบของ clear-cookie ไว้เอง เพื่อดูว่าเว็บรอก่อนออกจากหน้า และตั้ง marker ที่
 * middleware ใช้ลบ cookie ให้ในกรณีที่รอไม่ได้ (inactive-account-sign-out-landing.test.ts)
 *
 * jsdom นำทางข้ามหน้าไม่ได้ จึงตรวจที่ hardNavigate — จุดเดียวที่เว็บใช้เปลี่ยนหน้าในสายนี้
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockHardNavigate = jest.fn<(url: string) => void>();
jest.mock('@/lib/navigation/hard-navigate', () => ({
    hardNavigate: (url: string) => mockHardNavigate(url),
}));

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

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** ให้ promise ที่ค้างอยู่ทำงานจนสุด (ใช้กับนาฬิกาจริง) */
async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

const realFetch = globalThis.fetch;
type FetchMock = jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;

const INACTIVE_403 = { success: false, error: 'Forbidden', message: 'บัญชีถูกระงับการใช้งาน / Account is inactive', code: 'ACCOUNT_INACTIVE' };
const INACTIVE_401 = { success: false, code: 'ACCOUNT_INACTIVE', error: 'Account is inactive', message: 'Account inactive' };
/** A marker this client set: the reason plus the id of that sign-out. */
const MARKER = /(?:^|; )signed_out_reason=account_inactive\.[0-9a-f]{16}(?:;|$)/;

function clearMarker(): void {
    document.cookie = 'signed_out_reason=; path=/; max-age=0';
}

describe('ACCOUNT_INACTIVE พาไปหน้าล็อกอินของพอร์ทัลที่ถูก', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;
    let clearSession: jest.SpiedFunction<typeof AuthService.clearSession>;

    beforeEach(() => {
        mockHardNavigate.mockReset();
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
        clearSession = jest.spyOn(AuthService, 'clearSession').mockImplementation(() => {});
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        clearSession.mockRestore();
        clearMarker();
        window.history.pushState({}, '', '/');
    });

    it.each([
        ['/health/home', '/auth/health/login?reason=account_inactive'],
        ['/health/applications/new/step/3', '/auth/health/login?reason=account_inactive'],
        ['/provider/applications', '/auth/provider/login?reason=account_inactive'],
        ['/admin/users', '/auth/provider/login?reason=account_inactive'],
    ])('จาก %s → %s', async (from, to) => {
        window.history.pushState({}, '', from);
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, INACTIVE_403));

        await client.get('/api/anything');
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).toHaveBeenCalledWith(to);
        // ล้าง session ก่อนออกจากหน้า — หน้าใหม่ต้องไม่เห็น session เดิม
        expect(clearSession.mock.invocationCallOrder[0])
            .toBeLessThan(mockHardNavigate.mock.invocationCallOrder[0]);
    });

    it('401 ACCOUNT_INACTIVE ไปพร้อมเหตุผลเดียวกัน ไม่ใช่ ?expired=true', async () => {
        window.history.pushState({}, '', '/provider/dashboard');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, INACTIVE_401));

        await client.get('/api/auth/provider/me');
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/provider/login?reason=account_inactive');
    });

    it('อยู่หน้าล็อกอินแล้ว ไม่พาไปซ้ำ และไม่ตั้ง marker', async () => {
        window.history.pushState({}, '', '/auth/provider/login');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, INACTIVE_403));

        await client.get('/api/anything');
        await settle();

        expect(mockHardNavigate).not.toHaveBeenCalled();
        expect(document.cookie).not.toMatch(MARKER);
    });

    it('ประตูล็อกอินตอบ ACCOUNT_INACTIVE: อยู่หน้าเดิม ให้ฟอร์มแสดงข้อความ', async () => {
        window.history.pushState({}, '', '/health/home');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, { ...INACTIVE_403, messageTh: 'บัญชีของคุณถูกระงับการใช้งาน' }));

        await client.post('/auth/health/login', { password: 'x' });
        await settle();

        expect(mockHardNavigate).not.toHaveBeenCalled();
        expect(document.cookie).not.toMatch(MARKER);
    });

    it('403 อื่นไม่พาไปไหน', async () => {
        window.history.pushState({}, '', '/provider/applications');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, { success: false, error: 'Forbidden', code: 'FORBIDDEN' }));

        await client.get('/api/anything');
        await settle();

        expect(mockHardNavigate).not.toHaveBeenCalled();
    });
});

describe('ออกจากหน้าหลัง cookie ฝั่งเซิร์ฟเวอร์ถูกลบ (clearSession ตัวจริง)', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;
    let clearCookie: ReturnType<typeof deferred<Response>>;
    let cookieWhenLeaving: string | null;

    /** API ตอบ `api`; POST /api/session/clear-cookie ตอบเมื่อเทสสั่ง */
    function serve(api: Response): void {
        fetchMock.mockImplementation(async (input) => (
            String(input).includes('/api/session/clear-cookie') ? clearCookie.promise : api
        ));
    }

    function clearCookieRequests(): number {
        return fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/session/clear-cookie')).length;
    }

    beforeEach(() => {
        mockHardNavigate.mockReset();
        cookieWhenLeaving = null;
        mockHardNavigate.mockImplementation(() => { cookieWhenLeaving = document.cookie; });
        client = new ApiClient();
        clearCookie = deferred<Response>();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(async () => {
        // ไม่ทิ้งคำขอ clear-cookie ที่ค้างไว้ให้เทสถัดไปต้องรอ
        clearCookie.resolve(mockJsonResponse(200, { success: true }));
        await Promise.resolve();
        jest.useRealTimers();
        await settle();
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        clearMarker();
        window.history.pushState({}, '', '/');
    });

    it('หลายคำขอตอบ ACCOUNT_INACTIVE พร้อมกัน → ออกจากระบบครั้งเดียว: clear-cookie หนึ่งครั้ง เปลี่ยนหน้าหนึ่งครั้ง', async () => {
        window.history.pushState({}, '', '/provider/dashboard');
        serve(mockJsonResponse(403, INACTIVE_403));

        const answers = await Promise.all([
            client.get('/api/provider/applications'),
            client.get('/api/notifications/unread-count'),
            client.get('/api/auth/provider/me'),
        ]);
        clearCookie.resolve(mockJsonResponse(200, { success: true }));
        await settle();

        expect(answers.map((a) => a.code)).toEqual(['ACCOUNT_INACTIVE', 'ACCOUNT_INACTIVE', 'ACCOUNT_INACTIVE']);
        expect(clearCookieRequests()).toBe(1);
        expect(mockHardNavigate).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/provider/login?reason=account_inactive');
    });

    it('เจ้าหน้าที่: ยังไม่ออกจากหน้าจนกว่า clear-cookie จะตอบ แล้วจึงไปหน้าล็อกอินพร้อมเหตุผล', async () => {
        window.history.pushState({}, '', '/provider/dashboard');
        serve(mockJsonResponse(403, INACTIVE_403));

        const res = await client.get('/api/provider/applications');
        await settle();

        // ผู้เรียกได้คำตอบทันที ไม่ต้องรอการออกจากหน้า
        expect(res.code).toBe('ACCOUNT_INACTIVE');
        expect(clearCookieRequests()).toBe(1);
        expect(mockHardNavigate).not.toHaveBeenCalled();

        clearCookie.resolve(mockJsonResponse(200, { success: true }));
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/provider/login?reason=account_inactive');
    });

    it('ตั้ง marker ก่อนออกจากหน้า — middleware ใช้มันลบ cookie ที่ค้างและปล่อยให้ถึงหน้าที่บอกเหตุผล', async () => {
        window.history.pushState({}, '', '/provider/dashboard');
        serve(mockJsonResponse(403, INACTIVE_403));

        await client.get('/api/provider/applications');
        clearCookie.resolve(mockJsonResponse(200, { success: true }));
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledTimes(1);
        expect(cookieWhenLeaving).toMatch(MARKER);
    });

    it('clear-cookie ล้มเหลว → ยังออกไปหน้าล็อกอินพร้อม marker (middleware ลบ cookie แทน)', async () => {
        window.history.pushState({}, '', '/health/home');
        serve(mockJsonResponse(403, INACTIVE_403));

        await client.get('/api/applications/my');
        clearCookie.reject(new TypeError('Failed to fetch'));
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/health/login?reason=account_inactive');
        expect(cookieWhenLeaving).toMatch(MARKER);
    });

    it('clear-cookie ไม่ตอบเลย → รอไม่เกิน 3 วินาทีแล้วออกไปพร้อม marker', async () => {
        jest.useFakeTimers();
        window.history.pushState({}, '', '/provider/dashboard');
        serve(mockJsonResponse(403, INACTIVE_403));

        await client.get('/api/provider/applications');
        await jest.advanceTimersByTimeAsync(2_900);
        expect(mockHardNavigate).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(200);
        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/provider/login?reason=account_inactive');
        expect(cookieWhenLeaving).toMatch(MARKER);
    });

    it('refresh ที่ถูกปฏิเสธเพราะบัญชีถูกระงับ ก็รอ clear-cookie ก่อนออกจากหน้า', async () => {
        window.history.pushState({}, '', '/health/home');
        serve(mockJsonResponse(403, { success: false, code: 'ACCOUNT_INACTIVE', messageTh: 'บัญชีของคุณถูกระงับการใช้งาน' }));

        const renewed = await AuthService.refreshToken();
        await settle();

        expect(renewed).toBe(false);
        expect(clearCookieRequests()).toBe(1);
        expect(mockHardNavigate).not.toHaveBeenCalled();

        clearCookie.resolve(mockJsonResponse(200, { success: true }));
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/health/login?reason=account_inactive');
        expect(cookieWhenLeaving).toMatch(MARKER);
    });

    // 401 "หมดเวลา" มีปัญหาเดียวกัน (รีวิว: cookie เดิมพาเจ้าหน้าที่เด้งกลับแดชบอร์ด) และเดิมส่ง
    // หน้า /admin ไปหน้าล็อกอินประชาชน
    it.each([
        ['/provider/dashboard', '/auth/provider/login?expired=true'],
        ['/admin/users', '/auth/provider/login?expired=true'],
        ['/health/home', '/auth/health/login?expired=true'],
    ])('401 หมดเวลา จาก %s: รอ clear-cookie แล้วไป %s โดยไม่ตั้ง marker', async (from, to) => {
        window.history.pushState({}, '', from);
        serve(mockJsonResponse(401, { success: false, code: 'TOKEN_EXPIRED', error: 'Token expired' }));

        const res = await client.get('/api/anything');
        await settle();

        expect(res.success).toBe(false);
        expect(clearCookieRequests()).toBe(1);
        expect(mockHardNavigate).not.toHaveBeenCalled();

        clearCookie.resolve(mockJsonResponse(200, { success: true }));
        await settle();

        expect(mockHardNavigate).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).toHaveBeenCalledWith(to);
        expect(cookieWhenLeaving).not.toMatch(MARKER);
    });
});

describe('refresh ที่ถูกปฏิเสธเพราะบัญชีถูกระงับ ก็พาไปพร้อมเหตุผลเดียวกัน', () => {
    let fetchMock: FetchMock;
    let clearSession: jest.SpiedFunction<typeof AuthService.clearSession>;

    beforeEach(() => {
        mockHardNavigate.mockReset();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
        clearSession = jest.spyOn(AuthService, 'clearSession').mockImplementation(() => {});
    });

    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
        clearSession.mockRestore();
        clearMarker();
        window.history.pushState({}, '', '/');
    });

    const REFRESH_REFUSAL = {
        success: false,
        code: 'ACCOUNT_INACTIVE',
        error: 'Account is inactive',
        message: 'Account is inactive',
        messageTh: 'บัญชีของคุณถูกระงับการใช้งาน',
    };

    it('POST /auth/health/refresh ตอบ 403 ACCOUNT_INACTIVE → ล้าง session แล้วไปหน้าล็อกอินพร้อมเหตุผล', async () => {
        window.history.pushState({}, '', '/health/home');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(403, REFRESH_REFUSAL));

        const renewed = await AuthService.refreshToken();
        await settle();

        expect(renewed).toBe(false);
        expect(clearSession).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/health/login?reason=account_inactive');
    });

    it('refresh ที่ถูกปฏิเสธด้วยเหตุอื่น ยังเป็นแบบเดิม: ล้าง session ไม่พาไปไหน ไม่ตั้ง marker', async () => {
        window.history.pushState({}, '', '/health/home');
        fetchMock.mockResolvedValueOnce(mockJsonResponse(401, { success: false, code: 'REFRESH_TOKEN_REVOKED' }));

        await AuthService.refreshToken();
        await settle();

        expect(clearSession).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).not.toHaveBeenCalled();
        expect(document.cookie).not.toMatch(MARKER);
    });
});
