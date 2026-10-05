/**
 * ขอบเขตของแพลตฟอร์มคือหกชนิด ไม่ใช่กัญชาชนิดเดียว
 *
 * มติ operator 2026-09-11: "สินค้า หรือสมุนไพรต้องมี 6 อย่าง ไม่ใช่แค่กัญชา" — กลับทิศ
 * ข้อ cannabis-only ของ baseline 2026-09-01
 *
 * `enabled` ของ FALLBACK_PLANTS คือสิ่งที่หน้าจอขั้น 1 และขั้น 4 กรองจริง (ไม่ใช่ fallback
 * ในทางปฏิบัติ — ทั้งสองหน้าอ่านค่าคงที่นี้ตรง ๆ) การปิดชนิดใดกลับไปจึงเป็นการหดขอบเขต
 * ของแพลตฟอร์ม ซึ่งควรเป็นมติ ไม่ใช่การแก้ค่า boolean ที่ไม่มีใครสังเกต
 *
 * ตรึงคู่กับฝั่งหลังบ้าน: `__tests__/unit/herb-rule-rows.test.js` ตรึงว่าทั้งหกชนิดมีกฎหมาย
 * เอกสารของตัวเอง · ถ้าหน้าจอเปิดชนิดที่ทะเบียนกฎหมายไม่มี ประตูยื่นจะปฏิเสธด้วย
 * PLANT_LAW_NOT_FILED และผู้ยื่นจะกรอกจนจบแล้วยื่นไม่ได้
 */
import { FALLBACK_PLANTS, PLANT_MASTER_CODE } from '../plant-selection-config';

const SIX_HERBS = ['cannabis', 'kratom', 'turmeric', 'ginger', 'plai', 'black_galangal'];

describe('หกชนิดเปิดให้เลือกครบ', () => {
    it('ผู้ยื่นเลือกได้ครบทั้งหกชนิด', () => {
        const open = FALLBACK_PLANTS.filter((p) => p.enabled).map((p) => p.code);
        expect(open.sort()).toEqual([...SIX_HERBS].sort());
    });

    it('ไม่มีชนิดไหนถูกปิดไว้เงียบ ๆ', () => {
        const closed = FALLBACK_PLANTS.filter((p) => !p.enabled).map((p) => p.code);
        expect(closed).toEqual([]);
    });

    /**
     * ทุกชนิดที่เปิด ต้องแปลงเป็นรหัสทะเบียนได้ — ชนิดที่หน้าจอเสนอแต่หลังบ้านตั้งชื่อไม่ได้
     * คือคำขอที่กรอกจนจบแล้วถูกปฏิเสธตอนยื่น
     */
    it('ทุกชนิดที่เปิด มีรหัสทะเบียนของตัวเอง', () => {
        for (const plant of FALLBACK_PLANTS.filter((p) => p.enabled)) {
            expect(PLANT_MASTER_CODE[plant.code]).toEqual(expect.stringMatching(/^[A-Z]{3}$/));
        }
    });

    it('ทุกชนิดมีชื่อไทยและชื่ออังกฤษให้แสดง', () => {
        for (const plant of FALLBACK_PLANTS) {
            expect(plant.nameTH.trim()).not.toBe('');
            expect(plant.nameEN.trim()).not.toBe('');
        }
    });
});
