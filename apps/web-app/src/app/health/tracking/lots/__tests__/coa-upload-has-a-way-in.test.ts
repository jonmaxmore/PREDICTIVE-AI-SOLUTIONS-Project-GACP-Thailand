/**
 * หน้าอัปโหลดผลตรวจ (COA) ต้องมีทางเดินพาไป
 *
 * operator 2026-09-07: "ทำไมไม่มีการอัพโหลด COA ตรวจสอบ และดูว่าผิดพลาดตรงไหน"
 *
 * วัดจริง: หน้าอัปโหลด `/health/tracking/batches/[id]/lab-results` มีครบ —
 * page.tsx · client-view · state · เทส — และประตูหลังบ้าน
 * `POST /api/harvest-batches/:id/lab-results` ก็มีจริง (harvest-batches.js:557)
 * แต่ค้นทั้ง src แล้ว **ไม่มีสักที่ที่ลิงก์ไปหน้านั้น** — เกษตรกรที่อยากแนบผลแล็บ
 * ต้องพิมพ์ URL เอง ซึ่งเท่ากับฟีเจอร์ไม่มีอยู่จริงสำหรับเขา
 *
 * คลาสเดียวกับ work-waiting-has-a-way-in (เมนูผู้จัดตารางที่ไม่พาไปหน้าจ่ายงาน):
 * ประตูครบ หน้าครบ ทางเดินไม่ครบ · และผลจริงวันนี้คือหน้าสแกนสาธารณะของทุกล็อต
 * ประกาศว่า tested: false ตลอดกาล
 *
 * ที่วางลิงก์: หน้าล็อต ซึ่งเป็นที่เดียวที่ผู้ใช้เลือก "ชุดเก็บเกี่ยว" อยู่แล้ว —
 * ปุ่มผูกกับ batch ที่เลือก จึงพาไปหน้าอัปโหลดของชุดนั้นตรง ๆ
 */
import fs from 'node:fs';
import path from 'node:path';

const VIEW = path.join(__dirname, '..', 'client-view.tsx');

describe('ทางเข้าหน้าอัปโหลดผลตรวจ (COA)', () => {
    const src = fs.readFileSync(VIEW, 'utf8');

    it('หน้าล็อตมีลิงก์ไปหน้าอัปโหลดผลตรวจของ batch ที่เลือก', () => {
        expect(src).toMatch(/\/health\/tracking\/batches\/\$\{selectedBatchId\}\/lab-results/);
    });

    it('ปุ่มบอกเป็นภาษาไทยว่าทำอะไร', () => {
        expect(src).toMatch(/ผลตรวจ|ผลวิเคราะห์|COA/);
    });

    it('ลิงก์แสดงเฉพาะเมื่อเลือก batch แล้ว — ไม่มี batch ก็ไม่มีหน้าให้ไป', () => {
        const anchor = src.indexOf('/lab-results');
        expect(anchor).toBeGreaterThan(-1);
        // อยู่ในบล็อกที่มีเงื่อนไข selectedBatchId คุมอยู่
        const before = src.slice(Math.max(0, anchor - 600), anchor);
        expect(before).toMatch(/selectedBatchId/);
    });
});
