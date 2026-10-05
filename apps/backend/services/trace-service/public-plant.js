'use strict';

/**
 * พืชที่หน้าสแกนสาธารณะพูดถึงได้ — **แหล่งเดียว** ของทั้งคำถาม (select) และคำตอบ (projection)
 *
 * คู่แฝดของ `public-farm.js` และเกิดจากเหตุเดียวกัน: ประตูสแกนสาธารณะมีหลายเส้น และแต่ละเส้น
 * เคยเขียน projection ของตัวเอง ⇒ ผู้ซื้อคนเดียวกัน สแกนของชิ้นเดียวกัน ได้คำตอบไม่เท่ากัน
 * ตามว่า QR พาไปทางไหน
 *
 * วัดจริงบน staging 2026-09-07 ด้วยล็อต LOT-2569-000001-A:
 *
 *   GET /api/trace/lot/:id   → 51 ฟิลด์   (เส้นที่หน้าเว็บผู้ซื้อเรียก — ตัดพืชออกหมด)
 *   GET /api/trace/:qr       → 69 ฟิลด์   (เส้นทั่วไป — ส่งแถว PlantSpecies ทั้งแถว)
 *
 * ที่เส้นทั่วไปหลุดออกไป และไม่เคยมีมติใดให้เปิด:
 *   securityRequirements[]  มาตรการความปลอดภัยที่สถานที่ปลูกพืชควบคุมต้องมี
 *                           (CCTV 24/7 · รั้ว ≥2 เมตร · สมุดลงชื่อเข้า-ออก · Biometric)
 *   productionInputs[]      นิยามฟิลด์ของฟอร์มภายใน (fieldName/fieldType/required)
 *   isDeleted · uuid · sortOrder · createdAt · updatedAt · maxYieldPerPlant
 *   gacpCategory · requiresLicense · isActive
 *
 * ต้นเหตุคือบรรทัดเดียว — `plant: lot.batch?.plant` — ในไฟล์ที่ทุกบล็อกอื่นตัดข้อมูลอย่างตั้งใจ
 * รวมทั้งทางของชุดเก็บเกี่ยวและรอบปลูกในไฟล์เดียวกัน ซึ่งตัดเหลือสี่ฟิลด์นี้อยู่แล้ว
 *
 * ทำไมเหลือสี่: คนที่ถือถุงอยู่ต้องตอบได้ว่า "นี่คือพืชอะไร" เพื่อตรวจสอบคุณภาพ —
 * รหัส ชื่อไทย ชื่ออังกฤษ ชื่อวิทยาศาสตร์ · ที่เหลือเป็นข้อมูลอ้างอิงภายในของทะเบียนพืช
 * ไม่ใช่ข้อเท็จจริงเกี่ยวกับของในมือเขา
 *
 * @module services/trace-service/public-plant
 */

/** ทุกคอลัมน์ที่ `toPublicPlant` อ่าน — ปักด้วยเทสใน __tests__/unit/public-plant-projection.test.js */
const PUBLIC_PLANT_SELECT = Object.freeze({
    code: true,
    nameTH: true,
    nameEN: true,
    scientificName: true,
});

/**
 * @param {object|null|undefined} plant  แถว PlantSpecies (ดิบหรือที่ select มาแล้วก็ได้)
 * @returns {{code:?string, nameTH:?string, nameEN:?string, scientificName:?string}|null}
 */
function toPublicPlant(plant) {
    if (!plant) { return null; }
    // `?? null` ไม่ใช่ `|| null` — ชื่อที่เป็นสตริงว่างคือคำตอบที่ฐานข้อมูลเก็บไว้จริง
    // ส่วน undefined แปลว่า select ไม่ได้ขอมา ซึ่งเป็นคนละเรื่องและต้องไม่ถูกกลบ
    return {
        code: plant.code ?? null,
        nameTH: plant.nameTH ?? null,
        nameEN: plant.nameEN ?? null,
        scientificName: plant.scientificName ?? null,
    };
}

module.exports = { PUBLIC_PLANT_SELECT, toPublicPlant };
