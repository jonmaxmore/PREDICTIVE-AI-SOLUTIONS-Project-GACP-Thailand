/**
 * ล็อตหนึ่งใบ มี QR หนึ่งอัน — ไม่ว่าในล็อตจะมีกี่ถุง
 *
 * operator: "QR code ที่เจนมาต้องเป็น QR ที่แสกนได้จริง และมีข้อมูลที่ถูกต้องข้างใน ไม่ใช่ mockup"
 *
 * ที่เจอเมื่อกดจริง (2026-09-07): ปุ่ม QR ของล็อตแตกเป็นสองทางตามจำนวนหน่วย
 *   quantity === 1  → GET /api/lots/:id/qr/print          ✅ ประตูมีจริง คืน PNG ที่ decode ได้
 *   quantity  >  1  → POST /api/lots/:id/qr/batch-generate ❌ 404 ไม่มีประตูนี้
 *                     GET  /api/lots/:id/qr/batch-status   ❌ 404 ไม่มีประตูนี้
 * คำว่า batch-generate ปรากฏในโปรเจกต์ที่เดียวคือไฟล์หน้าจอที่เรียกมันเอง — ไม่เคยมีฝั่งเซิร์ฟเวอร์
 * ⇒ **ทุกล็อตที่บรรจุมากกว่าหนึ่งถุง — คือล็อตจริงแทบทั้งหมด — ไม่มีทางได้ QR เลย**
 * กดแล้วหมุนจนครบรอบ poll แล้วขึ้น "ไม่สามารถสร้าง QR ได้"
 *
 * ทางสองแพร่งนี้เป็นซากของยุค QR รายต้น/รายหน่วย ซึ่ง **R8 ยกเลิกถาวรแล้ว**
 * (design note 2026-08-20-planting-tnt-design — ความละเอียดจบที่รอบ/แปลง และล็อต)
 * ล็อตคือหน่วยที่ติด QR ไม่ใช่ถุงแต่ละใบ ⇒ เหลือทางเดียว คือทางที่ใช้ได้จริง
 */
import fs from 'node:fs';
import path from 'node:path';

const VIEW = path.join(__dirname, '..', 'client-view.tsx');

describe('ปุ่ม QR ของล็อต', () => {
    const src = fs.readFileSync(VIEW, 'utf8');

    it('ไม่เรียกประตูที่ไม่มีอยู่จริงอีกต่อไป', () => {
        // คอมเมนต์เอ่ยชื่อประตูที่ถูกถอดได้ นั่นคือวิธีที่ทำให้การแก้ยังอ่านรู้เรื่อง
        // สิ่งที่ต้องหายไปคือการ "เรียก" มันจริง ๆ
        expect(src).not.toMatch(/fetch\([^)]*qr\/batch-generate/);
        expect(src).not.toMatch(/fetch\([^)]*qr\/batch-status/);
    });

    it('ใช้ประตูเดียวที่มีจริงเสมอ ไม่แยกตามจำนวนหน่วย', () => {
        expect(src).toContain('/qr/print');
        // ไม่มีการแตกทางตาม quantity สำหรับ QR อีก
        expect(src).not.toMatch(/quantity\s*>\s*1\s*\?\s*generateBatchQRs/);
    });

    it('ไม่เหลือฟังก์ชันสร้าง QR แบบหลายชุดไว้ให้ใครเรียกอีก', () => {
        expect(src).not.toContain('generateBatchQRs');
    });

    it('ป้ายปุ่มไม่สัญญาจำนวนชุดที่ระบบไม่ได้ออกให้', () => {
        expect(src).not.toMatch(/สร้าง QR \$\{?lot\.quantity/);
        expect(src).toMatch(/QR/);
    });
});
