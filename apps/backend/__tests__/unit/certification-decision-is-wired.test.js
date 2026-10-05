'use strict';
/**
 * F-CERT-SOD (การเดินสาย) — ด่านแยกหน้าที่ต้องอยู่ตรงที่รถวิ่งจริง
 *
 * กฎเองถูกตรึงไว้แล้วที่ `certification-decision-separation.test.js` · ใบนี้ตรึงคนละเรื่อง:
 * **ประตูที่อนุมัติจริงเรียกกฎนั้นหรือเปล่า**
 *
 * ทำไมต้องแยกใบ: บทเรียนซ้ำของ repo นี้คือด่านที่ประกาศไว้ถูกที่ แต่ไม่ได้อยู่บนเส้นทางที่
 * มีคนเดินจริง · `routes/api/provider/auditor.js:136-137` เขียนไว้เองว่า *"this route updates
 * the row directly … writeApplicationStatus is never called"* ⇒ ด่านที่วางไว้ใน writer
 * อย่างเดียวจะพลาดเส้นทางอนุมัติเส้นเดียวที่มีอยู่จริงในระบบ
 *
 * จุดร่วมที่ทั้งสองเส้นผ่านคือ `buildTransitionUpdate` ซึ่งรับ application + actorId มาแล้ว
 * และ query ของประตูก็โหลด `auditorId` มาให้แล้วด้วย พร้อมคอมเมนต์ที่ยังชี้มาที่ด่านนี้
 * (`application-provider-query-methods.js:698-700`) — สายไฟถูกทิ้งไว้ตอนที่ด่านถูกถอด
 */

const workflowTransitionService = require('../../services/workflow-transition-service');
const { CERT_DECISION_REFUSALS } = require('../../services/certification-decision-separation');

/** คำขอที่ผ่านการประเมินหน้างานแล้ว โดยผู้ประเมิน AUD-1 */
function passedApplication(overrides = {}) {
    return {
        status: 'AUDIT_PASSED',
        formData: {},
        workflowHistory: [],
        auditorId: 'AUD-1',
        ...overrides,
    };
}

const approve = (args) => workflowTransitionService.buildTransitionUpdate({
    application: passedApplication(),
    toState: 'APPROVED',
    comment: 'ตรวจครบถ้วน อนุมัติ',
    ...args,
});

describe('ประตูอนุมัติเรียกด่านแยกหน้าที่', () => {
    // actorRole เป็น certificate_approver ทุกเคสตั้งแต่ 2026-09-10 — ด่านชั้นบทบาท
    // (canRoleTransition) ปฏิเสธผู้ตรวจประเมินแปลงไปก่อนถึงด่านนี้แล้ว ถ้าใช้ 'auditor'
    // เทสจะเขียวด้วยเหตุผลผิด: มันจะพิสูจน์ด่านชั้นแรก ไม่ใช่ด่านแยกหน้าที่ที่ไฟล์นี้ตรึง
    it('ผู้ประเมินคนเดิมกดอนุมัติเอง ต้องถูกปฏิเสธ', () => {
        expect(() => approve({ actorId: 'AUD-1', actorRole: 'certificate_approver' }))
            .toThrow(new RegExp(CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE));
    });

    it('เจ้าหน้าที่คนอื่นอนุมัติได้ตามปกติ', () => {
        const t = approve({ actorId: 'AUD-2', actorRole: 'certificate_approver' });
        expect(t.nextState).toBe('APPROVED');
    });

    it('คำขอที่ไม่มีบันทึกผู้ประเมิน อนุมัติไม่ได้ — ไม่ใช่ปล่อยผ่าน', () => {
        expect(() => workflowTransitionService.buildTransitionUpdate({
            application: passedApplication({ auditorId: null }),
            toState: 'APPROVED', actorId: 'AUD-2', actorRole: 'certificate_approver',
            comment: 'ตรวจครบถ้วน อนุมัติ',
        })).toThrow(new RegExp(CERT_DECISION_REFUSALS.EVALUATOR_UNKNOWN));
    });

    it('force ของ admin ก็ข้ามด่านนี้ไม่ได้', () => {
        // force มีไว้แก้สถานะที่ติดค้าง ไม่ใช่ไว้ออกใบรับรองแทนกระบวนการ
        expect(() => workflowTransitionService.buildTransitionUpdate({
            application: passedApplication(),
            toState: 'APPROVED', actorId: 'AUD-1', actorRole: 'system_admin_dtam', force: true,
            comment: 'ตรวจครบถ้วน อนุมัติ',
        })).toThrow(new RegExp(CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE));
    });

    it('ด่านนี้บังคับเฉพาะขาเข้า APPROVED ไม่ไปขวางการเดินสถานะอื่น', () => {
        const t = workflowTransitionService.buildTransitionUpdate({
            application: { status: 'AUDIT_CONFIRMED', formData: {}, workflowHistory: [], auditorId: 'AUD-1' },
            toState: 'AUDIT_PASSED', actorId: 'AUD-1', actorRole: 'field_inspector',
            comment: 'ผลตรวจผ่าน',
        });
        expect(t.nextState).toBe('AUDIT_PASSED');
    });

    it('ผู้อนุมัติถูกบันทึกไว้ว่าเป็นใคร — ไม่ใช่แค่ปล่อยผ่านเงียบ ๆ', () => {
        const t = approve({ actorId: 'AUD-2', actorRole: 'certificate_approver' });
        expect(t.updateData.headAuditorId).toBe('AUD-2');
    });
});
