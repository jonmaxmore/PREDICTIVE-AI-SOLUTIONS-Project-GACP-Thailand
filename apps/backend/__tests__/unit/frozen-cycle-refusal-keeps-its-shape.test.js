/**
 * การปฏิเสธที่บริการเขียนไว้ ต้องออกไปทั้งรูป ไม่ใช่เหลือแต่ข้อความ
 *
 * `updateCycle` ปฏิเสธการแก้ข้อมูลที่หน้าสแกนสาธารณะประกาศไว้ หลังรอบปิดแล้ว และมันเขียน
 * การปฏิเสธนั้นไว้ครบสามส่วน: `code: 'CYCLE_FROZEN'` · `statusCode: 409` · `fields` ที่ถูกปฏิเสธ
 *
 * วัดจริง 2026-09-06: ยิง PATCH แก้ `varietyName` บนรอบที่เก็บเกี่ยวแล้ว → ข้อความไทยออกมาครบ
 * **แต่สถานะเป็น 400 และไม่มี `code` ติดมาด้วย** — route ตกลงไปที่กิ่งสุดท้ายที่ตอบ 400 เสมอ
 *
 * ทำไมต้องแก้: 400 แปลว่า "คำขอผิดรูป" ส่วน 409 แปลว่า "ชนกับสถานะของข้อมูล" ซึ่งเป็นเรื่องจริง
 * ที่เกิดขึ้น · และหน้าจอที่ต้องเลือกคำอธิบายควรอ่านจาก **ชนิด** ของการปฏิเสธ ไม่ใช่จากการ
 * จับคู่ข้อความ — บทเรียนเดียวกับที่ประตูยื่นคำขอเรียนไปแล้วเมื่อ 2026-09-05
 */
'use strict';

const { ERROR_CODES } = require('../../shared/error-codes');

describe('การปฏิเสธของรอบที่ปิดแล้ว', () => {
    test('CYCLE_FROZEN ลงทะเบียนไว้เป็น 409 พร้อมข้อความไทย', () => {
        const row = ERROR_CODES.CYCLE_FROZEN;
        expect(row).toBeDefined();
        expect(row.httpStatus).toBe(409);
        expect(row.messageTh).toMatch(/[ก-๙]/);
    });

    test('route ส่ง code และสถานะที่บริการตั้งไว้ออกไป ไม่ได้ยุบเหลือ 400', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'cultivation', 'planting-cycles.js'),
            'utf8',
        );
        // กิ่งสุดท้ายเคยเป็น `res.status(400)` เสมอ ไม่ว่าบริการจะตั้ง statusCode ไว้เท่าไร
        expect(src).toMatch(/error\?\.statusCode/);
        expect(src).toContain('CYCLE_FROZEN');
    });
});
