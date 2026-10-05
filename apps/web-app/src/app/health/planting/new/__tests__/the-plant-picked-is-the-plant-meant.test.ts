/**
 * รอบปลูกใหม่ต้องเลือกพืชที่ตั้งใจ ไม่ใช่พืชที่บังเอิญอยู่บนสุด
 *
 * หน้า "สร้างรอบปลูก" เลือกกัญชาให้อัตโนมัติด้วยบรรทัดนี้ (client-view.tsx:109):
 *
 *     plantRows.find((item) => String(item.code || '').toLowerCase() === 'cannabis')
 *
 * แต่ `code` ที่ประตู `/api/plants` คืนมาคือ **รหัสของทะเบียนพืช** ซึ่งวัดจริงบน demo
 * 2026-09-07 ได้ว่าเป็น `CAN` · ส่วน `'cannabis'` คือ **slug ของวิซาร์ดคำขอ** — คนละคำศัพท์
 * ⇒ เงื่อนไขนี้ไม่มีวันเป็นจริง และหน้าจอตกไปที่ `plantRows[0]` เสมอ
 *
 * วันนี้ไม่มีใครเห็น เพราะแถวแรกบังเอิญเป็นกัญชาตาม `sortOrder` · วันที่ทะเบียนเพิ่มพืชใหม่
 * ที่เรียงมาก่อน หรือ sortOrder ขยับ เกษตรกรที่ได้ใบรับรอง**กัญชา**จะเปิดหน้านี้แล้วเจอ
 * **กระท่อม** ถูกเลือกไว้ให้ — และรอบปลูกที่บันทึกไปคือพืชคนละชนิดกับใบรับรองที่ถือ
 *
 * repo มีสะพานระหว่างสองคำศัพท์นี้อยู่แล้ว และเอกสารของมันเขียนเองว่าเป็น "the one place
 * the two vocabularies meet" — `apps/backend/config/plant-species-slugs.js` · หน้านี้เป็น
 * ที่ที่สามที่ไม่เคยรู้จักสะพานนั้น คลาสเดียวกับ F-G4-59 ที่สร้างสะพานขึ้นมาตอนแรก
 */
import fs from 'node:fs';
import path from 'node:path';
import { PLANT_MASTER_CODE } from '../../../applications/new/_steps/steps/plant-selection-config';
import { pickDefaultPlantSpeciesId } from '../new-planting-cycle-page-config';

const REGISTRY = [
    { id: 'id-kra', code: 'KRA', nameTH: 'กระท่อม' },
    { id: 'id-can', code: 'CAN', nameTH: 'กัญชา' },
    { id: 'id-tur', code: 'TUR', nameTH: 'ขมิ้นชัน' },
];

describe('พืชที่ถูกเลือกไว้ให้ ต้องเป็นกัญชาเสมอ ไม่ว่าทะเบียนจะเรียงอย่างไร', () => {
    it('เลือกกัญชาแม้ไม่ได้อยู่แถวแรก', () => {
        expect(pickDefaultPlantSpeciesId(REGISTRY)).toBe('id-can');
    });

    it('ยังทำงานเมื่อกัญชาอยู่แถวแรกจริง ๆ', () => {
        expect(pickDefaultPlantSpeciesId([REGISTRY[1], REGISTRY[0]])).toBe('id-can');
    });

    it('ทะเบียนที่ไม่มีกัญชาเลย ตกไปที่แถวแรก — ดีกว่าไม่เลือกอะไรเลย', () => {
        expect(pickDefaultPlantSpeciesId([REGISTRY[0], REGISTRY[2]])).toBe('id-kra');
    });

    it('ทะเบียนว่าง ตอบค่าว่าง ไม่ระเบิด', () => {
        expect(pickDefaultPlantSpeciesId([])).toBe('');
        expect(pickDefaultPlantSpeciesId(undefined as never)).toBe('');
    });

    it('เทียบแบบไม่สนตัวพิมพ์ — ทะเบียนอาจเก็บ can หรือ CAN', () => {
        expect(pickDefaultPlantSpeciesId([{ id: 'x', code: 'can' }])).toBe('x');
    });
});

describe('คำศัพท์สองชุดต้องผูกกันที่เดียว', () => {
    it('slug ของวิซาร์ดทุกตัวมีรหัสทะเบียน และตรงกับสะพานฝั่งหลังบ้าน', () => {
        const bridge = fs.readFileSync(
            path.resolve(__dirname, '../../../../../../../backend/config/plant-species-slugs.js'),
            'utf8',
        );
        for (const [slug, code] of Object.entries(PLANT_MASTER_CODE)) {
            // สะพานฝั่งหลังบ้านประกาศคู่เดียวกันนี้ไว้ — ถ้าฝั่งไหนขยับ เทสนี้แดง
            expect(bridge).toMatch(new RegExp(`${slug}:\\s*'${code}'`));
        }
    });

    it('กัญชาผูกกับรหัสที่ทะเบียนจริงใช้ ไม่ใช่กับ slug ของตัวเอง', () => {
        expect(PLANT_MASTER_CODE.cannabis).toBe('CAN');
        expect(PLANT_MASTER_CODE.cannabis).not.toBe('cannabis');
    });
});

describe('หน้าจอเลิกเทียบ slug กับรหัสทะเบียนแล้ว', () => {
    it('ไม่มีการค้นทะเบียนเองในหน้าจออีก — กฎอยู่ที่เดียว', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../client-view.tsx'), 'utf8');
        // คอมเมนต์ยังเอ่ยถึงบรรทัดที่ถูกถอดได้ นั่นคือสิ่งที่ทำให้การแก้ยังอ่านรู้เรื่อง
        // สิ่งที่ต้องหายไปคือการ "ค้น" จริง ๆ ในหน้าจอ
        expect(src).not.toMatch(/plantRows\.find\(/);
        expect(src).toContain('pickDefaultPlantSpeciesId');
    });
});
