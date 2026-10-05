'use strict';

/**
 * คำปฏิเสธที่ผู้ตรวจแปลงได้รับ ต้องบอกทางที่ "ผู้ตรวจแปลง" เดินได้
 *
 * เดินจริงบน staging 2026-09-07 กับคำขอที่ผ่านการตรวจแปลงแล้ว
 * (APP-2569-MTPZQ1HZ-582D1F · AUDIT_CONFIRMED):
 *
 *   POST /provider/auditor/applications/:id/audit-decisions {decision:'PASS'}
 *     → 422 CERTIFICATE_FARM_LOCATION_MISSING
 *       "…ขาด ที่อยู่ · กรุณาแก้ไขข้อมูลที่ตั้งฟาร์มในคำขอให้ครบถ้วนก่อนออกใบรับรอง"
 *
 * ประโยคนั้นสั่งให้ "ไปแก้ข้อมูลฟาร์ม" — แต่คนที่อ่านมันคือผู้ตรวจแปลง ซึ่งแก้ไม่ได้:
 * PATCH /api/farms/:id เฝ้าด้วย authenticateHealth และผูกกับ req.user.id ของเจ้าของฟาร์ม
 * (cultivation/farms.js:218) · ผู้ตรวจจึงชนกำแพงที่มีป้ายชี้ไปยังประตูที่เขาเปิดไม่ได้
 * และเจ้าของฟาร์มไม่มีทางรู้ว่ามีอะไรค้างอยู่
 *
 * ทางที่ผู้ตรวจมีจริงคือ CAR — AUDIT_CONFIRMED → CAR_PENDING ส่งข้อบกพร่องกลับไปให้
 * เกษตรกรแก้แล้วยื่นกลับมา (workflow-transition-service.js:72) · คำปฏิเสธไม่เคยพูดถึงมัน
 *
 * ชั้นของคำตอบ: service บอก "ข้อเท็จจริง" ว่าอะไรขาด · ประตูบอก "ทางออกที่ประตูนี้มี"
 */

const { auditDecisionErrorResponse } = require('../../services/audit-decision-error-response');

function refusalFromCertificateService() {
    const err = new Error(
        'ไม่สามารถออกใบรับรองได้ เนื่องจากข้อมูลที่ตั้งฟาร์มไม่ครบถ้วน (ขาด ที่อยู่) '
        + 'กรุณาแก้ไขข้อมูลที่ตั้งฟาร์มในคำขอให้ครบถ้วนก่อนออกใบรับรอง',
    );
    err.code = 'CERTIFICATE_FARM_LOCATION_MISSING';
    err.statusCode = 422;
    err.missingFields = ['address'];
    return err;
}

describe('คำปฏิเสธตอนตัดสินผลตรวจแปลง', () => {
    it('ยังบอกข้อเท็จจริงเดิมว่าอะไรขาด', () => {
        const res = auditDecisionErrorResponse(refusalFromCertificateService());
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('CERTIFICATE_FARM_LOCATION_MISSING');
        expect(res.body.messageTh).toContain('ที่ตั้งฟาร์ม');
    });

    it('บอกทางที่ผู้ตรวจเดินได้จริง — ส่งกลับให้เกษตรกรแก้', () => {
        const res = auditDecisionErrorResponse(refusalFromCertificateService());
        expect(res.body.messageTh).toMatch(/ส่งกลับให้ผู้ยื่น|ขอให้แก้ไข|CAR/);
    });

    it('ไม่สั่งให้ผู้ตรวจไปแก้ข้อมูลฟาร์มเอง ซึ่งเขาไม่มีสิทธิ์', () => {
        const res = auditDecisionErrorResponse(refusalFromCertificateService());
        expect(res.body.messageTh).not.toMatch(/กรุณาแก้ไขข้อมูลที่ตั้งฟาร์มในคำขอ/);
    });

    it('คำปฏิเสธอื่นที่ไม่เกี่ยวกับข้อมูลของผู้ยื่น ไม่ถูกเติมประโยคนี้', () => {
        const err = new Error('ลายเซ็นดิจิทัลใช้ไม่ได้');
        err.code = 'CERTIFICATE_SIGNING_UNAVAILABLE';
        err.statusCode = 422;
        const res = auditDecisionErrorResponse(err);
        expect(res.body.messageTh).toBe('ลายเซ็นดิจิทัลใช้ไม่ได้');
    });
});
