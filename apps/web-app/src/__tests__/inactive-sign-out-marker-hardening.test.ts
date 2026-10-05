/**
 * @jest-environment node
 *
 * marker cookie ของการพาออกเพราะบัญชีถูกระงับ ต้องตั้งได้จากหน้าของเราเท่านั้น — รวมถึงไม่ใช่จาก subdomain พี่น้อง
 *
 * รีวิวรอบสองของ wave1/honest-limits (445e4b72, 2026-09-17) ยืนยันว่ากลไกทำงาน แต่ชี้สองช่อง:
 *   1. marker ชื่อ `signed_out_reason` เป็น cookie ธรรมดา หน้าบน staging.gacpth.com หรือ preview.gacpth.com
 *      (หรือใครที่แก้ทราฟฟิก http ได้) ตั้ง `Domain=gacpth.com` ให้ demo ได้ แล้วลิงก์
 *      `https://demo.gacpth.com/auth/provider/login?reason=account_inactive` ก็พาเจ้าหน้าที่ออกจากระบบ
 *      และขึ้นข้อความเท็จว่าบัญชีถูกระงับ · บน https ต้องใช้ `__Host-` ซึ่ง browser บังคับ Secure,
 *      Path=/ และห้ามมี Domain — subdomain อื่นตั้งชื่อนี้ให้เราไม่ได้
 *   2. ทางลัดใน middleware เปิดกับทุก path ที่ `isLoginRoute` จับได้ รวม `/auth/provider/login/<อะไรก็ได้>`
 *      ซึ่งข้ามด่านของเจ้าหน้าที่ — ต้องเปิดเฉพาะหน้าล็อกอินสองหน้าที่มีจริงเท่านั้น
 *
 * ชุดนี้ขับ middleware ตัวจริงด้วย NextRequest จริง ทั้งแบบ https (หลัง nginx ที่ตั้ง X-Forwarded-Proto)
 * และแบบ http บนเครื่องนักพัฒนา
 */
import { describe, expect, it } from '@jest/globals';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function fakeJwt(payload: Record<string, unknown>): string {
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const PROVIDER_TOKEN = fakeJwt({ id: 'prov-1', role: 'AUDITOR', canonicalRole: 'FIELD_INSPECTOR' });
const PLAIN_MARKER = 'signed_out_reason=account_inactive.0123456789abcdef';
const HOST_MARKER = '__Host-signed_out_reason=account_inactive.0123456789abcdef';
const SESSION_COOKIES = ['auth_token', 'provider_token', 'refresh_token', 'csrf_token'];

function request(url: string, cookies: string[], forwardedProto?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (cookies.length > 0) headers.cookie = cookies.join('; ');
    if (forwardedProto) headers['x-forwarded-proto'] = forwardedProto;
    return new NextRequest(url, { headers });
}

function clearedSessionCookies(res: Response): string[] {
    return res.headers.getSetCookie()
        .map((line) => line.split('=')[0])
        .filter((name) => SESSION_COOKIES.includes(name));
}

function isPassThrough(res: Response): boolean {
    return res.headers.get('x-middleware-next') === '1' && res.headers.get('location') === null;
}

describe('บน https: marker ต้องเป็นชื่อ __Host- เท่านั้น', () => {
    // demo.gacpth.com อยู่หลัง nginx ที่ terminate TLS แล้วส่ง X-Forwarded-Proto: https (deploy/nginx/demo.gacpth.com.conf)
    const behindTls = (cookies: string[]) => request(
        'http://127.0.0.1:3000/auth/provider/login?reason=account_inactive', cookies, 'https',
    );

    it('marker ชื่อธรรมดา (ที่ subdomain พี่น้องตั้งให้ได้) ไม่พาเจ้าหน้าที่ออกจากระบบ', () => {
        const res = middleware(behindTls([`provider_token=${PROVIDER_TOKEN}`, PLAIN_MARKER]));

        expect(clearedSessionCookies(res)).toEqual([]);
        expect(isPassThrough(res)).toBe(false);
    });

    it('marker ชื่อ __Host- (ตั้งได้จากหน้าของเราเองเท่านั้น) ยังทำงานตามเดิม', () => {
        const res = middleware(behindTls([`provider_token=${PROVIDER_TOKEN}`, HOST_MARKER]));

        expect(isPassThrough(res)).toBe(true);
        expect(clearedSessionCookies(res).sort()).toEqual([...SESSION_COOKIES].sort());
    });

    it('marker ที่มี id ของการพาออกครั้งนั้น (หน้าเวอร์ชันใหม่ตั้งแบบนี้) ทำงานเหมือนกัน', () => {
        const res = middleware(behindTls([
            `provider_token=${PROVIDER_TOKEN}`, '__Host-signed_out_reason=account_inactive.0123456789abcdef',
        ]));

        expect(isPassThrough(res)).toBe(true);
        expect(clearedSessionCookies(res).sort()).toEqual([...SESSION_COOKIES].sort());
    });

    it('ค่า account_inactive ที่ไม่มี id ไม่ถูกนับ', () => {
        const res = middleware(behindTls([
            `provider_token=${PROVIDER_TOKEN}`, '__Host-signed_out_reason=account_inactive',
        ]));

        expect(clearedSessionCookies(res)).toEqual([]);
        expect(isPassThrough(res)).toBe(false);
    });

    it('ค่าอื่นที่แค่ขึ้นต้นเหมือน marker ไม่ถูกนับ', () => {
        const res = middleware(behindTls([
            `provider_token=${PROVIDER_TOKEN}`, '__Host-signed_out_reason=account_inactive_x',
        ]));

        expect(clearedSessionCookies(res)).toEqual([]);
    });

    it('URL ที่เป็น https อยู่แล้ว (ไม่มี header) ก็ถือเป็น https เช่นกัน', () => {
        const res = middleware(request(
            'https://demo.gacpth.com/auth/provider/login?reason=account_inactive',
            [`provider_token=${PROVIDER_TOKEN}`, PLAIN_MARKER],
        ));

        expect(clearedSessionCookies(res)).toEqual([]);
    });
});

describe('บน http (เครื่องนักพัฒนา) ชื่อธรรมดายังใช้ได้ — browser ไม่ยอมตั้ง cookie Secure บน http', () => {
    it('ปล่อยผ่านและลบ session cookie', () => {
        const res = middleware(request(
            'http://localhost:3000/auth/provider/login?reason=account_inactive',
            [`provider_token=${PROVIDER_TOKEN}`, PLAIN_MARKER],
        ));

        expect(isPassThrough(res)).toBe(true);
        expect(clearedSessionCookies(res).sort()).toEqual([...SESSION_COOKIES].sort());
    });
});

describe('ทางลัดเปิดเฉพาะหน้าล็อกอินสองหน้าที่มีจริง', () => {
    for (const path of ['/auth/provider/login/x', '/auth/health/login/anything', '/auth/provider/login/']) {
        it(`${path} ไม่ได้รับการปล่อยผ่านพิเศษ แม้มี marker และ reason`, () => {
            const res = middleware(request(
                `http://localhost:3000${path}?reason=account_inactive`,
                [`provider_token=${PROVIDER_TOKEN}`, PLAIN_MARKER],
            ));

            expect(clearedSessionCookies(res)).toEqual([]);
        });
    }
});
