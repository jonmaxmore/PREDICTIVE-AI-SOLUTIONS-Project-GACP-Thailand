/**
 * Seed Herb Knowledge DB — สัญญา C05F680149 ต้นแบบที่ 5
 * "ฐานข้อมูลสมุนไพรไทย 6 ฐานข้อมูล" (KPI: ≥300 รายการ/ฐาน).
 *
 * Seeds the 6 HerbSpecies master rows + a STARTER set of reference entries per
 * herb (a handful each) so the DB, API and coverage KPI are demonstrable. The
 * full ≥300 records/herb is content produced by the SSRU research team and
 * loaded via the bulk-import endpoint (POST /api/herbs/:code/entries/import).
 *
 * Run: node prisma/seed-herbs.js   (idempotent: upsert species, replace entries)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 6 ฐานตามเอกสารแนบ A3 (สัญญาหน้า 51/81)
const SPECIES = [
    { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa L.', familyName: 'Cannabaceae', isPrimary: true, isControlled: true, sortOrder: 1, description: 'สมุนไพรหลักของโครงการ เก็บพันธุ์, สาร CBD/THC, วิธีปลูก, โรค' },
    { code: 'TURMERIC', nameTH: 'ขมิ้นชัน', nameEN: 'Turmeric', scientificName: 'Curcuma longa L.', familyName: 'Zingiberaceae', isPrimary: false, isControlled: false, sortOrder: 2, description: 'เก็บพันธุ์, สาร Curcumin, การเก็บเกี่ยว' },
    { code: 'GINGER', nameTH: 'ขิง', nameEN: 'Ginger', scientificName: 'Zingiber officinale Roscoe', familyName: 'Zingiberaceae', isPrimary: false, isControlled: false, sortOrder: 3, description: 'เก็บพันธุ์, สาร Gingerol, การแปรรูป' },
    { code: 'BLACK_GALINGALE', nameTH: 'กระชายดำ', nameEN: 'Black Galingale', scientificName: 'Kaempferia parviflora Wall. ex Baker', familyName: 'Zingiberaceae', isPrimary: false, isControlled: false, sortOrder: 4, description: 'เก็บพันธุ์, สารออกฤทธิ์, การอบแห้ง' },
    { code: 'PLAI', nameTH: 'ไพล', nameEN: 'Plai', scientificName: 'Zingiber montanum (J.Koenig) Link ex A.Dietr.', familyName: 'Zingiberaceae', isPrimary: false, isControlled: false, sortOrder: 5, description: 'เก็บพันธุ์, น้ำมันหอมระเหย, การสกัด' },
    { code: 'KRATOM', nameTH: 'กระท่อม', nameEN: 'Kratom', scientificName: 'Mitragyna speciosa (Korth.) Havil.', familyName: 'Rubiaceae', isPrimary: false, isControlled: true, sortOrder: 6, description: 'เก็บพันธุ์, Alkaloids (Mitragynine), กฎหมาย' },
];

// Starter reference entries — ตัวอย่างที่ยืนยันได้จริง (ไม่ใช่ครบ 300; ส่วนที่เหลือ = SSRU import)
const STARTER_ENTRIES = {
    CANNABIS: [
        { category: 'ACTIVE_COMPOUND', title: 'สาร CBD (Cannabidiol)', content: 'สารสำคัญไม่ออกฤทธิ์ต่อจิตประสาท ใช้ทางการแพทย์', unit: '% by dry weight', source: 'DTAM' },
        { category: 'ACTIVE_COMPOUND', title: 'สาร THC (Tetrahydrocannabinol)', content: 'สารออกฤทธิ์ต่อจิตประสาท ควบคุมตามกฎหมาย', unit: '% by dry weight', source: 'DTAM' },
        { category: 'CULTIVATION', title: 'ระบบการปลูก', content: 'Indoor / Greenhouse / Outdoor ตาม solar system ของแปลง' },
        { category: 'DISEASE', title: 'โรคใบไหม้ (Leaf Blight)', content: 'อาการใบเป็นแผลไหม้ ควบคุมความชื้นและการระบายอากาศ' },
        { category: 'LEGAL', title: 'การควบคุมตามกฎหมาย', content: 'อยู่ภายใต้ พ.ร.บ. ผลิตภัณฑ์สมุนไพร พ.ศ. 2562 และประกาศที่เกี่ยวข้อง' },
    ],
    TURMERIC: [
        { category: 'ACTIVE_COMPOUND', title: 'สาร Curcumin', content: 'สารสีเหลือง มีฤทธิ์ต้านการอักเสบ', unit: '% by dry weight', source: 'Thai Herbal Pharmacopoeia' },
        { category: 'HARVEST', title: 'อายุการเก็บเกี่ยว', content: 'เก็บเกี่ยวเมื่ออายุ 9-11 เดือน (ต้นเริ่มแห้ง)', unit: 'เดือน' },
        { category: 'VARIETY', title: 'พันธุ์แดงสยาม', content: 'พันธุ์ที่ให้ปริมาณเคอร์คูมินสูง' },
    ],
    GINGER: [
        { category: 'ACTIVE_COMPOUND', title: 'สาร Gingerol', content: 'สารรสเผ็ดร้อน มีฤทธิ์ต้านอนุมูลอิสระ', source: 'Thai Herbal Pharmacopoeia' },
        { category: 'PROCESSING', title: 'การแปรรูปขิงแห้ง', content: 'หั่นแล้วอบแห้งที่อุณหภูมิควบคุมเพื่อรักษาสารสำคัญ' },
        { category: 'VARIETY', title: 'ขิงใหญ่ (ขิงหยวก)', content: 'เหง้าขนาดใหญ่ นิยมปลูกเชิงพาณิชย์' },
    ],
    BLACK_GALINGALE: [
        { category: 'ACTIVE_COMPOUND', title: 'สารกลุ่ม Methoxyflavones', content: 'สารออกฤทธิ์เด่นของกระชายดำ' },
        { category: 'PROCESSING', title: 'การอบแห้ง', content: 'อบแห้งเหง้าเพื่อทำผงหรือสารสกัด' },
    ],
    PLAI: [
        { category: 'ACTIVE_COMPOUND', title: 'น้ำมันหอมระเหย', content: 'มีฤทธิ์ลดการอักเสบ ใช้ในผลิตภัณฑ์นวด', unit: '% v/w' },
        { category: 'PROCESSING', title: 'การสกัดน้ำมัน', content: 'สกัดด้วยการกลั่นด้วยไอน้ำ (steam distillation)' },
    ],
    KRATOM: [
        { category: 'ACTIVE_COMPOUND', title: 'สาร Mitragynine', content: 'อัลคาลอยด์หลักในใบกระท่อม', source: 'DTAM' },
        { category: 'LEGAL', title: 'สถานะทางกฎหมาย', content: 'ปลดออกจากยาเสพติดประเภท 5 แล้ว มีการควบคุมการปลูกและจำหน่ายเฉพาะ' },
        { category: 'VARIETY', title: 'พันธุ์ก้านแดง', content: 'พันธุ์ที่พบมากในภาคใต้' },
    ],
};

// ทุกแถว starter ถูกแท็ก source นี้ → re-seed ลบเฉพาะแถว seed ไม่แตะ content
// จริงที่ SSRU import เข้ามา (ซึ่งมี source อื่น/ว่าง). กัน "idempotent" กลายเป็น
// destructive ที่ลบ ≥300 records/herb ที่ทีมวิจัยโหลดไว้.
const SEED_SOURCE = 'SEED_STARTER';

async function seedHerbs() {
    console.log('Seeding Herb Knowledge DB...');
    for (const s of SPECIES) {
        const species = await prisma.herbSpecies.upsert({
            where: { code: s.code },
            update: s,
            create: s,
        });
        // Idempotent re-seed: clear only THIS herb's SEED_STARTER rows, re-add
        // starters. SSRU-imported entries (other/blank source) are preserved.
        await prisma.herbKnowledgeEntry.deleteMany({
            where: { herbCode: species.code, source: SEED_SOURCE },
        });
        const starters = STARTER_ENTRIES[s.code] || [];
        for (let i = 0; i < starters.length; i++) {
            await prisma.herbKnowledgeEntry.create({
                data: { herbCode: species.code, sortOrder: i + 1, ...starters[i], source: SEED_SOURCE },
            });
        }
        console.log(`  ${species.code} (${species.nameTH}): ${starters.length} starter entries`);
    }
    console.log('Herb seeding complete! (full ≥300/herb loaded via bulk-import by SSRU)');
}

if (require.main === module) {
    seedHerbs()
        .catch((e) => { console.error('Seed error:', e); process.exit(1); })
        .finally(async () => { await prisma.$disconnect(); });
}

module.exports = { seedHerbs, SPECIES, STARTER_ENTRIES };
