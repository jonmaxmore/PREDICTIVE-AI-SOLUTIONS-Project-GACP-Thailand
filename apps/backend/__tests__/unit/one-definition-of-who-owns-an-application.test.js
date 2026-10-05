'use strict';

/**
 * "ใครเป็นเจ้าของคำขอ" ต้องมีคำตอบเดียวในระบบ
 *
 * วัดจริงบน demo 2026-09-07 · เกษตรกรคนเดียวกัน โทเคนใบเดียวกัน คำขอใบเดียวกัน:
 *
 *     200  GET /applications/:id
 *     200  GET /applications/:id/requirements
 *     200  GET /applications/:id/statement
 *     404  GET /applications/:id/quotations      ← ประตูเดียวที่ปฏิเสธ
 *
 * สามประตูแรกถามผ่าน `findOwnedApplicationForApplicant` ซึ่งเทียบด้วย **ความสัมพันธ์
 * applicant → User.id** · ประตูใบเสนอราคาเขียนกติกาของตัวเองไว้ต่างหาก โดยเทียบ
 * `application.healthId` กับ `req.user.canonicalId`
 *
 * หัวข้อของ findOwnedApplicationForApplicant อธิบายไว้เองว่าทำไมวิธีนั้นใช้ไม่ได้:
 *   "User.id is a non-encrypted UUID FK that survives PDPA field encryption, whereas
 *    healthId may be redacted at the column level depending on tenant"
 *
 * ⇒ บนผู้เช่าที่ redact คอลัมน์นั้น การเทียบ healthId ล้มเหลวเงียบ ๆ และเจ้าของตัวจริง
 * ถูกตอบว่า "ไม่พบใบเสนอราคา" · และนี่คือประตูที่กั้น **การจ่ายเงิน** — เกษตรกรที่เปิด
 * ใบเสนอราคาไม่ได้ ก็ยอมรับราคาไม่ได้ และจ่ายเงินไม่ได้ คำขอค้างอยู่ตรงนั้นถาวร
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'api', 'applications', 'quotations.js'), 'utf8',
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('กติกาความเป็นเจ้าของของประตูใบเสนอราคา', () => {
    it('ใช้ตัวตัดสินร่วมของระบบ ไม่ใช่เขียนกติกาของตัวเอง', () => {
        expect(CODE).toContain('findOwnedApplicationForApplicant');
    });

    it('ไม่เทียบด้วย healthId ซึ่งอาจถูก redact ตามผู้เช่า', () => {
        expect(CODE).not.toMatch(/app\.healthId\s*===/);
        expect(CODE).not.toMatch(/canonicalId\s*\|\|\s*user\?\.healthId/);
    });

    it('ยังตอบ 404 แบบไม่บอกว่ามีคำขอนั้นอยู่จริง เมื่อผู้เรียกไม่ใช่เจ้าของ', () => {
        expect(CODE).toContain("error: 'Quotations not found'");
    });

    // เดิม: เจ้าหน้าที่ทุกบทบาท (isProviderRole) ข้ามการตรวจความเป็นเจ้าของ · operator 2026-09-27
    // "ปิด เห็นได้เฉพาะผู้ยื่น+การเงิน+แอดมิน" ⇒ เฉพาะชุด QUOTATION_STAFF_READ_ROLES ที่ข้ามได้
    // (พฤติกรรมเต็มถูก pin ที่ quotation-door-owner-finance-admin-only.test.js)
    it('เจ้าหน้าที่การเงิน + แอดมินยังข้ามการตรวจความเป็นเจ้าของ บทบาทอื่นไม่ข้าม', () => {
        expect(CODE).toContain('QUOTATION_STAFF_READ_ROLES.has(role)');
        expect(CODE).not.toContain('isProviderRole(');
    });
});
