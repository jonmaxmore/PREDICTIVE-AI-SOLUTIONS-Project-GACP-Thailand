/**
 * พืชที่หน้าสแกนสาธารณะพูดถึงได้ — และเส้นที่ลืมตัดข้อมูล
 *
 * วัดจริงบน staging 2026-09-07 ด้วยล็อตเดียวกัน สแกนผ่านสองประตูที่ QR พาไปได้:
 *
 *   GET /api/trace/lot/LOT-2569-000001-A   → 51 ฟิลด์   (เส้นที่หน้าเว็บผู้ซื้อเรียก)
 *   GET /api/trace/LOT-2569-000001-A       → 69 ฟิลด์   (เส้นทั่วไป)
 *
 * ส่วนต่าง 18 ฟิลด์เกือบทั้งหมดคือ **แถว PlantSpecies ทั้งแถว** ที่เส้นทั่วไปส่งออกดิบ ๆ:
 *
 *   plant.securityRequirements[]  — CCTV 24/7 · รั้ว ≥2 เมตร · สมุดลงชื่อเข้า-ออก · Biometric
 *   plant.productionInputs[]      — นิยามฟิลด์ของฟอร์มภายใน (fieldName/fieldType/required)
 *   plant.isDeleted · plant.uuid · plant.sortOrder · plant.createdAt · plant.updatedAt
 *   plant.maxYieldPerPlant · plant.gacpCategory · plant.requiresLicense · plant.isActive
 *
 * ต้นเหตุอยู่ในบรรทัดเดียวของ resolve-generic.js: ทางของล็อตเขียนว่า `plant: lot.batch?.plant`
 * ขณะที่ทางของ **ชุดเก็บเกี่ยว** และ **รอบปลูก** ในไฟล์เดียวกันตัดเหลือสี่ฟิลด์ทุกครั้ง
 * ⇒ คนสแกนคนเดียวกัน ของชิ้นเดียวกัน ได้ข้อมูลไม่เท่ากันตามว่า QR พาไปทางไหน
 *
 * คลาสเดียวกับที่ public-farm.js ถูกสร้างขึ้นมาแก้ — คนละเรื่อง (ฟาร์ม) แต่รูปเดียวกัน
 * ที่อยู่ฟาร์มเป็นมติที่ operator ผ่อนไว้เอง (public-farm.js:36-48) ส่วนแถวพืชไม่เคยมีมติให้เปิด
 */
'use strict';

const {
    PUBLIC_PLANT_SELECT,
    toPublicPlant,
} = require('../../services/trace-service/public-plant');

/** แถวดิบอย่างที่ Prisma คืนมาจริง — คีย์ชุดนี้วัดจากประตูจริงบน staging */
const RAW_ROW = {
    id: 'row-1',
    uuid: '5ceba748-8e15-4fd6-9899-f9d04656b491',
    code: 'CANNABIS',
    nameTH: 'กัญชา',
    nameEN: 'Cannabis',
    scientificName: 'Cannabis sativa L.',
    group: 'CONTROLLED',
    gacpCategory: 'MEDICAL',
    cultivationType: 'OUTDOOR',
    requiresLicense: true,
    maxYieldPerPlant: 0,
    isActive: true,
    isDeleted: false,
    sortOrder: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-02-01'),
    plantParts: ['ช่อดอก'],
    units: ['kg'],
    productionInputs: [{ fieldName: 'x', fieldType: 'text', label: 'x', required: true }],
    securityRequirements: [{ label: 'CCTV 24/7 (Medical Grade)', required: true, description: 'กล้องวงจรปิดบันทึก 24 ชม.' }],
};

describe('สิ่งที่พูดได้เรื่องพืช ต่อคนที่แค่สแกน QR', () => {
    it('เหลือเฉพาะสิ่งที่คนซื้อต้องใช้ระบุว่านี่คือพืชอะไร', () => {
        expect(Object.keys(toPublicPlant(RAW_ROW)).sort())
            .toEqual(['code', 'nameEN', 'nameTH', 'scientificName']);
    });

    it('ไม่ตีพิมพ์มาตรการความปลอดภัยของสถานที่ปลูก', () => {
        const out = JSON.stringify(toPublicPlant(RAW_ROW));
        expect(out).not.toContain('CCTV');
        expect(out).not.toContain('securityRequirements');
    });

    it('ไม่ตีพิมพ์คอลัมน์ภายในที่ไม่มีความหมายกับคนสแกน', () => {
        const out = toPublicPlant(RAW_ROW);
        for (const internal of ['id', 'uuid', 'isDeleted', 'isActive', 'sortOrder',
            'createdAt', 'updatedAt', 'productionInputs', 'maxYieldPerPlant', 'gacpCategory']) {
            expect(out).not.toHaveProperty(internal);
        }
    });

    it('ค่าว่างคือ null ไม่ใช่ undefined — หน้าเว็บจะได้แยก "ไม่มีข้อมูล" ออกจาก "ไม่ได้ถาม"', () => {
        expect(toPublicPlant({ code: 'X' }).scientificName).toBeNull();
    });

    it('ไม่มีพืชผูกอยู่ ก็ตอบ null ไม่ใช่วัตถุเปล่า', () => {
        expect(toPublicPlant(null)).toBeNull();
        expect(toPublicPlant(undefined)).toBeNull();
    });

    it('select ขอเท่าที่ projection อ่าน — ไม่มากไม่น้อย', () => {
        expect(Object.keys(PUBLIC_PLANT_SELECT).sort())
            .toEqual(['code', 'nameEN', 'nameTH', 'scientificName']);
    });
});

describe('ไม่มีประตูสาธารณะไหนส่งแถวพืชดิบออกไป', () => {
    const read = (rel) => require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', rel), 'utf8',
    );

    it('เส้นทั่วไปตัดข้อมูลพืชทุกทาง ไม่ใช่แค่ทางชุดเก็บเกี่ยวกับรอบปลูก', () => {
        const src = read('services/trace-service/resolve-generic.js');
        // บรรทัดที่เป็นต้นเหตุ: ทางของล็อตยกแถวทั้งแถวให้
        expect(src).not.toMatch(/plant:\s*lot\.batch\?\.plant\s*,/);
        expect(src).toContain('toPublicPlant');
        // สามทาง — รอบปลูก · ชุดเก็บเกี่ยว · ล็อต — ต้องเรียกตัวเดียวกันทั้งหมด
        expect((src.match(/toPublicPlant\(/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    it('เส้นที่หน้าเว็บผู้ซื้อเรียก บอกชื่อพืชผ่าน projection — มติ 2026-09-07 ข้อ 7 "บอก"', () => {
        // operator เคาะให้หน้าสแกนผู้ซื้อบอกชื่อพืช ("ตอนนี้เป็น demo ปล่อยก่อน")
        // เงื่อนไขเดิมยังอยู่: เปิดผ่าน toPublicPlant สี่ฟิลด์ ไม่ใช่ยกแถวทะเบียนให้
        const src = read('routes/api/trace/trace-batch-lot-routes.js');
        expect(src).toMatch(/plant:\s*toPublicPlant\(/);
        expect(src).not.toMatch(/plant:\s*(lot|batch)(\.batch)?\??\.plant\s*,/);
    });
});
