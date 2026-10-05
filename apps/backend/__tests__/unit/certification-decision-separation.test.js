'use strict';
/**
 * F-CERT-SOD — การตัดสินให้การรับรอง ต้องไม่ใช่คนเดียวกับผู้ประเมิน
 *
 * operator ตั้งข้อสงสัยเอง 2026-09-10: "ตอนแรกคนลงพื้นที่ออกได้เอง แต่ผมคิดว่าไม่น่าถูกต้อง"
 * โค้ดยอมรับไว้เองว่าเคยมีด่านนี้แล้วถูกถอด — services/workflow-transition-service.js:148
 * เขียนว่า "The former two-person ISO/IEC 17065 §7.6 SoD gate on AUDIT_PASSED->APPROVED
 * was REMOVED: … NO second auditor and NO approver≠evaluator constraint"
 *
 * ISO/IEC 17065 §7.6 คือข้อกำหนดที่หน่วยรับรองต้องปฏิบัติ: การตัดสินให้การรับรองต้องทำโดย
 * ผู้ที่ไม่ได้ดำเนินการประเมิน · แพลตฟอร์มที่ออกใบรับรองมาตรฐานให้ผู้อื่น แต่ตัวเองไม่มีด่านนี้
 * คือข้อแรกที่ผู้ตรวจภายนอกจะหยิบขึ้นมา
 *
 * ไฟล์นี้ตรึง "กฎ" อย่างเดียว — ไม่แตะฐานข้อมูล ไม่ render อะไร จึงตรวจได้ครบทุกทาง
 * การเดินสายจริงเข้า writeApplicationStatus ตรึงไว้อีกใบ (integration บน Postgres จริง)
 *
 * ตัวตนที่ใช้ตัดสิน มีอยู่ในสคีมาแล้ว ไม่ต้อง migration:
 *   Application.auditorId    = ผู้ประเมินหน้างาน (เซ็ตตอนจัดตาราง — audit-scheduling-service.js:907)
 *   Application.headAuditorId = ผู้ตัดสินให้การรับรอง (ว่างอยู่ ตั้งแต่ด่านสองคนถูกถอด)
 */

const {
    certificationDecisionRefusal,
    CERT_DECISION_REFUSALS,
} = require('../../services/certification-decision-separation');

/** คำขอที่ผ่านการประเมินแล้ว โดยผู้ประเมินชื่อ AUD-1 */
const evaluated = { id: 'app-1', status: 'AUDIT_PASSED', auditorId: 'AUD-1', headAuditorId: null };

describe('ใครตัดสินให้การรับรองได้', () => {
    test('คนอื่นที่ไม่ใช่ผู้ประเมิน อนุมัติได้', () => {
        expect(certificationDecisionRefusal({
            application: evaluated, actorId: 'APPROVER-9', actorRole: 'certificate_approver',
        })).toBeNull();
    });

    test('ผู้ประเมินคนเดิม อนุมัติไม่ได้ — นี่คือหัวใจของ §7.6', () => {
        expect(certificationDecisionRefusal({
            application: evaluated, actorId: 'AUD-1', actorRole: 'certificate_approver',
        })).toBe(CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE);
    });

    test('ถือบทบาทผู้อนุมัติ ก็ไม่ช่วยถ้าเป็นคนประเมินเอง', () => {
        // บทบาทกับตัวตนเป็นคนละเรื่อง · การให้บทบาทกับตัวเองต้องไม่ปลดล็อกข้อนี้
        expect(certificationDecisionRefusal({
            application: evaluated, actorId: 'AUD-1', actorRole: 'admin',
        })).toBe(CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE);
    });
});

describe('เมื่อระบบไม่รู้ว่าใครประเมิน', () => {
    test('ไม่มีผู้ประเมินบันทึกไว้ = ปฏิเสธ ไม่ใช่ปล่อยผ่าน', () => {
        // ด่านความปลอดภัยที่เปิดผ่านเมื่อข้อมูลหาย ไม่ใช่ด่าน
        expect(certificationDecisionRefusal({
            application: { ...evaluated, auditorId: null }, actorId: 'APPROVER-9', actorRole: 'certificate_approver',
        })).toBe(CERT_DECISION_REFUSALS.EVALUATOR_UNKNOWN);
    });

    test('ผู้ประเมินเป็นสตริงว่าง ก็นับว่าไม่รู้เหมือนกัน', () => {
        expect(certificationDecisionRefusal({
            application: { ...evaluated, auditorId: '   ' }, actorId: 'APPROVER-9', actorRole: 'certificate_approver',
        })).toBe(CERT_DECISION_REFUSALS.EVALUATOR_UNKNOWN);
    });

    test('ไม่รู้ว่าใครกำลังอนุมัติ = ปฏิเสธเช่นกัน', () => {
        expect(certificationDecisionRefusal({
            application: evaluated, actorId: null, actorRole: 'certificate_approver',
        })).toBe(CERT_DECISION_REFUSALS.DECIDER_UNKNOWN);
    });
});

describe('การเทียบตัวตน', () => {
    test('ตัวพิมพ์และช่องว่างไม่ทำให้กลายเป็นคนละคน', () => {
        expect(certificationDecisionRefusal({
            application: { ...evaluated, auditorId: ' aud-1 ' }, actorId: 'AUD-1', actorRole: 'certificate_approver',
        })).toBe(CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE);
    });

    test('คนละคนจริง ๆ ผ่าน', () => {
        expect(certificationDecisionRefusal({
            application: { ...evaluated, auditorId: 'AUD-2' }, actorId: 'AUD-1', actorRole: 'certificate_approver',
        })).toBeNull();
    });
});

describe('SYSTEM ไม่ใช่ทางลัด', () => {
    test('actor ที่เป็นระบบ ตัดสินให้การรับรองแทนคนไม่ได้', () => {
        // การอนุมัติเป็นการตัดสินของมนุษย์ตามข้อกำหนด · ถ้าปล่อยให้ SYSTEM ทำได้
        // งานเบื้องหลังใบไหนก็ออกใบรับรองได้โดยไม่มีใครรับผิดชอบ
        expect(certificationDecisionRefusal({
            application: evaluated, actorId: 'SYSTEM', actorRole: 'system',
        })).toBe(CERT_DECISION_REFUSALS.SYSTEM_CANNOT_DECIDE);
    });
});

describe('รหัสการปฏิเสธ', () => {
    test('ทุกรหัสมีข้อความไทยที่บอกว่าต้องทำอะไรต่อ', () => {
        const { CERT_DECISION_MESSAGES_TH } = require('../../services/certification-decision-separation');
        for (const code of Object.values(CERT_DECISION_REFUSALS)) {
            const msg = CERT_DECISION_MESSAGES_TH[code];
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(20);
            // ข้อความต้องไม่ใช่การพ่นรหัสกลับไป
            expect(msg).not.toContain(code);
        }
    });
});
