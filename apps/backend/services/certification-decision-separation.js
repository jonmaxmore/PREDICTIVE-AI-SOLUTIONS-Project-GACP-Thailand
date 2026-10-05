'use strict';
/**
 * การตัดสินให้การรับรอง ต้องไม่ใช่คนเดียวกับผู้ประเมิน (ISO/IEC 17065 §7.6)
 *
 * ทำไมไฟล์นี้ถึงกลับมา: ด่านนี้เคยมีอยู่แล้วถูกถอดออกโดยมติผลิตภัณฑ์ 2026-06-05 —
 * `workflow-transition-service.js` เขียนไว้เองว่า "single-auditor auto-issue … The former
 * two-person ISO/IEC 17065 §7.6 SoD gate on AUDIT_PASSED->APPROVED was REMOVED: … NO second
 * auditor and NO approver≠evaluator constraint" · ผลคือผู้ตรวจหน้างานคนเดียวถือสามอำนาจ:
 * บันทึกผลตรวจ · อนุมัติ · ออกใบ — และยังย้อนล้มใบที่ตัวเองออกได้ · operator ทักเองเมื่อ
 * 2026-09-10 ว่า "ไม่น่าถูกต้อง" (ledger F-CERT-SOD)
 *
 * เรื่องนี้ไม่ใช่ความเนี้ยบ: §7.6 คือข้อกำหนดที่หน่วยรับรองต้องปฏิบัติ แพลตฟอร์มที่ออก
 * ใบรับรองมาตรฐานให้ผู้อื่นแต่ตัวเองไม่มีด่านนี้ คือข้อแรกที่ผู้ตรวจภายนอกจะหยิบขึ้นมา
 *
 * ตัวตนที่ใช้ตัดสิน มีอยู่ในสคีมาแล้ว — ไม่ต้อง migration:
 *   Application.auditorId     ผู้ประเมินหน้างาน (เซ็ตตอนจัดตาราง audit-scheduling-service.js:907)
 *   Application.headAuditorId ผู้ตัดสินให้การรับรอง — ว่างมาตั้งแต่ด่านสองคนถูกถอด
 *                             (ชื่อคอลัมน์คือซากของด่านเดิม: transition service เขียนว่า
 *                             'Consolidated from HEAD_AUDITOR')
 *
 * ทำไมอ่านจากคอลัมน์บนแถวคำขอ ไม่ใช่จาก AuditLog: writer กลืนความล้มเหลวของ audit ไว้โดย
 * เจตนา ("audit-log availability MUST NOT block status writes") ⇒ ถ้าด่านนี้อ่านจาก log
 * แถวที่หายไปหนึ่งแถวจะกลายเป็น "ไม่พบว่าใครประเมิน" แล้วปล่อยผ่าน · ด่านที่เปิดผ่านเมื่อ
 * ข้อมูลหาย ไม่ใช่ด่าน
 *
 * ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล เพื่อให้ตรวจได้ครบทุกทางในเทสหน่วย
 * การเดินสายจริงเข้า writeApplicationStatus ตรึงไว้อีกใบด้วย Postgres จริง
 */

/** เหตุผลที่ปฏิเสธการอนุมัติ — คงที่ ใช้เป็นรหัสในคำตอบของ API ได้ */
const CERT_DECISION_REFUSALS = Object.freeze({
    /** ผู้ที่ประเมินเอง จะตัดสินให้การรับรองเองไม่ได้ */
    EVALUATOR_CANNOT_DECIDE: 'EVALUATOR_CANNOT_DECIDE',
    /** ไม่มีบันทึกว่าใครเป็นผู้ประเมิน จึงพิสูจน์การแยกหน้าที่ไม่ได้ */
    EVALUATOR_UNKNOWN: 'EVALUATOR_UNKNOWN',
    /** ไม่รู้ว่าใครกำลังตัดสิน */
    DECIDER_UNKNOWN: 'DECIDER_UNKNOWN',
    /** ระบบอัตโนมัติตัดสินให้การรับรองแทนคนไม่ได้ */
    SYSTEM_CANNOT_DECIDE: 'SYSTEM_CANNOT_DECIDE',
});

/** ข้อความที่คนอ่าน — บอกเหตุและสิ่งที่ต้องทำต่อ ไม่ใช่พ่นรหัสกลับไป */
const CERT_DECISION_MESSAGES_TH = Object.freeze({
    [CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE]:
        'ผู้ที่ลงพื้นที่ประเมินคำขอนี้ จะเป็นผู้ตัดสินให้การรับรองเองไม่ได้ '
        + 'กรุณาให้เจ้าหน้าที่ผู้อนุมัติท่านอื่นเป็นผู้ตัดสิน',
    [CERT_DECISION_REFUSALS.EVALUATOR_UNKNOWN]:
        'คำขอนี้ไม่มีบันทึกว่าใครเป็นผู้ประเมินหน้างาน ระบบจึงยืนยันการแยกหน้าที่ไม่ได้ '
        + 'กรุณาตรวจสอบการมอบหมายผู้ตรวจของคำขอนี้ก่อน',
    [CERT_DECISION_REFUSALS.DECIDER_UNKNOWN]:
        'ระบบไม่ทราบว่าผู้ใดกำลังตัดสินให้การรับรอง กรุณาเข้าสู่ระบบใหม่แล้วทำรายการอีกครั้ง',
    [CERT_DECISION_REFUSALS.SYSTEM_CANNOT_DECIDE]:
        'การตัดสินให้การรับรองต้องทำโดยเจ้าหน้าที่ผู้มีอำนาจ ระบบอัตโนมัติทำแทนไม่ได้ '
        + 'กรุณาให้เจ้าหน้าที่ผู้อนุมัติเป็นผู้ดำเนินการ',
});

/** ตัวตนที่เทียบได้ — ตัดช่องว่างและตัวพิมพ์ทิ้ง คนคนเดียวกันต้องไม่กลายเป็นคนละคน */
function identity(value) {
    return String(value ?? '').trim().toUpperCase();
}

/** ชื่อที่ระบบใช้เรียกตัวเองเมื่อทำงานแทนคน */
const SYSTEM_ACTORS = new Set(['SYSTEM', 'SERVICE', 'CRON']);

/**
 * ตัดสินว่าการอนุมัติครั้งนี้ผ่านด่านแยกหน้าที่หรือไม่
 *
 * @param {object}  args
 * @param {object}  args.application คำขอที่กำลังจะถูกอนุมัติ (ต้องมี auditorId)
 * @param {string}  args.actorId     ผู้ที่กำลังกดอนุมัติ
 * @param {string}  [args.actorRole] บทบาทของผู้กด — ใช้จับกรณีระบบอัตโนมัติเท่านั้น
 *                                   บทบาทไม่เคยเป็นเหตุให้ข้ามด่านนี้ได้
 * @returns {string|null} รหัสการปฏิเสธ หรือ null เมื่อผ่าน
 */
function certificationDecisionRefusal({ application, actorId, actorRole } = {}) {
    const decider = identity(actorId);
    if (!decider) { return CERT_DECISION_REFUSALS.DECIDER_UNKNOWN; }

    // ระบบอัตโนมัติทำแทนไม่ได้ · ตรวจก่อนเทียบตัวตน เพราะ 'SYSTEM' ไม่ใช่คน
    // จะบอกว่า "ไม่ใช่คนเดียวกับผู้ประเมิน" แล้วปล่อยผ่านไม่ได้
    if (SYSTEM_ACTORS.has(decider) || SYSTEM_ACTORS.has(identity(actorRole))) {
        return CERT_DECISION_REFUSALS.SYSTEM_CANNOT_DECIDE;
    }

    const evaluator = identity(application?.auditorId);
    if (!evaluator) { return CERT_DECISION_REFUSALS.EVALUATOR_UNKNOWN; }

    if (evaluator === decider) { return CERT_DECISION_REFUSALS.EVALUATOR_CANNOT_DECIDE; }

    return null;
}

module.exports = {
    certificationDecisionRefusal,
    CERT_DECISION_REFUSALS,
    CERT_DECISION_MESSAGES_TH,
};
