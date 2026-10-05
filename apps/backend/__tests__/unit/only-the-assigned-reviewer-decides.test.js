/**
 * ใบที่มอบหมายแล้ว มีเจ้าของคนเดียว
 *
 * ความหมายที่ระบบใช้อยู่แล้วสองที่ (handlers/reviewer.js:244,
 * handlers/workflow-transitions-handler.js:151):
 *   reviewerId = null  ->  กองงานร่วม ใครก็หยิบได้
 *   reviewerId = someone -> คนนั้นเท่านั้น (ผู้ดูแลระบบข้ามได้)
 *
 * routes/api/provider/document-reviews.js เป็นไฟล์เดียวในสามที่เดิน edge
 * ASSIGNED_FOR_REVIEW -> DOC_APPROVED / REVISION_REQUESTED ที่ข้ามการตรวจนี้
 *
 * วัดจริง 2026-09-09 ก่อนแก้: ผู้ตรวจเอกสารที่ไม่ได้รับมอบหมาย เรียก
 * GET /api/provider/applications/:id/document-check ได้ 200 พร้อมรายการเอกสารทั้งใบ
 * และ POST /document-decision ผ่านด่านสิทธิ์เข้าไปถึงกฎธุรกิจ
 *
 * ผลที่ตามมาไม่ใช่แค่การอ่านข้อมูลของคนอื่น — มันทำให้การมอบหมายของคนจัดคิวไม่มี
 * ความหมาย และไม่มีใครตอบได้ว่าใครควรเป็นคนตัดสินใบนั้น
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'routes', 'api', 'provider', 'document-reviews.js');

describe('document-reviews ตรวจการมอบหมายก่อนให้ทำอะไรกับใบ', () => {
    let src;
    beforeAll(() => { src = fs.readFileSync(FILE, 'utf8'); });

    it('มีตัวตรวจอยู่จริง', () => {
        expect(src).toContain('refuseIfNotTheAssignedReviewer');
    });

    it('ใช้ความหมายเดียวกับประตูอื่น: ใบที่ยังไม่มอบหมายเปิดให้ทุกคน', () => {
        // `if (!application?.reviewerId) { return false; }` = ไม่ปฏิเสธ
        expect(src).toMatch(/if \(!application\?\.reviewerId\) \{ return false; \}/);
    });

    it('ผู้ดูแลระบบข้ามได้ — ต้องมีคนแก้สถานการณ์เมื่อผู้ตรวจที่รับมอบหมายไม่อยู่', () => {
        expect(src).toMatch(/actorRole === CANONICAL_ROLES\.SYSTEM_ADMIN_DTAM/);
    });

    it('ทุกประตูที่เรียก loadCheck ต้องตรวจการมอบหมายต่อทันที', () => {
        // นับเฉพาะ "การเรียก" ไม่ใช่ "การประกาศ" — รอบแรกผมนับรวมบรรทัด
        // `function refuseIfNotTheAssignedReviewer(req, res, application) {` เข้าไปด้วย
        // เทสจึงผ่านทั้งที่ประตูที่สามยังไม่มีการตรวจ · เทสที่แดงไม่ได้ ไม่ได้เฝ้าอะไร
        const loads = (src.match(/await loadCheck\(req\.params\.id\)/g) || []).length;
        const guards = (src.match(/if \(refuseIfNotTheAssignedReviewer\(req, res,/g) || []).length;
        expect({ loads, guards }).toEqual({ loads, guards: loads });
    });

    it('มีอย่างน้อยสามประตูที่ถูกเฝ้า (อ่าน · ให้ผลรายเอกสาร · ตัดสินรวม)', () => {
        const guards = (src.match(/if \(refuseIfNotTheAssignedReviewer\(req, res,/g) || []).length;
        expect(guards).toBeGreaterThanOrEqual(3);
    });
});
