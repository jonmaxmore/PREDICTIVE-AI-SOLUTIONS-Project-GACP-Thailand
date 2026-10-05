'use strict';

/**
 * Wizard plant slug → plant_species master code.
 *
 * The application wizard stores formData.plantId as the FE slug, the `code` of each
 * FALLBACK_PLANTS entry in
 * apps/web-app/src/app/health/applications/new/_steps/steps/plant-selection-config.ts.
 * The master table plant_species (prisma/schema/trace.prisma PlantSpecies) keys the same
 * plants by the seed code in prisma/seed-plants.js. Nothing imported one from the other,
 * so a backend lookup with the slug found no plant (F-G4-59).
 *
 * This is the one place the two vocabularies meet. Every wizard slug must appear here
 * and every value must be a code the seed declares — pinned by
 * __tests__/unit/plant-slug-map-covers-the-wizard.test.js, which reads both files as
 * text. When the slug retires, this file goes with it.
 *
 * Resolve a plant to its master row through services/plant-species-service.js; do not
 * read this map at a call site for that. The one thing callers may ask HERE is the
 * closed vocabulary question — "is this word a plant this platform can name" — because
 * that answer is static, synchronous and needed before any database is reachable
 * (the กทล.1 requirement lens and the submit validator both ask it, and they must ask
 * it the same way or a filing is judged by one door and refused by the other).
 */
const PLANT_SLUG_TO_CODE = Object.freeze({
    cannabis: 'CAN',
    kratom: 'KRA',
    turmeric: 'TUR',
    ginger: 'GIN',
    plai: 'PLA',
    black_galangal: 'GAL',
});

/**
 * The wizard slug this word is, or null.
 *
 * ONE normalisation for every caller. The lens lower-cased and the submit validator did
 * not, so `plantId: 'Cannabis'` was judged normally by the requirement engine and then
 * refused at submit — two doors, one vocabulary, two answers.
 */
function asPlantSlug(value) {
    if (value === null || value === undefined) { return null; }
    const slug = String(value).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PLANT_SLUG_TO_CODE, slug) ? slug : null;
}

/**
 * ชนิดที่กฎหมายจัดเป็น "สมุนไพรควบคุม" — กัญชา กับ กระท่อม
 *
 * อยู่ที่นี่ด้วยเหตุผลเดียวกับที่ไฟล์นี้ถือคำศัพท์ชุดปิดอื่น ๆ: คำตอบเป็นค่าคงที่
 * ตอบได้แบบ synchronous และถูกถามก่อนที่ฐานข้อมูลจะเอื้อมถึง — เลนส์เอกสาร กทล.1
 * ถามมัน และตัว seed กฎหมายก็ถามมัน ทั้งคู่ต้องถามด้วยคำเดียวกัน
 *
 * ข้อเท็จจริงเดียวกันนี้ถูกเขียนไว้อีกสองที่ในฐานข้อมูล และแต่ละที่ตัดสินคนละเรื่อง:
 *   HerbSpecies.isControlled      ทะเบียนสมุนไพร
 *   PlantSpecies.requiresLicense  ปิดบังที่อยู่แปลงบนหน้าสแกนสาธารณะไหม
 * ทั้งสามถูกผูกให้ตรงกันด้วย __tests__/unit/herb-rule-rows.test.js ซึ่งอ่าน seed
 * ทั้งสองไฟล์เป็นข้อความ · เพี้ยนกันแล้วไม่มีอะไรพังดัง ๆ — มันจะเปิดที่อยู่แปลงกัญชา
 * ต่อสาธารณะ หรือขอเอกสารที่ไม่มีอยู่จากคนปลูกขิง อย่างเงียบ ๆ
 */
const CONTROLLED_HERB_SLUGS = Object.freeze(['cannabis', 'kratom']);

/**
 * ชนิดนี้อยู่ใต้กฎหมายสมุนไพรควบคุมหรือไม่
 *
 * ชนิดที่เรียกชื่อไม่ได้ตอบ **true** — ฝั่งที่ปลอดภัยคือถือว่าควบคุมไว้ก่อน เพราะเดาผิด
 * ทางนั้นแค่ขอเอกสารเกิน ส่วนเดาผิดอีกทางคือปล่อยพืชควบคุมผ่านโดยไม่ขอใบอนุญาต
 */
function isControlledHerb(value) {
    const slug = asPlantSlug(value);
    return slug === null || CONTROLLED_HERB_SLUGS.includes(slug);
}

/**
 * ชื่อไทยของแต่ละชนิด สำหรับกระดาษที่ต้องเรียกชื่อพืชออกมาตรง ๆ
 *
 * ชื่อทางการอยู่บนตาราง plant_species (prisma/seed-plants.js nameTH) แต่ตัวเรนเดอร์
 * แบบ กทล.1 ประกอบหน้ากระดาษแบบ synchronous และต้องพิมพ์ได้แม้ฐานข้อมูลอ่านไม่ได้ —
 * แบบที่พิมพ์ออกมาโดยไม่มีชื่อพืชคือแบบที่ไม่ได้บอกว่าขอรับรองอะไร
 *
 * อยู่ที่นี่เพราะนี่คือที่เดียวที่คำศัพท์สองชุดมาเจอกันอยู่แล้ว และเทสตัวเดียวกัน
 * (__tests__/unit/plant-slug-map-covers-the-wizard.test.js) อ่าน seed เป็นข้อความเพื่อ
 * ยืนยันว่าชื่อตรงกัน · การเอาไปไว้ที่อื่นคือการสร้างสำเนาที่สามของรายชื่อพืช
 *
 * งานอื่นที่ต้องการแถวของพืชจริง ให้ใช้ services/plant-species-service.js
 */
const PLANT_SLUG_TO_NAME_TH = Object.freeze({
    cannabis: 'กัญชา',
    kratom: 'กระท่อม',
    turmeric: 'ขมิ้นชัน',
    ginger: 'ขิง',
    plai: 'ไพล',
    black_galangal: 'กระชายดำ',
});

/**
 * ชื่อไทยของชนิดนี้ หรือ null เมื่อเรียกชื่อไม่ได้
 *
 * null ไม่ใช่ความผิดพลาด — ร่างที่ผู้ยื่นยังไม่ได้เลือกพืชก็ตอบ null และกระดาษต้องเว้นไว้
 * ห้ามตกไปเป็น "กัญชา" เป็นค่าเริ่มต้นเด็ดขาด เพราะนั่นคือการพิมพ์คำตอบที่ผู้ยื่นไม่ได้ตอบ
 * ลงบนเอกสารราชการ
 */
function plantNameTH(value) {
    const slug = asPlantSlug(value);
    return slug ? PLANT_SLUG_TO_NAME_TH[slug] : null;
}

module.exports = {
    PLANT_SLUG_TO_CODE, asPlantSlug, PLANT_SLUG_TO_NAME_TH, plantNameTH,
    CONTROLLED_HERB_SLUGS, isControlledHerb,
};
