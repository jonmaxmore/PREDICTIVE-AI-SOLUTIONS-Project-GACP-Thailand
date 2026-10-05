/**
 * ปลูกได้เมื่อได้รับใบรับรองแล้ว — และคำปฏิเสธต้องไปถึงเกษตรกร
 *
 * มติ R-rules ของสเปก T&T: รอบการปลูกเริ่มบันทึกได้เมื่อมีใบรับรองที่ยังมีผลแล้วเท่านั้น
 * (`planting-tnt-spec-approved`: "planting locked until cert, QR after cert only") ·
 * `createCycle` บังคับข้อนี้จริง แต่โยน `new Error('Active certificate is required…')`
 * ซึ่งไม่มี `code` ⇒ ตัวจับข้อผิดพลาดของ route ตกไปที่ `res.status(500)` และเกษตรกรที่กด
 * "สร้างรอบการปลูกครั้งแรก" บนหน้าจอ เห็นเหมือนระบบพัง แทนที่จะเห็นว่าต้องได้ใบรับรองก่อน
 *
 * เดินจริง 2026-09-06: เกษตรกรที่ยังไม่มีใบรับรอง เปิด /health/planting แล้วหน้าจอเชิญให้
 * "สร้างรอบการปลูกครั้งแรก" — เชิญให้ทำสิ่งที่กติกาห้าม และห้ามด้วยข้อความที่เขาอ่านไม่ออก
 *
 * กติกาไม่เปลี่ยน · สิ่งที่เปลี่ยนคือการปฏิเสธมีรหัส มีสถานะที่ถูกต้อง และพูดภาษาที่ผู้ยื่นอ่านได้
 */
'use strict';

const { ERROR_CODES } = require('../../shared/error-codes');

describe('การปฏิเสธเรื่องใบรับรองของการสร้างรอบปลูก', () => {
    test('รหัสถูกลงทะเบียนไว้ พร้อมข้อความไทยและทางออก', () => {
        const row = ERROR_CODES.PLANTING_REQUIRES_CERTIFICATE;
        expect(row).toBeDefined();
        expect(row.httpStatus).toBe(409);
        expect(row.messageTh).toMatch(/ใบรับรอง/);
        // บอกลำดับที่ถูกต้อง ไม่ใช่แค่บอกว่าไม่ได้
        expect(row.messageTh).toMatch(/ยื่นคำขอ|ได้รับใบรับรอง/);
        expect(String(row.remediation || '')).not.toHaveLength(0);
    });

    test('เป็น 409 ไม่ใช่ 500 — สถานะที่ผู้ยื่นแก้ได้เอง ไม่ใช่ความผิดพลาดของเซิร์ฟเวอร์', () => {
        expect(ERROR_CODES.PLANTING_REQUIRES_CERTIFICATE.httpStatus).toBe(409);
    });

    test('บริการโยนข้อผิดพลาดที่ "มีรหัส" ไม่ใช่ Error เปล่า ๆ', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'planting-service.js'), 'utf8',
        );
        // Error เปล่าจะตกไปที่ 500 ของ route — เป็นเหตุผลทั้งหมดที่เทสนี้มีอยู่
        expect(src).not.toContain("throw new Error('Active certificate is required before creating planting cycle')");
        expect(src).toContain('PLANTING_REQUIRES_CERTIFICATE');
    });

    test('route ส่งรหัสนั้นออกไปจริง ไม่ได้กลืนเป็น 500', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'cultivation', 'planting-cycles.js'), 'utf8',
        );
        expect(src).toContain('PLANTING_REQUIRES_CERTIFICATE');
    });
});
