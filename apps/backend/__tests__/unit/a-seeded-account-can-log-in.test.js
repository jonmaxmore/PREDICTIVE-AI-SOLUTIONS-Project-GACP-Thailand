'use strict';

/**
 * บัญชีที่ seed สร้าง ต้องล็อกอินได้
 *
 * prisma/seed-gacp.js เขียนเลขลงคอลัมน์ *Hash อย่างเดียว ส่วนประตูล็อกอินค้นหาจาก *Hmac
 * เมื่อ AUTH_LOOKUP_USE_HMAC=true ⇒ ทุกบัญชีที่ seed สร้างบนเครื่องที่เปิดธง จะค้นหาไม่เจอ
 * ตั้งแต่วินาทีที่ถูกสร้าง · เป็นเหตุเดียวกับที่ทำให้ demo ล็อกอินไม่ได้ทั้งระบบ 2026-09-07
 * ต่างกันแค่แถวเก่าซ่อมด้วย backfill ส่วนแถวใหม่ต้องไม่เกิดปัญหาตั้งแต่แรก
 */

const {
    identityLookupColumns,
    AUTH_TYPE_HEALTH,
    AUTH_TYPE_PROVIDER,
} = require('../../services/auth/identity-lookup-columns');

const ON = { AUTH_LOOKUP_USE_HMAC: 'true' };
const OFF = { AUTH_LOOKUP_USE_HMAC: 'false' };
const A_PROVIDER_ID = '2222222222223';
const A_HEALTH_ID = '1186494077533';

describe('คอลัมน์ค้นหาที่ต้องเขียนคู่กับเลขประจำตัว', () => {
    it('ธงเปิด: เขียนคอลัมน์ที่ล็อกอินใช้จริงด้วย ไม่ใช่แค่ของเดิม', () => {
        const cols = identityLookupColumns(A_PROVIDER_ID, AUTH_TYPE_PROVIDER, ON);
        expect(cols.providerIdHmac).toBeTruthy();
        expect(cols.idCardHmac).toBeTruthy();
        expect(cols.healthIdHmac).toBeNull();
        expect(cols.providerIdHash).toBeTruthy();
    });

    it('เกษตรกรลงคอลัมน์ฝั่งเลขบัตร ไม่ใช่ฝั่งรหัสพนักงาน', () => {
        const cols = identityLookupColumns(A_HEALTH_ID, AUTH_TYPE_HEALTH, ON);
        expect(cols.healthIdHmac).toBeTruthy();
        expect(cols.providerIdHmac).toBeNull();
        expect(cols.healthIdHash).toBe(cols.idCardHash);
    });

    it('ธงปิด: รูปร่างเหมือนของเดิมทุกประการ ไม่มีคีย์ *Hmac โผล่มา', () => {
        const cols = identityLookupColumns(A_PROVIDER_ID, AUTH_TYPE_PROVIDER, OFF);
        expect(Object.keys(cols).sort()).toEqual(['healthIdHash', 'idCardHash', 'providerIdHash']);
    });

    it('ไม่มีเลข = ไม่มีคอลัมน์ค้นหา', () => {
        expect(identityLookupColumns(null, AUTH_TYPE_HEALTH, ON))
            .toEqual({ idCardHash: null, healthIdHash: null, providerIdHash: null });
    });

    it('ประตูสมัครสมาชิกกับ seed ถามที่เดียวกัน — ไม่ใช่ต่างคนต่างคิดเอง', () => {
        const read = (rel) => require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', rel), 'utf8',
        );
        expect(read('services/prisma-auth-service.js')).toContain('identityLookupColumns');
        expect(read('prisma/seed-gacp.js')).toContain('identityLookupColumns');
    });
});
