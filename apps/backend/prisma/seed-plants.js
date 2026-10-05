/**
 * Seed Script: PlantMaster and DocumentRequirement (Prisma Version)
 * Run: npx prisma db seed (or node prisma/seed-plants.js)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// PLANT DATA

const plantsData = [
    // ==================== GROUP A: HIGH CONTROL ====================
    {
        code: 'CAN',
        nameEN: 'Cannabis',
        nameTH: 'กัญชา',
        group: 'HIGH_CONTROL',
        requiresLicense: true,
        units: ['ต้น', 'Tree'],
        plantParts: ['ช่อดอก (Flower)', 'ใบ (Leaf)', 'เมล็ด (Seed)', 'ลำต้น (Stem)'],
        securityRequirements: [
            { label: 'CCTV 24/7 (Medical Grade)', required: true, description: 'กล้องวงจรปิดบันทึก 24 ชม.' },
            { label: 'รั้วแข็งแรง ≥2 เมตร', required: true, description: 'High Security Fence' },
            { label: 'สมุดลงชื่อเข้า-ออก', required: true, description: 'Access Log Book' },
            { label: 'Biometric/Key Card Access', required: true, description: 'ระบบสแกนนิ้ว/บัตร' },
            { label: 'เจ้าหน้าที่รักษาความปลอดภัย', required: false, description: 'Security Guard (Optional)' },
        ],
        productionInputs: [
            { fieldName: 'treeCount', fieldType: 'number', label: 'จำนวนต้น (Tree Count)', required: true },
            { fieldName: 'harvestCycle', fieldType: 'text', label: 'รอบการเก็บเกี่ยว (Harvest Cycle)', required: true },
            { fieldName: 'estimatedYield', fieldType: 'number', label: 'ผลผลิตโดยประมาณ (กก./รอบ)', required: true },
            { fieldName: 'licenseType', fieldType: 'select', label: 'ประเภทใบอนุญาต', required: true, options: ['BhT 11', 'BhT 13', 'BhT 16'] },
            { fieldName: 'licenseNumber', fieldType: 'text', label: 'เลขที่ใบอนุญาต', required: true },
            { fieldName: 'licenseExpiry', fieldType: 'text', label: 'วันหมดอายุใบอนุญาต', required: true },
        ],
        sortOrder: 1,
        isActive: true,
    },
    {
        code: 'KRA',
        nameEN: 'Kratom',
        nameTH: 'กระท่อม',
        group: 'HIGH_CONTROL',
        requiresLicense: true,
        units: ['ต้น', 'Tree'],
        plantParts: ['ใบสด (Fresh Leaf)', 'ใบแห้ง (Dried Leaf)', 'ผง (Powder)'],
        securityRequirements: [
            { label: 'CCTV', required: true, description: 'กล้องวงจรปิด' },
            { label: 'รั้วแข็งแรง', required: true, description: 'Security Fence' },
            { label: 'สมุดลงชื่อเข้า-ออก', required: true, description: 'Access Log Book' },
            { label: 'Biometric Access', required: false, description: 'ระบบสแกนนิ้ว (Optional)' },
        ],
        productionInputs: [
            { fieldName: 'treeCount', fieldType: 'number', label: 'จำนวนต้น (Tree Count)', required: true },
            { fieldName: 'harvestCycle', fieldType: 'text', label: 'รอบการเก็บเกี่ยว (ทุก 2-3 เดือน)', required: true },
            { fieldName: 'estimatedYield', fieldType: 'number', label: 'ผลผลิตโดยประมาณ (กก./รอบ)', required: true },
            { fieldName: 'licenseNumber', fieldType: 'text', label: 'เลขที่ใบอนุญาต', required: true },
        ],
        sortOrder: 2,
        isActive: true,
    },

    // ==================== GROUP B: GENERAL HERBS ====================
    {
        code: 'TUR',
        nameEN: 'Turmeric',
        nameTH: 'ขมิ้นชัน',
        group: 'GENERAL',
        requiresLicense: false,
        units: ['ไร่', 'Rai'],
        plantParts: ['เหง้า (Rhizome)', 'ผง (Powder)', 'น้ำมันหอมระเหย (Essential Oil)'],
        securityRequirements: [
            { label: 'รั้วกั้นสัตว์', required: true, description: 'Animal Barrier' },
            { label: 'ป้ายบ่งเขตแปลง', required: true, description: 'Zoning Markers' },
            { label: 'รั้วธรรมดา', required: false, description: 'Basic Fence (Optional)' },
        ],
        productionInputs: [
            { fieldName: 'areaSizeRai', fieldType: 'number', label: 'ขนาดพื้นที่ (ไร่)', required: true },
            { fieldName: 'seedlingPerRai', fieldType: 'number', label: 'จำนวนต้นพันธุ์ (กก./ไร่)', required: false },
            { fieldName: 'harvestCycle', fieldType: 'text', label: 'รอบการเก็บเกี่ยว (8-10 เดือน)', required: true },
            { fieldName: 'estimatedYield', fieldType: 'number', label: 'ผลผลิตโดยประมาณ (กก./ไร่/ปี)', required: true },
            { fieldName: 'hasGapCert', fieldType: 'checkbox', label: 'มีใบรับรอง GAP', required: false },
            { fieldName: 'hasOrganicCert', fieldType: 'checkbox', label: 'มีใบรับรอง Organic', required: false },
        ],
        sortOrder: 3,
        isActive: true,
    },
    {
        code: 'GIN',
        nameEN: 'Ginger',
        nameTH: 'ขิง',
        group: 'GENERAL',
        requiresLicense: false,
        units: ['ไร่', 'Rai'],
        plantParts: ['เหง้าสด (Fresh Rhizome)', 'เหง้าแห้ง (Dried Rhizome)', 'ผง (Powder)'],
        securityRequirements: [
            { label: 'รั้วกั้นสัตว์', required: true, description: 'Animal Barrier' },
            { label: 'ป้ายบ่งเขตแปลง', required: true, description: 'Zoning Markers' },
        ],
        productionInputs: [
            { fieldName: 'areaSizeRai', fieldType: 'number', label: 'ขนาดพื้นที่ (ไร่)', required: true },
            { fieldName: 'seedlingPerRai', fieldType: 'number', label: 'จำนวนต้นพันธุ์ (กก./ไร่)', required: false },
            { fieldName: 'harvestCycle', fieldType: 'text', label: 'รอบการเก็บเกี่ยว (8-12 เดือน)', required: true },
            { fieldName: 'estimatedYield', fieldType: 'number', label: 'ผลผลิตโดยประมาณ (กก./ไร่/ปี)', required: true },
        ],
        sortOrder: 4,
        isActive: true,
    },
    {
        code: 'GAL',
        nameEN: 'Black Galingale',
        nameTH: 'กระชายดำ',
        group: 'GENERAL',
        requiresLicense: false,
        units: ['ไร่', 'Rai'],
        plantParts: ['เหง้า (Rhizome)', 'ผง (Powder)', 'สารสกัด (Extract)'],
        securityRequirements: [
            { label: 'รั้วกั้นสัตว์', required: true, description: 'Animal Barrier' },
            { label: 'ป้ายบ่งเขตแปลง', required: true, description: 'Zoning Markers' },
        ],
        productionInputs: [
            { fieldName: 'areaSizeRai', fieldType: 'number', label: 'ขนาดพื้นที่ (ไร่)', required: true },
            { fieldName: 'bulbsPerRai', fieldType: 'number', label: 'จำนวนหัว/ไร่', required: false },
            { fieldName: 'harvestCycle', fieldType: 'text', label: 'รอบการเก็บเกี่ยว (10-12 เดือน)', required: true },
            { fieldName: 'estimatedYield', fieldType: 'number', label: 'ผลผลิตโดยประมาณ (กก./ไร่/ปี)', required: true },
        ],
        sortOrder: 5,
        isActive: true,
    },
    {
        code: 'PLA',
        nameEN: 'Plai',
        nameTH: 'ไพล',
        group: 'GENERAL',
        requiresLicense: false,
        units: ['ไร่', 'Rai'],
        plantParts: ['เหง้าสด (Fresh Rhizome)', 'น้ำมันหอมระเหย (Essential Oil)', 'สารสกัด (Extract)'],
        securityRequirements: [
            { label: 'รั้วกั้นสัตว์', required: true, description: 'Animal Barrier' },
            { label: 'ป้ายบ่งเขตแปลง', required: true, description: 'Zoning Markers' },
        ],
        productionInputs: [
            { fieldName: 'areaSizeRai', fieldType: 'number', label: 'ขนาดพื้นที่ (ไร่)', required: true },
            { fieldName: 'seedlingPerRai', fieldType: 'number', label: 'จำนวนต้นพันธุ์ (กก./ไร่)', required: false },
            { fieldName: 'harvestCycle', fieldType: 'text', label: 'รอบการเก็บเกี่ยว (8-12 เดือน)', required: true },
            { fieldName: 'estimatedYield', fieldType: 'number', label: 'ผลผลิตโดยประมาณ (กก./ไร่/ปี)', required: true },
        ],
        sortOrder: 6,
        isActive: true,
    },
];

// ทะเบียนเอกสารของ seed นี้ถูกถอดออก 2026-09-11 (คำสั่ง operator: ล้างคราบเก่า)
//
// 74 แถวที่เคยอยู่ตรงนี้เป็นคำตอบชุดที่สองของคำถาม "คำขอนี้ต้องใช้เอกสารอะไร" — ป้ายที่
// แต่งขึ้นเองโดยไม่มีฐาน DTAM ("Strain Certificate", "Soil/Water Analysis", "BhT License")
// ขณะที่คำตอบจริงมาจากทะเบียน B1 ซึ่งสร้างจากแบบ กทล.1 ฉบับที่ทีมอ่านเต็มฉบับแล้ว
// (reports/research/2026-09-01-dtam-application-baseline/facts.md)
//
// ไม่มีเส้นทางไหนอ่านตาราง document_requirements แล้ว — สามเมธอดที่เคยอ่านมันถูกลบใน
// ใบเดียวกันนี้ (services/document-analysis-service.js — ไฟล์ทั้งไฟล์ถูกลบแล้ว 2026-09-28)
//
// ไฟล์นี้ยังทำงานเดิมต่อ: seed ทะเบียนพืช 6 ชนิด

async function main() {
    try {
        console.log('Seeding PlantMaster data to Prisma...');

        // 1. Seed Plants (Upsert)
        for (const plant of plantsData) {
            await prisma.plantSpecies.upsert({
                where: { code: plant.code },
                update: {
                    nameTH: plant.nameTH,
                    nameEN: plant.nameEN,
                    group: plant.group,
                    requiresLicense: plant.requiresLicense,
                    units: plant.units,
                    plantParts: plant.plantParts,
                    securityRequirements: plant.securityRequirements,
                    productionInputs: plant.productionInputs,
                    sortOrder: plant.sortOrder,
                    isActive: plant.isActive,
                    gacpCategory: plant.group === 'HIGH_CONTROL' ? 'HIGH_CONTROL' : 'MEDICINAL',
                },
                create: {
                    code: plant.code,
                    nameTH: plant.nameTH,
                    nameEN: plant.nameEN,
                    group: plant.group,
                    requiresLicense: plant.requiresLicense,
                    units: plant.units,
                    plantParts: plant.plantParts,
                    securityRequirements: plant.securityRequirements,
                    productionInputs: plant.productionInputs,
                    sortOrder: plant.sortOrder,
                    isActive: plant.isActive,
                    gacpCategory: plant.group === 'HIGH_CONTROL' ? 'HIGH_CONTROL' : 'MEDICINAL',
                },
            });
            console.log(`Synced plant: ${plant.code}`);
        }

    } catch (e) {
        console.error('Seeding failed:', e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
