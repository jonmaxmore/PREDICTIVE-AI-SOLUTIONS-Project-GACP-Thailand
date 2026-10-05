/**
 * คำตอบทุกแบบที่ประตูล็อกอินตอบได้ ต้องมีหน้าจอรองรับ
 *
 * เจอตอนเดินประตูจริงบน demo 2026-09-12: บัญชีเจ้าหน้าที่ที่ระบบบังคับให้มี 2FA แต่ยัง
 * ไม่เคยตั้ง (REQUIRE_MFA_FOR_PRIVILEGED=true บนทั้ง demo และ staging) ได้คำตอบ
 * `mfa_setup_required` + `setup_token` กลับมา — และ **ไม่มีอะไรบนหน้าจอรองรับคำตอบนั้น**
 *
 * ผลจริง: เจ้าหน้าที่กรอกรหัสผ่าน **ถูก** แล้วเห็นหน้าล็อกอินค้างอยู่เฉย ๆ ไม่มีข้อความ
 * ไม่มีทางรู้ว่าต้องทำอะไร ถ้าเขาคิดว่าพิมพ์ผิดแล้วลองซ้ำ บัญชีจะถูกล็อก 15 นาที
 * บนเครื่องจริงแปลว่า **ไม่มีเจ้าหน้าที่คนไหนเข้าระบบได้เลยสักคน**
 *
 * ── ทำไมเทสชุดเดิมมองไม่เห็น ────────────────────────────────────────────
 *
 * กิ่งพี่น้องของมัน (`mfa_required` สำหรับคนที่ตั้ง 2FA แล้ว) มีเทสอยู่ และ docstring ของ
 * MfaChallengeForm เขียนไว้เองว่า "closes the audit gap where mfa_required came back
 * with no FE screen" — ปิดไปกิ่งเดียว แล้วเทสก็ตรึงไว้กิ่งเดียว
 *
 * ใบนี้จึงตรึงที่ **ชนิดข้อมูลของคำตอบ** ไม่ใช่ที่กิ่งใดกิ่งหนึ่ง: ทุกช่องที่ LoginOutcome
 * ประกาศว่าเป็นไปได้ ต้องมีที่ไปบนหน้าจอ
 */
import fs from 'node:fs';
import path from 'node:path';
import { providerApiPaths } from '@/lib/services/provider-api';

const SRC = path.resolve(__dirname, '../../../..');

const read = (rel: string) => fs.readFileSync(path.resolve(SRC, rel), 'utf8');

describe('ชนิดข้อมูลของคำตอบล็อกอิน ประกาศครบทุกทาง', () => {
    const api = read('lib/services/auth-service-api.ts');

    it('LoginOutcome มีทางของการลงทะเบียน 2FA ครั้งแรก', () => {
        expect(api).toContain('mfaSetupRequired');
        expect(api).toContain('setupToken');
    });

    it('แปลงคำตอบ mfa_setup_required จากหลังบ้าน ไม่ปล่อยให้ไหลไปด่าน token', () => {
        const branch = api.slice(api.indexOf('mfa_setup_required'));
        expect(branch).toContain('setup_token');
        // ต้องอยู่ก่อนด่าน "ไม่ได้รับ Token" ไม่งั้นกิ่งนี้ไม่มีวันทำงาน
        expect(api.indexOf('mfa_setup_required')).toBeLessThan(api.indexOf('ไม่ได้รับ Token'));
    });
});

describe('หน้าล็อกอินเจ้าหน้าที่รองรับทุกคำตอบ', () => {
    const page = read('app/auth/_components/provider-login-page.tsx');

    it('มีกิ่งของการลงทะเบียน 2FA และเรนเดอร์ฟอร์มของมัน', () => {
        expect(page).toContain('mfaSetupRequired');
        expect(page).toContain('MfaEnrolmentForm');
    });

    it('ยังมีกิ่งเดิมของคนที่ตั้ง 2FA แล้ว — การเพิ่มกิ่งใหม่ต้องไม่ทับของเก่า', () => {
        expect(page).toContain('MfaChallengeForm');
        expect(page).toContain('mfaSession');
    });
});

describe('ฟอร์มลงทะเบียนเครื่องยืนยันตัวตน', () => {
    const form = read('app/auth/_components/mfa-enrolment-form.tsx');

    // เดิมตรึงว่าฟอร์มยิง '/identity/mfa/setup' ซึ่งหลังบ้านไม่ได้ mount — ทุกคำขอได้ 404 (security re-review
    // 2026-09-26-no-recovery-round34-review.md) เทสนั้นตรึงความผิดไว้ ใบนี้จึงตรึงที่ค่าคงที่ตัวเดียวกับหน้า
    // ความปลอดภัย และตรวจค่าคงที่นั้นกับ path ที่หลังบ้านประกาศจริง
    it('ยิงทั้งประตูขอรหัสลับ และประตูยืนยัน ผ่านค่าคงที่ตัวเดียวกับหน้าความปลอดภัย', () => {
        expect(form).toContain('providerApiPaths.mfaSetup');
        expect(form).toContain('providerApiPaths.mfaVerifySetup');
        expect(form).not.toMatch(/['"`]\/identity\/mfa\//);
    });

    it('ค่าคงที่นั้นคือ path ที่หลังบ้านเสิร์ฟจริง (อ่านจาก server.js + routes/api/index.js + identity/mfa.js)', () => {
        const BACKEND = path.resolve(SRC, '../../backend');
        const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
        const apiIndex = fs.readFileSync(path.join(BACKEND, 'routes/api/index.js'), 'utf8');
        const mfaRouter = fs.readFileSync(path.join(BACKEND, 'routes/api/identity/mfa.js'), 'utf8');

        const apiPrefix = server.match(/app\.use\('([^']+)',\s*apiRoutes\)/)?.[1];
        const mfaMount = apiIndex.match(/router\.use\('([^']+)',\s*require\('\.\/identity\/mfa'\)\)/)?.[1];
        expect(apiPrefix).toBe('/api');
        expect(mfaMount).toBeTruthy();
        expect(mfaRouter).toMatch(/router\.post\('\/setup'/);
        expect(mfaRouter).toMatch(/router\.post\('\/verify-setup'/);

        expect(providerApiPaths.mfaSetup).toBe(`${apiPrefix}${mfaMount}/setup`);
        expect(providerApiPaths.mfaVerifySetup).toBe(`${apiPrefix}${mfaMount}/verify-setup`);
    });

    it('ส่งตั๋ว setup_token ไปกับคำขอ — ตอนนั้นยังไม่มี session ปกติ', () => {
        expect(form).toMatch(/Authorization: `Bearer \$\{setupToken\}`/);
    });

    /**
     * รหัสสำรองคือทางเดียวที่จะเข้าระบบได้ถ้าทำเครื่องหาย และหลังบ้านแสดงครั้งเดียว
     * ("Show these once only") — หน้าจอที่ไม่แสดงมัน เท่ากับทิ้งมันไป
     */
    it('แสดงรหัสสำรองที่หลังบ้านคืนมา และบอกว่าจะไม่แสดงอีก', () => {
        expect(form).toContain('backupCodes');
        expect(form).toContain('ระบบจะไม่แสดงอีก');
    });

    it('ช่องกรอกรหัสรับเฉพาะตัวเลข 6 หลัก และเรียกแป้นตัวเลขบนมือถือ', () => {
        expect(form).toContain("inputMode=\"numeric\"");
        expect(form).toContain('maxLength={6}');
        expect(form).toMatch(/replace\(\/\\D\/g, ''\)/);
    });

    it('เป้ากดไม่ต่ำกว่า 44px ตามเกณฑ์ของโปรเจกต์', () => {
        expect(form).toContain('min-h-[48px]');
        expect(form).toContain('min-w-[44px]');
    });

    /**
     * verify-setup ไม่คืน session ตามสัญญาของมัน — หน้าจอต้องบอกความจริงว่าต้อง
     * เข้าสู่ระบบอีกครั้ง ไม่ใช่แกล้งพาเข้าไปโดยเก็บรหัสผ่านไว้ยิงซ้ำ
     */
    it('บอกผู้ใช้ว่าต้องเข้าสู่ระบบอีกครั้ง', () => {
        expect(form).toContain('กลับไปเข้าสู่ระบบ');
    });
});
