'use strict';

/**
 * เปิดธงค้นหาด้วย HMAC ก่อนเติมคอลัมน์ = ทุกบัญชีเก่าเข้าระบบไม่ได้ และไม่มีใครรู้
 *
 * วัดจริงบน demo 2026-09-07: AUTH_LOOKUP_USE_HMAC=true แต่ backfill ไม่เคยรัน
 * ⇒ เกษตรกร 3 + พนักงาน 5 = ทุกบัญชีที่มีอยู่ ค้นหาไม่เจอ · ผู้ใช้เห็นแค่ "ไม่พบผู้ใช้งาน
 * หรือรหัสผ่านไม่ถูกต้อง" ซึ่งชี้ไปผิดทางสนิท เพราะรหัสผ่านถูกต้อง
 */

const {
    checkLookupColumnsBackfilled,
    describeMissing,
    hmacLookupEnabled,
    LOOKUP_COLUMN_PAIRS,
} = require('../../services/auth/lookup-column-readiness');

/** prisma ปลอมที่ตอบจำนวนแถวตามที่กำหนดต่อคอลัมน์ค้นหา */
function prismaAnswering(missingByLookupColumn) {
    return {
        user: {
            count: jest.fn(async ({ where }) => {
                const lookupColumn = Object.keys(where).find((k) => where[k] === null);
                return missingByLookupColumn[lookupColumn] || 0;
            }),
        },
    };
}

const ON = { AUTH_LOOKUP_USE_HMAC: 'true' };
const OFF = { AUTH_LOOKUP_USE_HMAC: 'false' };

describe('ความพร้อมของคอลัมน์ที่ประตูล็อกอินใช้ค้นหา', () => {
    it('ธงเปิด + ยังมีแถวที่ไม่มีค่าค้นหา = ไม่ผ่าน และบอกว่าคอลัมน์ไหนกี่แถว', async () => {
        const result = await checkLookupColumnsBackfilled(
            prismaAnswering({ healthIdHmac: 3, providerIdHmac: 5, idCardHmac: 8 }), ON,
        );

        expect(result.ok).toBe(false);
        expect(result.enabled).toBe(true);
        expect(result.missing).toEqual([
            { column: 'healthId', rows: 3 },
            { column: 'providerId', rows: 5 },
            { column: 'idCard', rows: 8 },
        ]);
    });

    it('ข้อความที่ตะโกนออกมา บอกทั้งผลกระทบและคำสั่งซ่อม', () => {
        const text = describeMissing([{ column: 'providerId', rows: 5 }]);
        expect(text).toContain('providerId=5');
        expect(text).toContain('cannot log in');
        expect(text).toContain('backfill-national-id-hmac.js');
    });

    it('ธงเปิด + เติมครบแล้ว = ผ่าน', async () => {
        const result = await checkLookupColumnsBackfilled(prismaAnswering({}), ON);
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
    });

    it('ธงปิด = ไม่ถามฐานข้อมูลเลย เพราะยังค้นหาด้วยคอลัมน์เดิม', async () => {
        const prisma = prismaAnswering({ healthIdHmac: 99 });
        const result = await checkLookupColumnsBackfilled(prisma, OFF);

        expect(result.ok).toBe(true);
        expect(result.enabled).toBe(false);
        expect(prisma.user.count).not.toHaveBeenCalled();
    });

    it('นับเฉพาะแถวที่ยังไม่ถูกลบ — เงื่อนไขเดียวกับ assertion ปิดท้ายของสคริปต์เติมค่า', async () => {
        const prisma = prismaAnswering({});
        await checkLookupColumnsBackfilled(prisma, ON);

        for (const call of prisma.user.count.mock.calls) {
            expect(call[0].where.isDeleted).toBe(false);
        }
    });

    it('ดูครบทั้งห้าคู่คอลัมน์ที่สคริปต์เติม', async () => {
        const prisma = prismaAnswering({});
        await checkLookupColumnsBackfilled(prisma, ON);
        expect(prisma.user.count).toHaveBeenCalledTimes(LOOKUP_COLUMN_PAIRS.length);
        expect(hmacLookupEnabled(ON)).toBe(true);
    });

    it('เซิร์ฟเวอร์เรียกด่านนี้ตอนบูต ไม่ใช่มีไว้เฉย ๆ', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'server.js'), 'utf8');
        expect(src).toContain('checkLookupColumnsBackfilled');
    });
});
