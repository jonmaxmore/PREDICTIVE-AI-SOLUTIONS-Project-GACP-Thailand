/**
 * ฟอร์มล็อกอิน ห้ามส่งรหัสผ่านขึ้น URL — ไม่ว่า JS จะโหลดทันหรือไม่
 *
 * เจอจริงระหว่าง Deep QA 2026-09-07: กดปุ่มเข้าสู่ระบบบนหน้า /auth/provider/login
 * ก่อนที่ React จะ hydrate เสร็จ (เครื่องช้า/เน็ตช้า/บอท) — เบราว์เซอร์ทำ native form
 * submission ซึ่ง `<form>` ที่ไม่ประกาศ method จะเป็น **GET** และพารามิเตอร์ของฟอร์ม
 * กลายเป็น query string:
 *
 *     /auth/provider/login?provider-id=3333333333333&provider-password=Gacp%402025
 *
 * รหัสผ่านจริงของพนักงาน ไปอยู่ใน URL ⇒ ตกลง nginx access log, browser history,
 * และ Referer header — ละเมิดหลัก NO SECRET (L2) โดยตัวแอปเอง
 *
 * การป้องกันที่ไม่พึ่ง JS: `method="post"` บนทุกฟอร์มที่มีช่องรหัสผ่าน — native submit
 * ที่หลุดไปก่อน hydrate จะเป็น POST body ไม่ใช่ query string (ปลายทางตอบ 404/405
 * ก็ยังดีกว่ารหัสผ่านขึ้น log) · onSubmit เดิมยังทำงานตามปกติเมื่อ JS พร้อม
 */
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = path.join(__dirname, '..');
const FORM_FILES = [
    'provider-login-page.tsx',
    'health-login-page.tsx',
    'mfa-challenge-form.tsx',
];

describe.each(FORM_FILES)('%s', (file) => {
    const src = fs.readFileSync(path.join(COMPONENTS, file), 'utf8');

    it('ทุก <form> ประกาศ method="post"', () => {
        const forms = src.match(/<form\b[^>]*>/g) || [];
        expect(forms.length).toBeGreaterThan(0);
        for (const tag of forms) {
            expect(tag).toMatch(/method="post"/i);
        }
    });
});
