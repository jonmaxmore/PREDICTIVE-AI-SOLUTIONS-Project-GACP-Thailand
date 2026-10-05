/**
 * หลายไฟล์ ชื่อฟิลด์เดียว
 *
 * ประตูรับเอกสารแก้ไขอ่านด้วย `upload.array('carDocument', 10)` ซึ่งเป็นวิธีรับหลายไฟล์ของ multer:
 * ทุกไฟล์ใช้ชื่อฟิลด์เดียวกันซ้ำ ๆ · หน้าจอเคยส่งเป็น carDocument0 / carDocument1 / …
 * ⇒ multer ตอบ MulterError: Unexpected field แล้วกลายเป็น 500 (วัดจริง 2026-09-07)
 */
import fs from 'node:fs';
import path from 'node:path';

const VIEW = path.join(__dirname, '..', 'client-view.tsx');

describe('FormData ของหน้าส่งเอกสารแก้ไข', () => {
    const src = fs.readFileSync(VIEW, 'utf8');

    it('ไม่ต่อเลขท้ายชื่อฟิลด์', () => {
        expect(src).not.toMatch(/carDocument\$\{index\}/);
        expect(src).not.toMatch(/`carDocument\$\{/);
    });

    it('ใช้ชื่อ carDocument ตรงกับที่ประตูอ่าน', () => {
        expect(src).toMatch(/formData\.append\(\s*'carDocument'\s*,/);
    });
});
