/**
 * น้ำหนักและวันเก็บเกี่ยวถูกแช่แข็งเมื่อบรรจุล็อตแล้ว — และนั่นคือกันการฟอกของ:
 * แปลงที่ได้รับรองหนึ่งแปลง ซื้อของนอกระบบเข้ามา แก้น้ำหนักที่ประกาศให้สูงขึ้น แล้วออกรหัสให้
 * ของทั้งหมด · โควตาน้ำหนักตรวจถูกอยู่แล้ว สิ่งที่พังคือ "เพดาน" ที่แก้ได้ตลอดเวลา
 * (harvest-service.js — FROZEN_ONCE_PACKED)
 *
 * บริการปฏิเสธเสียงดังแล้ว: 409 + code HARVEST_FROZEN_AFTER_PACKING + บอกว่าฟิลด์ไหนถูกห้าม
 * และคอมเมนต์ในนั้นเขียนเหตุผลไว้เอง — "Refuse loudly rather than dropping the keys silently"
 *
 * แต่ประตูกลืนมันเป็น 500 "Failed to update batch" (routes/.../harvest-batches.js:475)
 * เกษตรกรจึงเห็นข้อความอังกฤษที่ไม่บอกอะไรเลย ไม่รู้ว่าถูกห้ามเพราะอะไร และไม่รู้ว่าต้องทำอะไรต่อ
 * ⇒ การปฏิเสธที่คนอ่านไม่รู้เรื่อง คือการปฏิเสธที่ไปไม่ถึงคน (เจอตอนกดจริง 2026-09-07)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROUTE = path.join(__dirname, '..', '..', 'routes', 'api', 'cultivation', 'harvest-batches.js');
const SERVICE = path.join(__dirname, '..', '..', 'services', 'harvest-service.js');

describe('การแช่แข็งน้ำหนักหลังบรรจุ ต้องบอกเกษตรกรว่าเกิดอะไรขึ้น', () => {
    const route = fs.readFileSync(ROUTE, 'utf8');
    const service = fs.readFileSync(SERVICE, 'utf8');

    it('บริการยังปฏิเสธด้วยรหัสและสถานะของมันเอง', () => {
        expect(service).toContain('HARVEST_FROZEN_AFTER_PACKING');
        expect(service).toContain('statusCode = 409');
    });

    it('ประตูส่งสถานะและรหัสของบริการต่อ ไม่กลืนเป็น 500', () => {
        const updateHandler = route.slice(
            route.indexOf("router.put('/:id'"),
            route.indexOf("router.post('/:id/harvest'"),
        );
        // ต้องไม่ตอบ 500 แบบเหมาโหลกับข้อผิดพลาดที่มีสถานะของตัวเอง
        expect(updateHandler).toMatch(/error\??\.statusCode/);
        expect(updateHandler).toContain('ERROR_CODES[error.code]');
    });

    it('ข้อความที่เกษตรกรได้อ่านเป็นภาษาไทย และบอกว่าต้องทำอะไรต่อ', () => {
        const updateHandler = route.slice(
            route.indexOf("router.put('/:id'"),
            route.indexOf("router.post('/:id/harvest'"),
        );
        expect(updateHandler).toMatch(/[ก-๙]/);
        expect(updateHandler).toMatch(/ฟอกของ|เกษตรกร|ปฏิเสธ/);
    });

    it('รหัสนี้อยู่ในสารบบข้อผิดพลาด พร้อมวิธีแก้', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        const row = ERROR_CODES.HARVEST_FROZEN_AFTER_PACKING;
        expect(row).toBeDefined();
        expect(row.httpStatus).toBe(409);
        expect(row.messageTh).toMatch(/[ก-๙]/);
        expect(String(row.remediation || '').length).toBeGreaterThan(40);
    });
});
