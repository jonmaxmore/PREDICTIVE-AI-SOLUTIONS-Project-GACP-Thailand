/**
 * คนที่บัญชีถูกระงับ ต้องได้อ่านว่าบัญชีถูกระงับ — ทั้งตอนกรอกรหัสผ่าน และตอนถูกพาออกจากระบบ
 *
 * ก่อนแก้ (วัด 2026-09-17 บน wave-1): ประตูล็อกอินตอบ 403 ACCOUNT_INACTIVE พร้อม messageTh
 * แต่ api-client แปลง 403 ทุกตัวเป็น "คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาเข้าสู่ระบบใหม่หรือติดต่อเจ้าหน้าที่"
 * คนที่กรอกรหัสถูกจึงถูกบอกให้ "เข้าสู่ระบบใหม่" แล้วก็จะลองซ้ำไปเรื่อย ๆ
 *
 * และเมื่อ api-client พาคนที่ถูกระงับกลางทางไปหน้าล็อกอินพร้อม ?reason=account_inactive
 * หน้าล็อกอินต้องบอกเหตุผลนั้น ไม่ใช่แสดงฟอร์มเปล่าเหมือนไม่มีอะไรเกิดขึ้น
 *
 * รีวิวรอบแรก: ข้อความนี้ต้องเป็นจริง ลิงก์จากที่อื่นที่มีแค่ ?reason=account_inactive ต้องไม่ทำให้
 * หน้าเว็บของกรมฯ บอกใครว่าบัญชีถูกระงับ จึงแสดงเมื่อมี marker cookie ที่หน้าเว็บของเราเองตั้งไว้
 * ก่อนพาออก (account-inactive.ts markAccountInactiveSignOut) และลบ marker ทิ้งเมื่อแสดงแล้ว
 *
 * เดินผ่านของจริงทั้งสาย: ฟอร์ม → AuthService.login → api-client → fetch (จำลองแค่ตัวตอบ)
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let mockSearch = '';
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/auth/health/login',
    useSearchParams: () => new URLSearchParams(mockSearch),
}));

import HealthLoginPage from '../health-login-page';
import ProviderLoginPage from '../provider-login-page';
import { markAccountInactiveSignOut } from '@/lib/api/account-inactive';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GENERIC_403 = 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาเข้าสู่ระบบใหม่หรือติดต่อเจ้าหน้าที่';
/** ประโยคที่หลังบ้านส่งมาใน messageTh — ต้องถึงจอทั้งประโยค */
const BACKEND_MESSAGE_TH = 'บัญชีของคุณถูกระงับการใช้งาน หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก';
const REFUSAL = {
    success: false,
    code: 'ACCOUNT_INACTIVE',
    error: 'Account is inactive',
    message: 'Account is inactive',
    messageTh: BACKEND_MESSAGE_TH,
};

/** ตั้งโดยหน้าเว็บของเราเองก่อนพาคนที่ถูกระงับออกจากหน้า */
const MARKER_NAME = 'signed_out_reason';
function setMarker(value = 'account_inactive.0123456789abcdef'): void {
    document.cookie = `${MARKER_NAME}=${value}; path=/`;
}

const realFetch = globalThis.fetch;
let fetchMock: jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;

function jsonResponse(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
    mockSearch = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    fetchMock = jest.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.includes('/auth/health/login') || url.includes('/auth/provider/login')) {
            return jsonResponse(403, REFUSAL);
        }
        return jsonResponse(200, { success: true });
    }) as typeof fetchMock;
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

afterEach(async () => {
    document.cookie = `${MARKER_NAME}=; path=/; max-age=0`;
    await act(async () => { root?.unmount(); });
    container?.remove();
    container = null;
    root = null;
    (globalThis as { fetch: typeof fetch }).fetch = realFetch;
});

async function render(node: React.ReactNode): Promise<void> {
    await act(async () => {
        root = createRoot(container!);
        root.render(node);
    });
}

async function type(id: string, value: string): Promise<void> {
    const input = document.getElementById(id) as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function submit(): Promise<void> {
    const form = container!.querySelector('form') as HTMLFormElement;
    expect(form).not.toBeNull();
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    // react-hook-form validates asynchronously, then the login request settles.
    for (let i = 0; i < 10; i += 1) {
        await act(async () => { await Promise.resolve(); });
    }
}

function alerts(): string[] {
    return Array.from(container!.querySelectorAll('[role="alert"]')).map((el) => el.textContent?.trim() || '');
}

describe('ฟอร์มล็อกอินแสดง messageTh ของหลังบ้านเมื่อบัญชีถูกระงับ', () => {
    it('หน้าเจ้าหน้าที่', async () => {
        await render(<ProviderLoginPage />);
        await type('provider-id', '1708643756689');
        await type('provider-password', 'correct-password');
        await submit();

        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/provider/login'))).toBe(true);
        expect(alerts()).toContain(BACKEND_MESSAGE_TH);
        expect(container!.textContent).not.toContain(GENERIC_403);
    });

    it('หน้าประชาชน', async () => {
        await render(<HealthLoginPage />);
        await type('identifier', '1708643756689');
        await type('password', 'correct-password');
        await submit();

        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/health/login'))).toBe(true);
        expect(alerts()).toContain(BACKEND_MESSAGE_TH);
        expect(container!.textContent).not.toContain(GENERIC_403);
    });
});

describe('หน้าล็อกอินบอกเหตุผลเมื่อถูกพาออกเพราะบัญชีถูกระงับ', () => {
    const SUSPENDED = /ถูกระงับการใช้งาน/;
    const CONTACT_DTAM = /ติดต่อเจ้าหน้าที่กรมการแพทย์แผนไทยและการแพทย์ทางเลือก/;
    const NO_RECOVERY_PROMISE = /กู้|คืนสิทธิ์|เปิดใช้งานอีกครั้ง|ปลดระงับ/;

    const PAGES = [
        ['หน้าเจ้าหน้าที่', () => <ProviderLoginPage />],
        ['หน้าประชาชน', () => <HealthLoginPage />],
    ] as const;

    it.each(PAGES)('%s: ?reason=account_inactive พร้อม marker แสดงข้อความก่อนผู้ใช้กดอะไร', async (_label, page) => {
        mockSearch = 'reason=account_inactive';
        setMarker();
        await render(page());

        const notice = alerts().find((text) => SUSPENDED.test(text));
        expect(notice).toBeDefined();
        expect(notice).toMatch(CONTACT_DTAM);
        expect(notice).not.toMatch(NO_RECOVERY_PROMISE);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(PAGES)('%s: แสดงแล้วลบ marker — โหลดหน้าซ้ำไม่บอกซ้ำ', async (_label, page) => {
        mockSearch = 'reason=account_inactive';
        setMarker();
        await render(page());

        expect(alerts().some((text) => SUSPENDED.test(text))).toBe(true);
        expect(document.cookie).not.toContain(MARKER_NAME);

        await act(async () => { root?.unmount(); });
        await render(page());
        expect(container!.textContent).not.toMatch(SUSPENDED);
    });

    it.each(PAGES)('%s: ลิงก์จากที่อื่น (มีแค่ ?reason=account_inactive ไม่มี marker) ไม่บอกว่าบัญชีถูกระงับ', async (_label, page) => {
        mockSearch = 'reason=account_inactive';
        await render(page());

        expect(container!.textContent).not.toMatch(SUSPENDED);
        expect(alerts()).toEqual([]);
    });

    // marker ที่แท็บนี้ไม่ได้ตั้ง (setMarker ตั้ง cookie ตรง ๆ = แท็บอื่นตั้ง) ต้องอยู่รอหน้าที่บอกเหตุผลของแท็บนั้น:
    // เมื่อบัญชีถูกระงับ แท็บที่สองเห็น session หายแล้วเปิดหน้าล็อกอินธรรมดาก่อนแท็บแรกไปถึงหน้าที่บอกเหตุผล
    // (รีวิวรอบห้า ยืนยันในเบราว์เซอร์สองแท็บ)
    it.each(PAGES)('%s: marker ของแท็บอื่นแต่ URL ไม่มีเหตุผล ไม่แสดง และไม่ลบ marker', async (_label, page) => {
        setMarker();
        await render(page());

        expect(container!.textContent).not.toMatch(SUSPENDED);
        expect(document.cookie).toContain(`${MARKER_NAME}=account_inactive`);
    });

    // แท็บที่ตั้ง marker เอง แต่การนำทางของมันถูกแทนที่ (ไปหน้าหมดเวลา) — marker นั้นไม่มีใครมารับแล้ว ลบทิ้ง
    it.each(PAGES)('%s: marker ที่แท็บนี้ตั้งเอง แต่ URL ไม่มีเหตุผล ไม่แสดง และลบ marker', async (_label, page) => {
        markAccountInactiveSignOut();
        await render(page());

        expect(container!.textContent).not.toMatch(SUSPENDED);
        expect(document.cookie).not.toContain(`${MARKER_NAME}=account_inactive`);
    });

    it('marker ค่าอื่นไม่นับ', async () => {
        mockSearch = 'reason=account_inactive';
        setMarker('expired');
        await render(<ProviderLoginPage />);

        expect(container!.textContent).not.toMatch(SUSPENDED);
    });

    it('ค่าอื่นใน reason ไม่ถูกนำมาแสดง (หน้าไม่สะท้อนข้อความจาก URL)', async () => {
        mockSearch = 'reason=%E0%B8%9A%E0%B8%B1%E0%B8%8D%E0%B8%8A%E0%B8%B5%E0%B8%84%E0%B8%B8%E0%B8%93%E0%B8%96%E0%B8%B9%E0%B8%81%E0%B8%A3%E0%B8%B0%E0%B8%87%E0%B8%B1%E0%B8%9A';
        setMarker();
        await render(<ProviderLoginPage />);
        expect(alerts()).toEqual([]);
    });
});
