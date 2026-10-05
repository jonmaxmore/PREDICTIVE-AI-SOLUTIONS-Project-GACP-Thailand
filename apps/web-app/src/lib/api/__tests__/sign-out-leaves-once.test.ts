/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://demo.gacpth.com/provider/dashboard"}
 *
 * การพาออกจากระบบเกิดครั้งเดียว และการพาออกเพราะบัญชีถูกระงับชนะเสมอ
 *
 * รีวิวรอบสองของ wave1/honest-limits (445e4b72, 2026-09-17) วัดได้ว่า เมื่อเว็บเริ่มพาเจ้าหน้าที่ที่ถูกระงับ
 * ไปหน้าล็อกอินแล้ว คำขอถัดไปที่ตอบ 401 TOKEN_MISSING (ซึ่ง backend ตอบเมื่อ cookie ถูกลบแล้ว) เริ่มการพาออก
 * รอบที่สองไป `?expired=true` — browser ใช้การนำทางครั้งหลัง ผู้ใช้จึงเห็น "หมดเวลา" ไม่เห็นเหตุผลจริง
 * และ 401 พร้อมกัน N ครั้งทำให้ยิง clear-cookie N ครั้งและนำทาง N ครั้ง
 *
 * ไฟล์นี้ยังตรวจว่า marker บน https ใช้ชื่อ `__Host-` (ดู inactive-sign-out-marker-hardening.test.ts)
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockHardNavigate = jest.fn<(url: string) => void>();
jest.mock('@/lib/navigation/hard-navigate', () => ({
    hardNavigate: (url: string) => mockHardNavigate(url),
}));

import { AuthService } from '../../services/auth-service';
import { consumeAccountInactiveSignOut, markAccountInactiveSignOut } from '../account-inactive';

type FetchMock = jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;
const realFetch = globalThis.fetch;

/** jsdom has no global Response; clear-cookie's answer is only awaited, never read. */
function okResponse(): Response {
    return { ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function clearCookieCalls(fetchMock: FetchMock): number {
    return fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/session/clear-cookie')).length;
}

function params(query: string) {
    return new URLSearchParams(query);
}

function clearMarkers(): void {
    document.cookie = '__Host-signed_out_reason=; path=/; max-age=0; secure';
}

function cookieNames(): string[] {
    return document.cookie.split(';').map((part) => part.trim().split('=')[0]).filter(Boolean);
}

beforeEach(() => {
    mockHardNavigate.mockReset();
    // singleton ตัวเดียวทั้งไฟล์: สถานะ "กำลังออก" ต้องถูกล้างระหว่างเทส (hook มีเฉพาะหลังแก้)
    (AuthService as unknown as { __resetSignOutStateForTests?: () => void }).__resetSignOutStateForTests?.();
    for (const name of cookieNames()) {
        document.cookie = `${name}=; path=/; max-age=0; secure`;
    }
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('marker บน https', () => {
    it('ตั้งเป็น __Host-signed_out_reason ไม่ใช่ชื่อธรรมดา', () => {
        markAccountInactiveSignOut();

        expect(cookieNames()).toContain('__Host-signed_out_reason');
        expect(cookieNames()).not.toContain('signed_out_reason');
    });

    it('หน้าล็อกอินรับเฉพาะชื่อ __Host- และลบทิ้งหลังอ่าน', () => {
        markAccountInactiveSignOut();
        expect(cookieNames()).toContain('__Host-signed_out_reason');

        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(true);
        expect(cookieNames()).not.toContain('__Host-signed_out_reason');
    });

    it('ชื่อธรรมดาที่ใครตั้งไว้ ไม่ทำให้หน้าล็อกอินขึ้นข้อความว่าบัญชีถูกระงับ', () => {
        document.cookie = 'signed_out_reason=account_inactive.0123456789abcdef; path=/';

        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(false);
    });
});

describe('ค่าของ marker (รีวิวรอบแปด)', () => {
    it('ค่า account_inactive ที่ไม่มี id ไม่นับ — ไม่มีหน้าเวอร์ชันไหนตั้งค่านี้ (main ไม่เคยมี marker)', () => {
        document.cookie = '__Host-signed_out_reason=account_inactive; path=/; max-age=120; samesite=lax; secure';

        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(false);
    });

    it('ค่าที่ถูก percent-encode อ่านเหมือนที่ middleware อ่าน (middleware decode ค่า cookie)', () => {
        document.cookie = '__Host-signed_out_reason=account_inactive%2E0123456789abcdef; path=/; max-age=120; samesite=lax; secure';

        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(true);
        expect(cookieNames()).not.toContain('__Host-signed_out_reason');
    });

    it('crypto.getRandomValues ใช้ไม่ได้ — ยังตั้ง marker และยังพาออกไปหน้าที่บอกเหตุผล', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const cryptoSpy = jest.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
            throw new Error('getRandomValues blocked');
        });
        try {
            await AuthService.endInactiveAccountSession();
            await settle();
        } finally {
            cryptoSpy.mockRestore();
        }

        expect(mockHardNavigate.mock.calls.map(([url]) => url)).toEqual([
            '/auth/provider/login?reason=account_inactive',
        ]);
        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(true);
    });
});

describe('พาออกครั้งเดียว', () => {
    it('หลังเริ่มพาออกเพราะถูกระงับ 401 ที่ตามมาไม่พาไป ?expired=true', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endInactiveAccountSession();
        await AuthService.endExpiredSession();
        await settle();

        expect(mockHardNavigate.mock.calls.map(([url]) => url)).toEqual([
            '/auth/provider/login?reason=account_inactive',
        ]);
    });

    it('401 ที่มาก่อน แล้วตามด้วย ACCOUNT_INACTIVE ระหว่างรอ — ปลายทางคือหน้าที่บอกเหตุผล ครั้งเดียว', async () => {
        const clear = deferred<Response>();
        const fetchMock: FetchMock = jest.fn(() => clear.promise);
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const expired = AuthService.endExpiredSession();
        const inactive = AuthService.endInactiveAccountSession();
        clear.resolve(okResponse());
        await Promise.all([expired, inactive]);
        await settle();

        expect(mockHardNavigate.mock.calls.map(([url]) => url)).toEqual([
            '/auth/provider/login?reason=account_inactive',
        ]);
    });

    it('401 พร้อมกันหลายคำขอ ยิง clear-cookie ครั้งเดียวและนำทางครั้งเดียว', async () => {
        const clear = deferred<Response>();
        const fetchMock: FetchMock = jest.fn(() => clear.promise);
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const all = [AuthService.endExpiredSession(), AuthService.endExpiredSession(), AuthService.endExpiredSession()];
        clear.resolve(okResponse());
        await Promise.all(all);
        await settle();

        expect(clearCookieCalls(fetchMock)).toBe(1);
        expect(mockHardNavigate).toHaveBeenCalledTimes(1);
        expect(mockHardNavigate).toHaveBeenCalledWith('/auth/provider/login?expired=true');
    });
});

describe('เหตุผลของ session ไม่อ่อนลง และหน้าต่างกันซ้ำไม่ค้าง (รีวิวรอบสามและสี่)', () => {
    // หน้าที่มีงานยังไม่บันทึกถาม "ออกจากหน้านี้?" (use-auto-save.ts): browser หยุด JS ของหน้าไว้จนกว่าผู้ใช้ตอบ
    // ผู้ใช้อาจกดอยู่ต่อ (การนำทางถูกยกเลิก) หรือใช้เวลาตอบนาน · รอบสามพบว่าสถานะ "กำลังออก" ค้างตลอดอายุหน้า
    // รอบสี่พบว่าหน้าต่างกันซ้ำ 10 วินาทีเริ่มนับก่อนกล่องถาม — ตอบช้ากว่า 10 วินาทีแล้ว 401 ที่ค้างอยู่
    // พาไป ?expired=true ทับหน้าที่บอกว่าบัญชีถูกระงับ (ยืนยันใน Chromium จริง)
    // Both clocks move together, so each case means the same thing whichever clock
    // the code reads; the clock-change case below moves the wall clock alone.
    let now = 1_000_000;
    let monoSpy: jest.SpiedFunction<typeof performance.now>;
    let wallSpy: jest.SpiedFunction<typeof Date.now>;

    beforeEach(() => {
        now = 1_000_000;
        monoSpy = jest.spyOn(performance, 'now').mockImplementation(() => now);
        wallSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        monoSpy.mockRestore();
        wallSpy.mockRestore();
        mockHardNavigate.mockReset();
    });

    const INACTIVE_URL = '/auth/provider/login?reason=account_inactive';
    const EXPIRED_URL = '/auth/provider/login?expired=true';
    const urls = () => mockHardNavigate.mock.calls.map(([url]) => url);

    it('ผู้ใช้กดอยู่ต่อ (หน้าไม่ถูกปิด) — 401 ที่มาภายหลังพาออกได้อีกครั้ง', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endExpiredSession();
        now += 60_000; // หน้ายังอยู่หนึ่งนาที = การนำทางถูกยกเลิก
        await AuthService.endExpiredSession();
        await settle();

        expect(urls()).toEqual([EXPIRED_URL, EXPIRED_URL]);
        expect(clearCookieCalls(fetchMock)).toBe(2);
    });

    it('ล็อกอินใหม่ในหน้าเดิม — session ใหม่เริ่มสะอาด ไม่รับสถานะของ session ก่อน', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endInactiveAccountSession();
        await AuthService.saveSession({ token: 'header.payload.sig', user: { id: 'u-1', role: 'FARMER' } } as never);
        await AuthService.endExpiredSession();
        await settle();

        // session ใหม่ไม่ใช่บัญชีที่ถูกระงับ (ยังไม่รู้) — หมดเวลาก็คือหมดเวลา
        expect(urls()).toEqual([INACTIVE_URL, EXPIRED_URL]);
    });

    it('ระหว่างที่กำลังออกอยู่ 401 ที่ตามมายังล้าง session ฝั่งเครื่อง แม้ไม่นำทางซ้ำ', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const clearSpy = jest.spyOn(AuthService, 'clearSession');

        await AuthService.endExpiredSession();
        const before = clearSpy.mock.calls.length;
        await AuthService.endExpiredSession();
        await settle();

        expect(urls()).toEqual([EXPIRED_URL]);
        expect(clearSpy.mock.calls.length).toBe(before + 1);
        clearSpy.mockRestore();
    });

    it('กล่องถาม "ออกจากหน้านี้?" ค้างนานกว่าหน้าต่าง — 401 ที่ตามมาไม่พาไปหน้าหมดเวลา', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        // browser หยุดหน้าไว้ 12 วินาทีที่การนำทาง แล้วผู้ใช้กด "ออก"
        mockHardNavigate.mockImplementationOnce(() => { now += 12_000; });

        await AuthService.endInactiveAccountSession();
        await AuthService.endExpiredSession();
        await settle();

        expect(urls()).toEqual([INACTIVE_URL]);
    });

    it('อยู่ต่อหลังถูกพาออกเพราะบัญชีถูกระงับ — 401 ภายหลังพาไปหน้าที่บอกเหตุผลเดิม ไม่ใช่ "หมดเวลา"', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endInactiveAccountSession();
        clearMarkers();
        now += 60_000;
        await AuthService.endExpiredSession();
        await settle();

        expect(urls()).toEqual([INACTIVE_URL, INACTIVE_URL]);
        expect(cookieNames()).toContain('__Host-signed_out_reason');
    });

    it('หน้าหมดเวลากำลังนำทางอยู่ แล้ว ACCOUNT_INACTIVE มาถึง — เปลี่ยนปลายทางเป็นหน้าที่บอกเหตุผล พร้อม marker', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endExpiredSession();
        await AuthService.endInactiveAccountSession();
        await settle();

        // การนำทางครั้งหลังแทนที่ครั้งแรก — ผู้ใช้ไปถึงหน้าที่บอกความจริง และ marker ถูกหน้านั้นใช้
        expect(urls()).toEqual([EXPIRED_URL, INACTIVE_URL]);
        expect(cookieNames()).toContain('__Host-signed_out_reason');
    });

    it('เครือข่ายช้า หน้าต่างหมดก่อนหน้าเปลี่ยน — การนำทางซ้ำไปที่เดิมเท่านั้น ไม่อ่อนลงเป็น "หมดเวลา"', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endInactiveAccountSession();
        now += 11_000;
        await AuthService.endExpiredSession();
        await settle();

        expect(urls().every((url) => url === INACTIVE_URL)).toBe(true);
    });

    it('นาฬิกาเครื่องถูกตั้งย้อน — ไม่ทำให้หน้าต่างยืดออก (ใช้นาฬิกา monotonic)', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        await AuthService.endExpiredSession();
        wallSpy.mockImplementation(() => 0); // ผู้ใช้ตั้งเวลาเครื่องย้อน — นาฬิกา monotonic เดินต่อ
        now += 60_000;
        await AuthService.endExpiredSession();
        await settle();

        expect(urls()).toEqual([EXPIRED_URL, EXPIRED_URL]);
    });
});

describe('ไม่ส่งข้อความเท็จไปถึงคนอื่น และไม่วนนำทางไม่จบ (ข้อไม่บล็อกของรีวิวรอบสี่)', () => {
    let now = 5_000_000;
    let monoSpy: jest.SpiedFunction<typeof performance.now>;
    let wallSpy: jest.SpiedFunction<typeof Date.now>;

    beforeEach(() => {
        now = 5_000_000;
        monoSpy = jest.spyOn(performance, 'now').mockImplementation(() => now);
        wallSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        monoSpy.mockRestore();
        wallSpy.mockRestore();
        mockHardNavigate.mockReset();
        localStorage.clear();
        sessionStorage.clear();
    });

    const urls = () => mockHardNavigate.mock.calls.map(([url]) => url);

    it('อีกคนล็อกอินจากแท็บอื่นหลังบัญชีเดิมถูกระงับ — session ของเขาหมดเวลาก็ไปหน้าหมดเวลา ไม่ใช่หน้า "ถูกระงับ"', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endInactiveAccountSession(); // ผู้ใช้ A ถูกระงับ แล้วกดอยู่ในหน้าต่อ
        now += 60_000;
        // ผู้ใช้ B ล็อกอินในแท็บอื่น — localStorage ใช้ร่วมกัน (แท็บนี้ไม่ได้เรียก saveSession)
        localStorage.setItem('accessToken', 'header.payload.sig');
        localStorage.setItem('user', JSON.stringify({ id: 'user-b', role: 'FARMER' }));
        document.cookie = '__Host-signed_out_reason=; path=/; max-age=0; secure';

        await AuthService.endExpiredSession();
        await settle();

        expect(urls()[urls().length - 1]).toBe('/auth/provider/login?expired=true');
        expect(cookieNames()).not.toContain('__Host-signed_out_reason');
    });

    it('แท็บที่ตั้ง marker เองไปจบที่หน้าล็อกอินที่ไม่มี reason — ลบ marker ทิ้ง ไม่ให้ค้าง', () => {
        markAccountInactiveSignOut();

        expect(consumeAccountInactiveSignOut(params('expired=true'))).toBe(false);
        expect(cookieNames()).not.toContain('__Host-signed_out_reason');
        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(false);
    });

    it('สองแท็บ: หน้าล็อกอินธรรมดาของอีกแท็บไม่ลบ marker ก่อนแท็บที่ตั้งมันจะไปถึงหน้าที่บอกเหตุผล', () => {
        markAccountInactiveSignOut();                 // แท็บ 1 ตั้ง marker (และจำว่าตัวเองตั้ง)
        const ownFlag = { ...sessionStorage };        // sessionStorage เป็นของแต่ละแท็บ
        sessionStorage.clear();                       // ...ตอนนี้เป็นแท็บ 2 ซึ่งไม่ได้ตั้ง

        expect(consumeAccountInactiveSignOut(params(''))).toBe(false);          // แท็บ 2 เปิดหน้าล็อกอินธรรมดาก่อน
        expect(cookieNames()).toContain('__Host-signed_out_reason');

        for (const [key, value] of Object.entries(ownFlag)) sessionStorage.setItem(key, String(value)); // กลับเป็นแท็บ 1
        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(true);
        expect(cookieNames()).not.toContain('__Host-signed_out_reason');
    });

    it('flag "แท็บนี้ตั้ง" ที่เก่ากว่าอายุ marker ไม่ลบ marker ใหม่ของผู้ใช้อีกคน (รีวิวรอบหก กรณี Z)', () => {
        markAccountInactiveSignOut();             // ผู้ใช้ A ถูกระงับในแท็บนี้ แล้วกดอยู่ต่อ — flag ค้าง
        now += 121_000;                           // เกินอายุ marker (120 วินาที)
        // ผู้ใช้ B ถูกระงับในอีกแท็บ: marker ใหม่ (ตั้งจากแท็บอื่น จึงไม่มี flag ใหม่ในแท็บนี้)
        document.cookie = '__Host-signed_out_reason=account_inactive.fedcba9876543210; path=/; max-age=120; samesite=lax; secure';

        expect(consumeAccountInactiveSignOut(params(''))).toBe(false);   // แท็บนี้เปิดหน้าล็อกอินธรรมดา
        expect(cookieNames()).toContain('__Host-signed_out_reason');
    });

    it('flag ของแท็บนี้ที่ยังใหม่ ก็ไม่ลบ marker ที่อีกแท็บตั้งให้ผู้ใช้อีกคน (กรณี Z ในเบราว์เซอร์จริง: ห่างกัน 3.5 วินาที)', () => {
        markAccountInactiveSignOut();             // ผู้ใช้ A ถูกระงับในแท็บนี้ แล้วกดอยู่ต่อ — flag ค้าง
        now += 3_500;
        const ownMarker = document.cookie;
        // ผู้ใช้ B ถูกระงับในแท็บ 2: แท็บนั้นตั้ง marker ของตัวเองทับ (sessionStorage ของแท็บนี้ไม่เปลี่ยน)
        const flagHere = { ...sessionStorage };
        sessionStorage.clear();
        markAccountInactiveSignOut();
        expect(document.cookie).not.toBe(ownMarker);   // marker แต่ละครั้งแยกกันได้
        sessionStorage.clear();
        for (const [key, value] of Object.entries(flagHere)) sessionStorage.setItem(key, String(value));

        expect(consumeAccountInactiveSignOut(params(''))).toBe(false);   // แท็บนี้ตามไปหน้าล็อกอินธรรมดา
        expect(cookieNames()).toContain('__Host-signed_out_reason');     // ...และไม่ลบ marker ของแท็บ 2

        sessionStorage.clear();                   // แท็บ 2 ไปถึงหน้าที่มี reason
        expect(consumeAccountInactiveSignOut(params('reason=account_inactive'))).toBe(true);
    });

    it('เครือข่ายช้ามาก + 401 ถี่ — การนำทางซ้ำเว้นห่างขึ้นทุกครั้ง หน้ามีโอกาสได้เปลี่ยนจริง', async () => {
        const fetchMock: FetchMock = jest.fn(() => Promise.resolve(okResponse()));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await AuthService.endInactiveAccountSession();
        for (let t = 4_000; t <= 60_000; t += 4_000) {
            now = 5_000_000 + t;
            await AuthService.endExpiredSession();
        }
        await settle();

        // ไม่เว้นห่าง: นำทางที่ 0, 12, 24, 36, 48, 60 วินาที (6 ครั้ง) — ทุกครั้งเริ่มโหลดหน้าใหม่ จึงไม่เคยถึง
        expect(urls().length).toBeLessThanOrEqual(3);
        expect(urls().every((url) => url === '/auth/provider/login?reason=account_inactive')).toBe(true);
    });
});
