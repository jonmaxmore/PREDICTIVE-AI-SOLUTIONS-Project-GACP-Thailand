/**
 * หน้าล้าง session ล้างของเกษตรกรไม่ได้เลย
 *
 * หน้านี้มีหน้าที่เดียว: ตัด session ทิ้งให้หมด · มันเรียกสองประตู
 *   POST /api/auth/provider/logout   ✅ มีจริง (auth-provider.js:299)
 *   POST /api/auth/logout            ❌ ไม่มีเราเตอร์นี้ — index.js แขวนแค่ /auth/health,
 *                                       /auth/provider, /auth/idp (ยืนยันด้วยการกดจริง: 404)
 *
 * ประตูของเกษตรกรคือ POST /api/auth/health/logout ซึ่งมีอยู่จริง (auth-health.js:149)
 * และไม่เคยถูกเรียกจากหน้านี้เลย
 *
 * ผลที่ตามมาไม่ใช่แค่โค้ดตาย: หน้านี้ล้าง localStorage กับคุกกี้ฝั่งเบราว์เซอร์ได้ แต่คุกกี้
 * httpOnly ของเกษตรกรยังอยู่ และที่สำคัญกว่านั้น การ logout จริงคือสิ่งที่เขียน jti ลง
 * blocklist ใน Redis — ไม่เรียก แปลว่าโทเคนใบนั้น **ยังใช้ได้ต่อจนกว่าจะหมดอายุเอง**
 * บนเครื่องสาธารณะที่คนกด "ออกจากระบบ" แล้วลุกไป นี่คือ session ที่ยังเปิดค้างไว้
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');

describe('หน้าล้าง session', () => {
    it('เรียกประตูออกจากระบบของเกษตรกรที่มีอยู่จริง', () => {
        expect(SRC).toContain('/api/auth/health/logout');
    });

    it('ยังเรียกประตูของพนักงานเหมือนเดิม', () => {
        expect(SRC).toContain('/api/auth/provider/logout');
    });

    it('ไม่เรียกเราเตอร์ที่ไม่มีอยู่จริงอีกต่อไป', () => {
        expect(SRC).not.toMatch(/['"]\/api\/auth\/logout['"]/);
    });
});
