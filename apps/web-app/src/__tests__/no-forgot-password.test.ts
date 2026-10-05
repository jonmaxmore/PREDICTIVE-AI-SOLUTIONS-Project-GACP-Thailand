/**
 * ไม่มีระบบลืมรหัสผ่าน ไม่ว่าจะส่งทางอีเมลหรือ SMS (มติ operator 2026-09-16)
 *
 * หน้า /forgot-password เคยเสนอ "ส่งลิงก์ทาง SMS หรืออีเมล" และหน้าเข้าสู่ระบบมีลิงก์ "ลืมรหัสผ่าน?"
 * ชี้ไปที่นั่น ทั้งที่ระบบไม่มีช่องทางส่งอะไรเลย (และหน้านั้นส่ง body ผิด schema จึงตอบ 400 ทุกครั้ง)
 * เทสนี้พิสูจน์พฤติกรรมที่เหลือ: sitemap ไม่โฆษณาหน้านั้น, ค่าคงที่เส้นทางไม่มี, รายการ route สาธารณะ
 * ถูกตรึงทั้งชุด และหน้าเข้าสู่ระบบไม่มีลิงก์ไปขอรีเซ็ต
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import sitemap from '@/app/sitemap';
import * as authRoutes from '@/lib/constants/auth-routes';
import { PROTECTED_ROUTES } from '@/lib/role-utils';

const SRC = resolve(__dirname, '..');

describe('no forgot-password surface in the web app', () => {
    it('the sitemap advertises no forgot-password page', () => {
        const urls = sitemap().map((entry) => entry.url);
        expect(urls.filter((url) => /forgot/i.test(url))).toEqual([]);
    });

    it('the auth route constants carry no forgot-password route', () => {
        expect(Object.keys(authRoutes).filter((key) => /FORGOT/i.test(key))).toEqual([]);
        expect(Object.values(authRoutes).filter((value) => typeof value === 'string' && /forgot/i.test(value))).toEqual([]);
    });

    // Pinned as a whole list, not probed with one path: asking `requiresAuth('/forgot-password')`
    // passes for any string, so it would also pass if the page came back at
    // '/account-recovery'. Any new public route now has to be a conscious edit here.
    it('the public route list is exactly the four doors that exist', () => {
        expect([...PROTECTED_ROUTES.public]).toEqual([
            '/',
            authRoutes.HEALTH_LOGIN_ROUTE,
            authRoutes.LEGACY_HEALTH_LOGIN_ROUTE,
            authRoutes.REGISTER_ROUTE,
            authRoutes.PROVIDER_LOGIN_ROUTE,
        ]);
    });

    it('the page itself is gone', () => {
        expect(existsSync(resolve(SRC, 'app', '(auth)', 'forgot-password'))).toBe(false);
    });

    // Scoped to a link/route reference, not the word: the page is allowed to carry a
    // comment saying why the link was removed. The backend guard sweeps the rest of
    // the web tree (no-self-service-password-reset.test.js).
    it('the applicant login page links to no reset route', () => {
        const page = readFileSync(resolve(SRC, 'app', 'auth', '_components', 'health-login-page.tsx'), 'utf8');
        expect(page).not.toMatch(/href=["'{][^"'}]*forgot/i);
        expect(page).not.toMatch(/FORGOT_PASSWORD_ROUTE|copy\.forgot\b/);
    });
});
