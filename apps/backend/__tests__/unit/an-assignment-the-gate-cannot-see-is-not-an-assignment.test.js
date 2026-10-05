/**
 * การมอบหมายที่ด่านมองไม่เห็น เท่ากับไม่ได้มอบหมาย
 *
 * ระบบมีประตูมอบหมายสองบาน และเดิมทิ้งแถวไว้คนละรูป:
 *
 *   scheduler-assign-reviewer-handler.js:139  ->  เขียนคอลัมน์ reviewerId
 *   provider/handlers/applications.js:186     ->  เขียนแค่ formData.PROVIDERAssignment
 *
 * ด่านแยกหน้าที่ของ PATCH /api/applications/:id/reject
 * (application-workflow-handlers.js:99) อ่านคอลัมน์ตัวเดียว และเขียนไว้ว่า
 * "a null column means unassigned = allowed" · แถวที่มอบหมายผ่านประตูที่สองจึงมี
 * คอลัมน์เป็น null และด่านอ่านว่าใครก็ได้
 *
 * วัดจริงบนระบบที่รันอยู่ 2026-09-09 (เดินครบทั้งเส้น ไม่ได้อ่านโค้ดเดา):
 *
 *   1. คนจัดคิว POST /api/provider/applications/:id/assign {reviewerId: A}  -> 200
 *   2. แถวในฐานข้อมูล: status ASSIGNED_FOR_REVIEW · reviewerId (คอลัมน์) = null
 *      formData.PROVIDERAssignment.reviewerId = A
 *   3. ผู้ตรวจ B ซึ่งไม่ได้รับมอบหมาย
 *      PATCH /api/applications/:id/reject {"type":"DOC_REVISION"}          -> 200
 *      ใบไปเป็น REVISION_REQUESTED พร้อมกำหนดส่งแก้ 2026-09-16
 *
 * ผลไม่ได้จบที่การยุ่งกับงานของเพื่อนร่วมงาน — ผู้ยื่นได้กำหนดส่งแก้ 5 วันทำการจากคน
 * ที่ไม่มีใครมอบหมายให้ และพลาดกำหนดนั้นคือ EXPIRED โดยอัตโนมัติ
 *
 * แก้สองฝั่ง: ประตูเดิมเขียนคอลัมน์ (แถวใหม่) และด่านอ่าน formData เป็นทางสำรอง
 * (แถวเก่าที่ยังอยู่) · เทสนี้ตรึงทั้งคู่ เพราะแก้ฝั่งเดียวไม่พอทั้งสองทาง
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REVIEWER_A = 'reviewer-a';
const REVIEWER_B = 'reviewer-b';

describe('ประตูมอบหมายเดิมต้องเขียนคอลัมน์ที่ด่านอ่าน', () => {
    it('reviewerId อยู่ในสิ่งที่เขียนลงแถว ไม่ใช่แค่ใน formData', () => {
        // อ่านจากไฟล์เพราะ handler ผูกกับ middleware หลายชั้น · สิ่งที่ตรึงคือ
        // "additionalData มีคีย์ reviewerId" ซึ่งเป็นสิ่งเดียวที่ทำให้คอลัมน์ถูกเขียน
        // (application-status-writer.js:879 กระจาย additionalData ลง update)
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'routes', 'api', 'provider', 'handlers', 'applications.js'),
            'utf8',
        );
        const assignBlock = src.slice(src.indexOf('const applicationsAssign'), src.indexOf('const applicationsReview'));
        const additional = assignBlock.slice(assignBlock.indexOf('additionalData: {'));
        const beforeFormData = additional.slice(0, additional.indexOf('formData: {'));
        expect(beforeFormData).toMatch(/^\s*reviewerId,\s*$/m);
    });
});

describe('ด่านแยกหน้าที่ต้องเห็นการมอบหมายทั้งสองรูป', () => {
    const { asObject } = require('../../routes/api/helpers/application-constants');

    /**
     * ตรรกะเดียวกับ application-workflow-handlers.js:99-107 · ตรึงไว้ที่นี่เพราะ
     * handler จริงต้องมี prisma + auth ครบถึงจะเรียกได้ ส่วนสิ่งที่ต้องเฝ้าคือ
     * "เจ้าของงานถูกหาเจอจากที่ใดบ้าง"
     */
    function assignedOwnerIdOf(application, decisionType) {
        const legacy = asObject(asObject(application.formData).PROVIDERAssignment).reviewerId || null;
        return decisionType === 'FIELD_CAR'
            ? application.auditorId
            : (application.reviewerId || legacy);
    }

    it('แถวใหม่ — คอลัมน์บอกเจ้าของ', () => {
        const app = { reviewerId: REVIEWER_A, auditorId: null, formData: {} };
        expect(assignedOwnerIdOf(app, 'DOC_REVISION')).toBe(REVIEWER_A);
    });

    it('แถวเก่า — formData บอกเจ้าของ แม้คอลัมน์เป็น null', () => {
        const app = {
            reviewerId: null,
            auditorId: null,
            formData: { PROVIDERAssignment: { reviewerId: REVIEWER_A } },
        };
        expect(assignedOwnerIdOf(app, 'DOC_REVISION')).toBe(REVIEWER_A);
    });

    it('ผู้ตรวจคนอื่นไม่ใช่เจ้าของงาน ทั้งสองรูป', () => {
        for (const app of [
            { reviewerId: REVIEWER_A, auditorId: null, formData: {} },
            { reviewerId: null, auditorId: null, formData: { PROVIDERAssignment: { reviewerId: REVIEWER_A } } },
        ]) {
            const owner = assignedOwnerIdOf(app, 'DOC_REVISION');
            expect(owner).not.toBe(REVIEWER_B);
            expect(Boolean(owner) && owner !== REVIEWER_B).toBe(true); // = ด่านปฏิเสธ
        }
    });

    it('ใบที่ยังไม่มอบหมายจริง ๆ ยังเปิดให้ทุกคน — ไม่ได้ทำให้กองงานร่วมตาย', () => {
        const app = { reviewerId: null, auditorId: null, formData: {} };
        expect(assignedOwnerIdOf(app, 'DOC_REVISION')).toBeNull();
    });

    it('FIELD_CAR ยังถามผู้ตรวจแปลง ไม่ใช่ผู้ตรวจเอกสาร', () => {
        const app = {
            reviewerId: REVIEWER_A,
            auditorId: 'auditor-x',
            formData: { PROVIDERAssignment: { reviewerId: REVIEWER_A } },
        };
        expect(assignedOwnerIdOf(app, 'FIELD_CAR')).toBe('auditor-x');
    });
});

describe('ด่านตัวจริงในไฟล์อ่านทั้งสองที่', () => {
    it('application-workflow-handlers อ่าน formData เป็นทางสำรองของคอลัมน์', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'application-workflow-handlers.js'),
            'utf8',
        );
        expect(src).toMatch(/PROVIDERAssignment\)\.reviewerId/);
        expect(src).toMatch(/application\.reviewerId \|\| legacyReviewerId/);
    });
});
