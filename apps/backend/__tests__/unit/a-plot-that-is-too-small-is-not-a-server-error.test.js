'use strict';

/**
 * "แปลงเล็กกว่าที่ขอใช้" คือคำปฏิเสธตามกฎ ไม่ใช่เซิร์ฟเวอร์พัง
 *
 * กดจริงบน staging 2026-09-07 — เกษตรกรสร้างรอบปลูกแรกของตัวเอง:
 *   POST /api/planting-cycles  → 500 {"error":"Failed to create planting cycle"}
 * ใน log ของเซิร์ฟเวอร์เขียนเหตุผลจริงไว้ครบ:
 *   "Allocated area for plot แปลงหลัก exceeds plot size"
 *
 * ⇒ ระบบรู้ว่าทำไม แต่บอกเกษตรกรว่า "ล้มเหลว" เป็นภาษาอังกฤษ ไม่มีทางรู้ว่าต้องแก้อะไร
 * และ 500 ยังบอกผิดชนิดด้วย: มันแปลว่าเซิร์ฟเวอร์พัง ทั้งที่เซิร์ฟเวอร์ทำงานถูกทุกอย่าง
 *
 * ด่านตรวจเหล่านี้ (planting-service.js:255-270) คือกฎธุรกิจ — พื้นที่ที่ขอใช้เกินแปลง,
 * พื้นที่เป็นศูนย์, จำนวนต้นเป็นศูนย์, แปลงไม่มีอยู่ — ทุกข้อคือสิ่งที่ผู้ใช้แก้ได้เอง
 * จึงต้องเป็น 400 พร้อมเหตุผลภาษาไทย
 */

const { classifyCycleValidationError } = require('../../services/planting-cycle-refusals');

describe('คำปฏิเสธตอนสร้างรอบปลูก', () => {
    it('พื้นที่ที่ขอใช้เกินแปลง → 400 พร้อมเหตุผลภาษาไทยที่บอกชื่อแปลง', () => {
        const r = classifyCycleValidationError(new Error('Allocated area for plot แปลงหลัก exceeds plot size'));
        expect(r).toBeTruthy();
        expect(r.status).toBe(400);
        expect(r.code).toBe('CYCLE_PLOT_AREA_EXCEEDED');
        expect(r.messageTh).toContain('แปลงหลัก');
        expect(r.messageTh).toMatch(/[ก-๙]/);
    });

    it('พื้นที่เป็นศูนย์ และจำนวนต้นเป็นศูนย์ ก็เป็นคำปฏิเสธเหมือนกัน', () => {
        expect(classifyCycleValidationError(new Error('Allocated area must be greater than 0 sqm')).status).toBe(400);
        expect(classifyCycleValidationError(new Error('plannedPlantCount must be greater than 0')).status).toBe(400);
    });

    it('แปลงที่ไม่มีอยู่ ก็เป็นคำปฏิเสธ ไม่ใช่เซิร์ฟเวอร์พัง', () => {
        const r = classifyCycleValidationError(new Error('Plot assignment references unknown plot'));
        expect(r.status).toBe(400);
        expect(r.messageTh).toMatch(/[ก-๙]/);
    });

    it('ข้อผิดพลาดจริงของระบบ ยังเป็น 500 เหมือนเดิม — ไม่กลบของที่พังจริง', () => {
        expect(classifyCycleValidationError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBeNull();
        expect(classifyCycleValidationError(new TypeError('x is not a function'))).toBeNull();
    });

    it('ประตูใช้ตัวจำแนกนี้ ไม่ได้ปล่อยทุกอย่างเป็น 500', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'cultivation', 'planting-cycles.js'), 'utf8',
        );
        expect(src).toContain('classifyCycleValidationError');
    });
});
