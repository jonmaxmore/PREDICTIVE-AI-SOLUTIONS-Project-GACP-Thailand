/**
 * @jest-environment node
 *
 * เจ้าหน้าที่ที่บัญชีถูกระงับ ต้องไปถึงหน้าล็อกอินที่บอกเหตุผล — ไม่ใช่เด้งกลับแดชบอร์ด
 *
 * รีวิวรอบแรกของ wave1/honest-limits (2026-09-17) เจอว่า เมื่อ API ตอบ ACCOUNT_INACTIVE
 * เว็บเรียก AuthService.clearSession() แล้วเปลี่ยนหน้าทันที แต่ provider_token เป็น cookie
 * httpOnly ที่ลบได้ทางเดียวคือ POST /api/session/clear-cookie ซึ่งถูกยิงแบบไม่รอ
 * การเปลี่ยนหน้าจึงพา cookie เดิมไปด้วย (หรือยกเลิกคำขอลบกลางทาง) แล้ว middleware ข้อ
 * `isProviderAuthRoute && providerToken → /provider/dashboard` ก็ส่งคนนั้นกลับแดชบอร์ด
 * ?reason=account_inactive หายไป ข้อความไม่ถูกแสดง (วัดใน Chromium: 10 ใน 10 รอบเมื่อ
 * clear-cookie ช้า 30 ms)
 *
 * ไฟล์นี้ขับ middleware ตัวจริงด้วย NextRequest จริง:
 *   - หน้าล็อกอินที่มาพร้อม ?reason=account_inactive และ marker cookie ที่หน้าเว็บของเราเอง
 *     ตั้งไว้ก่อนออกจากหน้า → ปล่อยผ่าน และลบ session cookie ทั้งสี่ตัว (path=/ ตรงกับตอนตั้ง)
 *   - ลิงก์จากที่อื่นที่มีแค่ ?reason=account_inactive → ทำงานแบบเดิม ไม่ลบ session ใคร
 *     (ไม่อย่างนั้นใครก็ส่งลิงก์มาพาเจ้าหน้าที่ออกจากระบบได้)
 */
import { describe, expect, it } from '@jest/globals';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const SELF = 'http://localhost:3000';

function fakeJwt(payload: Record<string, unknown>): string {
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const PROVIDER_TOKEN = fakeJwt({ id: 'prov-1', role: 'AUDITOR', canonicalRole: 'FIELD_INSPECTOR' });
const HEALTH_TOKEN = fakeJwt({ id: 'user-1', role: 'FARMER', canonicalRole: 'HEALTH' });
const MARKER = 'signed_out_reason=account_inactive.0123456789abcdef';
const SESSION_COOKIES = ['auth_token', 'provider_token', 'refresh_token', 'csrf_token'];

function get(pathAndQuery: string, cookies: string[]): NextRequest {
    return new NextRequest(`${SELF}${pathAndQuery}`, {
        headers: cookies.length > 0 ? { cookie: cookies.join('; ') } : {},
    });
}

function setCookieHeaders(res: Response): string[] {
    return res.headers.getSetCookie();
}

/**
 * มี Set-Cookie ที่ทำให้ browser ลบ cookie ชื่อนี้ ซึ่งตั้งไว้ด้วย path=/ หรือไม่
 * (Set-Cookie ที่ไม่มี Path จะได้ path ของ URL ที่ขอ คือ /auth/provider และลบ cookie ของ / ไม่ได้)
 */
function clears(res: Response, name: string): boolean {
    return setCookieHeaders(res).some((line) => {
        const [pair, ...rest] = line.split(';').map((part) => part.trim());
        if (pair !== `${name}=`) return false;
        const attrs = new Map(rest.map((part) => {
            const [key, ...value] = part.split('=');
            return [key.toLowerCase(), value.join('=')] as const;
        }));
        const expires = attrs.get('expires');
        const expired = attrs.get('max-age') === '0'
            || (expires !== undefined && Date.parse(expires) <= Date.now());
        return attrs.get('path') === '/' && expired;
    });
}

function touchedCookies(res: Response): string[] {
    return setCookieHeaders(res).map((line) => line.split('=')[0]);
}

function isPassThrough(res: Response): boolean {
    return res.headers.get('x-middleware-next') === '1' && res.headers.get('location') === null;
}

describe('หน้าล็อกอินเจ้าหน้าที่ หลังเว็บพาออกเพราะบัญชีถูกระงับ', () => {
    const landing = () => get('/auth/provider/login?reason=account_inactive', [`provider_token=${PROVIDER_TOKEN}`, MARKER]);

    it('ปล่อยผ่านไปหน้าล็อกอิน แม้ provider_token ยังค้างอยู่ — ไม่เด้งกลับแดชบอร์ด', () => {
        const res = middleware(landing());

        expect(res.headers.get('location')).toBeNull();
        expect(isPassThrough(res)).toBe(true);
    });

    it.each(SESSION_COOKIES)('ลบ %s ด้วย path=/ (ตัวที่ clear-cookie อาจลบไม่ทันก่อนเปลี่ยนหน้า)', (name) => {
        const res = middleware(landing());

        expect(clears(res, name)).toBe(true);
    });

    it('ไม่ลบ marker — หน้าล็อกอินต้องใช้มันตัดสินว่าจะแสดงข้อความ แล้วลบเอง', () => {
        const res = middleware(landing());

        expect(touchedCookies(res)).not.toContain('signed_out_reason');
    });

    it('ยังใส่ security headers ตามปกติ', () => {
        const res = middleware(landing());

        expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
        expect(res.headers.get('x-frame-options')).toBe('DENY');
    });

    it('URL เก่า /provider/login ถูกพาไปหน้าใหม่โดยเหตุผลยังอยู่', () => {
        const res = middleware(get('/provider/login?reason=account_inactive', [`provider_token=${PROVIDER_TOKEN}`, MARKER]));

        const location = new URL(res.headers.get('location') || '', SELF);
        expect(location.pathname).toBe('/auth/provider/login');
        expect(location.searchParams.get('reason')).toBe('account_inactive');
    });
});

describe('หน้าล็อกอินประชาชน หลังเว็บพาออกเพราะบัญชีถูกระงับ', () => {
    it('ปล่อยผ่าน และลบ auth_token ที่ค้าง', () => {
        const res = middleware(get('/auth/health/login?reason=account_inactive', [`auth_token=${HEALTH_TOKEN}`, MARKER]));

        expect(isPassThrough(res)).toBe(true);
        expect(clears(res, 'auth_token')).toBe(true);
        expect(clears(res, 'refresh_token')).toBe(true);
    });
});

describe('ตัวควบคุม: ไม่มีใครถูกพาออกจากระบบด้วยลิงก์', () => {
    it('ลิงก์จากที่อื่น (มีแค่ ?reason=account_inactive ไม่มี marker) → เจ้าหน้าที่ที่ล็อกอินอยู่ไปแดชบอร์ดตามเดิม ไม่ลบ cookie', () => {
        const res = middleware(get('/auth/provider/login?reason=account_inactive', [`provider_token=${PROVIDER_TOKEN}`]));

        expect(new URL(res.headers.get('location') || '', SELF).pathname).toBe('/provider/dashboard');
        expect(touchedCookies(res)).toEqual([]);
    });

    it('ลิงก์จากที่อื่นเข้าหน้าล็อกอินประชาชน → ไม่ลบ auth_token', () => {
        const res = middleware(get('/auth/health/login?reason=account_inactive', [`auth_token=${HEALTH_TOKEN}`]));

        expect(isPassThrough(res)).toBe(true);
        expect(touchedCookies(res)).toEqual([]);
    });

    it('marker ค้าง แต่ URL ไม่มีเหตุผล → ทำงานแบบเดิม', () => {
        const res = middleware(get('/auth/provider/login', [`provider_token=${PROVIDER_TOKEN}`, MARKER]));

        expect(new URL(res.headers.get('location') || '', SELF).pathname).toBe('/provider/dashboard');
        expect(touchedCookies(res)).toEqual([]);
    });

    it('marker ที่ค่าไม่ใช่ account_inactive ไม่นับ', () => {
        const res = middleware(get('/auth/provider/login?reason=account_inactive', [
            `provider_token=${PROVIDER_TOKEN}`,
            'signed_out_reason=expired',
        ]));

        expect(new URL(res.headers.get('location') || '', SELF).pathname).toBe('/provider/dashboard');
        expect(touchedCookies(res)).toEqual([]);
    });

    it('หน้าภายในที่มี marker + reason ไม่ถูกแตะ — marker มีผลเฉพาะหน้าล็อกอิน', () => {
        const res = middleware(get('/provider/dashboard?reason=account_inactive', [`provider_token=${PROVIDER_TOKEN}`, MARKER]));

        expect(isPassThrough(res)).toBe(true);
        expect(touchedCookies(res)).toEqual([]);
    });
});
