'use strict';

/**
 * คอลัมน์ของคำขอ (Application) ที่ประตูการเงินส่งออกไปได้ — ชุดเดียวทั้งระบบ
 *
 * มติ F-SCOPE-01 (2026-09-07): "การเงินเห็นเฉพาะเรื่องเงิน" · security review 2026-09-27 (S1)
 * วัดได้ว่า invoice-service / quote-service ดึง `application: { include: ... }` ซึ่งคืนทุก scalar
 * ของ Application ไปถึงหน้าจอการเงิน: formData (เลขบัตรประชาชน/เลขผู้เสียภาษีที่ถอดรหัสแล้ว),
 * workflowHistory (เลขประจำตัวเจ้าหน้าที่), auditNotes, labResults, IP
 *
 * ชุดนี้คือทุกอย่างที่หน้าบัญชีและใบเสร็จใช้จริง (เลขที่คำขอ + ชื่อผู้ถือใบ) บวกสถานะ/ประเภท
 * ที่ใช้จัดหมวดบิล · ห้ามเพิ่มคอลัมน์ข้อมูลส่วนบุคคลหรือข้อมูลงานตรวจ — ถ้าเอกสาร PDF ต้องใช้
 * ข้อมูลเต็ม ให้ดึงผ่านทางภายในที่ไม่ถูกส่งออกไปหาผู้เรียก (invoice-service.getForDocument)
 */
const BILLING_APPLICATION_SELECT = Object.freeze({
    select: Object.freeze({
        id: true,
        applicationNumber: true,
        status: true,
        serviceType: true,
        areaType: true,
        entity: Object.freeze({ select: Object.freeze({ id: true, type: true, displayName: true }) }),
    }),
});

module.exports = { BILLING_APPLICATION_SELECT };
