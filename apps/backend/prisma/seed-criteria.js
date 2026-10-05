/**
 * Seed Supplementary Criteria
 * Run: node prisma/seed-criteria.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const criteriaData = [
    // หมวดการทดสอบและตรวจสอบ
    {
        code: 'CONTAMINANT_TEST',
        category: 'TESTING',
        categoryTH: 'การทดสอบและตรวจสอบ',
        label: 'ผลตรวจสารปนเปื้อน',
        description: 'รายงานการตรวจสารปนเปื้อน เช่น โลหะหนัก ยาฆ่าแมลง',
        icon: '🧪',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'IDENTITY_TEST',
        category: 'TESTING',
        categoryTH: 'การทดสอบและตรวจสอบ',
        label: 'ผลตรวจอัตลักษณ์',
        description: 'รายงานยืนยันชนิดพืช/สายพันธุ์',
        icon: '🧪',
        sortOrder: 2,
        inputType: 'checkbox',
    },
    {
        code: 'MOISTURE_TEST',
        category: 'TESTING',
        categoryTH: 'การทดสอบและตรวจสอบ',
        label: 'ผลตรวจความชื้น',
        description: 'รายงานวัดความชื้นผลิตภัณฑ์',
        icon: '🧪',
        sortOrder: 3,
        inputType: 'checkbox',
    },

    // หมวดขั้นตอนการผลิต
    {
        code: 'POST_HARVEST_RECORD',
        category: 'PRODUCTION',
        categoryTH: 'ขั้นตอนการผลิต',
        label: 'บันทึกขั้นตอนหลังเก็บเกี่ยว',
        description: 'เอกสารกระบวนการอบแห้ง บรรจุ เก็บรักษา',
        icon: '⚙️',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'MANUFACTURING_RECORD',
        category: 'PRODUCTION',
        categoryTH: 'ขั้นตอนการผลิต',
        label: 'บันทึกการผลิตหลัก',
        description: 'เอกสาร Master Manufacturing Record',
        icon: '⚙️',
        sortOrder: 2,
        inputType: 'checkbox',
    },

    // หมวดแหล่งที่มาเมล็ดพันธุ์
    {
        code: 'SEED_SOURCE_DOC',
        category: 'SEED_SOURCE',
        categoryTH: 'แหล่งที่มาเมล็ดพันธุ์',
        label: 'เอกสารแหล่งที่มาเมล็ดพันธุ์',
        description: 'ใบรับรองแหล่งที่มา/ใบเสร็จซื้อเมล็ด',
        icon: '🌱',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'PROPAGATION_RECORD',
        category: 'SEED_SOURCE',
        categoryTH: 'แหล่งที่มาเมล็ดพันธุ์',
        label: 'บันทึกการขยายพันธุ์',
        description: 'เอกสารวิธีการขยายพันธุ์',
        icon: '🌱',
        sortOrder: 2,
        inputType: 'checkbox',
    },

    // หมวดสุขอนามัยและความปลอดภัย  
    {
        code: 'PERSONNEL_HYGIENE',
        category: 'HYGIENE',
        categoryTH: 'สุขอนามัยและความปลอดภัย',
        label: 'เอกสารสุขอนามัยพนักงาน',
        description: 'ใบรับรองสุขภาพ/การอบรมสุขอนามัย',
        icon: '🛡️',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'RECALL_PROCEDURE',
        category: 'HYGIENE',
        categoryTH: 'สุขอนามัยและความปลอดภัย',
        label: 'แผนการเรียกคืนสินค้า',
        description: 'เอกสารขั้นตอนเรียกคืนสินค้า',
        icon: '🛡️',
        sortOrder: 2,
        inputType: 'checkbox',
    },
    {
        code: 'COMPLAINT_RECORD',
        category: 'HYGIENE',
        categoryTH: 'สุขอนามัยและความปลอดภัย',
        label: 'ระบบบันทึกข้อร้องเรียน',
        description: 'เอกสารขั้นตอนรับเรื่องร้องเรียน',
        icon: '🛡️',
        sortOrder: 3,
        inputType: 'checkbox',
    },

    // INTERNATIONAL STANDARDS (OPTIONAL - SELF ASSESSMENT)

    // WHO GACP Category
    {
        code: 'WHO_RISK_MANAGEMENT',
        category: 'WHO_GACP',
        categoryTH: 'มาตรฐาน WHO GACP',
        label: 'แผนจัดการความเสี่ยง (Risk Management Plan)',
        description: 'มีเอกสารประเมินความเสี่ยงและมาตรการควบคุมในทุกขั้นตอนการผลิต',
        icon: '🌍',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'WHO_RECORD_KEEPING',
        category: 'WHO_GACP',
        categoryTH: 'มาตรฐาน WHO GACP',
        label: 'ระบบจัดเก็บเอกสาร (Record Keeping)',
        description: 'มีระบบจัดเก็บและสืบค้นเอกสารย้อนหลังได้อย่างน้อย 5 ปี',
        icon: '🌍',
        sortOrder: 2,
        inputType: 'checkbox',
    },

    // US FDA Category
    {
        code: 'FDA_SANITATION_SOP',
        category: 'US_FDA',
        categoryTH: 'มาตรฐาน US FDA',
        label: 'แผนปฏิบัติงานสุขลักษณะ (Sanitation SOPs)',
        description: 'มีขั้นตอนปฏิบัติมาตรฐานด้านความสะอาดและสุขอนามัย (SSOP)',
        icon: '🇺🇸',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'FDA_HYGIENE_TRAINING',
        category: 'US_FDA',
        categoryTH: 'มาตรฐาน US FDA',
        label: 'บันทึกการอบรม (Hygiene Training)',
        description: 'บันทึกประวัติการฝึกอบรมพนักงานด้านสุขอนามัยประจำปี',
        icon: '🇺🇸',
        sortOrder: 2,
        inputType: 'checkbox',
    },

    // ASEAN GHP/GMP
    {
        code: 'ASEAN_QUALITY_MANUAL',
        category: 'ASEAN_STD',
        categoryTH: 'มาตรฐาน ASEAN',
        label: 'คู่มือคุณภาพ (Quality Manual)',
        description: 'มีคู่มือคุณภาพที่ระบุนโยบายและวัตถุประสงค์คุณภาพชัดเจน',
        icon: '🌏',
        sortOrder: 1,
        inputType: 'checkbox',
    },
    {
        code: 'ASEAN_POST_HARVEST_LOG',
        category: 'ASEAN_STD',
        categoryTH: 'มาตรฐาน ASEAN',
        label: 'บันทึกคุณภาพหลังเก็บเกี่ยว',
        description: 'บันทึกการตรวจสอบคุณภาพวัตถุดิบหลังการเก็บเกี่ยวและการแปรรูปเบื้องต้น',
        icon: '🌏',
        sortOrder: 2,
        inputType: 'checkbox',
    },
];

async function seedCriteria() {
    console.log('Seeding supplementary criteria...');

    for (const criterion of criteriaData) {
        try {
            await prisma.supplementaryCriterion.upsert({
                where: { code: criterion.code },
                update: criterion,
                create: criterion,
            });
            console.log(`${criterion.code}: ${criterion.label}`);
        } catch (error) {
            console.error(`${criterion.code}: ${error.message}`);
        }
    }

    console.log('Seeding complete!');

    const count = await prisma.supplementaryCriterion.count();
    console.log(`Total criteria: ${count}`);
}

seedCriteria()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
