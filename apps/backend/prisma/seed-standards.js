/**
 * Seed Certification Standards Data
 * Seeds FDA, WHO, ASEAN, and Thai GACP standards into the database
 * 
 * Run: node prisma/seed-standards.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const STANDARDS = [
    {
        code: 'WHO',
        name: 'WHO GACP',
        nameTH: 'มาตรฐาน WHO',
        description: 'World Health Organization Guidelines on Good Agricultural and Collection Practices for Medicinal Plants',
        version: 'v2003',
        isActive: true,
        sortOrder: 3,
        logoUrl: null,
        targetMarket: 'GLOBAL',
        requirements: [
            { category: 'CONTAMINANT', name: 'Heavy Metals Analysis', nameTH: 'การวิเคราะห์โลหะหนัก', description: 'Must meet limits: Arsenic < 4.0 ppm, Cadmium < 0.3 ppm, Lead < 10.0 ppm, Mercury < 0.5 ppm', isRequired: true },
            { category: 'CONTAMINANT', name: 'Pesticide Residues', nameTH: 'สารตกค้างกำจัดศัตรูพืช', description: 'No detection of prohibited pesticides. Limits for others must comply with WHO/FAO Codex Alimentarius.', isRequired: true },
            { category: 'PROCESS', name: 'Drying Protocols', nameTH: 'กระบวนการตากแห้ง', description: 'Must prevent mycotoxin formation (Aflatoxins < 20 ppb). Controlled humidity and temperature records required.', isRequired: true },
            { category: 'DOCUMENTATION', name: 'Batch Traceability', nameTH: 'การตรวจสอบย้อนกลับรุ่นผลิต', description: 'Full traceability from seed source to final harvest batch with unique batch numbering.', isRequired: true },
        ],
    },
    {
        code: 'FDA',
        name: 'US FDA',
        nameTH: 'มาตรฐาน FDA สหรัฐอเมริกา',
        description: 'US Food and Drug Administration - FSMA & cGMP (21 CFR Part 111)',
        version: 'CFR-21-111',
        isActive: true,
        sortOrder: 2,
        logoUrl: null,
        targetMarket: 'USA',
        requirements: [
            { category: 'SAFETY', name: 'Food Safety Plan (HACCP)', nameTH: 'แผนความปลอดภัยอาหาร (HACCP)', description: 'Must have a written Food Safety Plan including Hazard Analysis and Critical Control Points.', isRequired: true },
            { category: 'FACILITY', name: 'Sanitary Facilities', nameTH: 'สถานที่มีสุขอนามัย', description: 'Toilet and hand-washing facilities must be readily accessible and separate from production areas.', isRequired: true },
            { category: 'PROCESS', name: 'Water Quality', nameTH: 'คุณภาพน้ำ', description: 'Water used for irrigation and washing must be EPA-compliant for microbial quality (E. coli limits).', isRequired: true },
            { category: 'DOCUMENTATION', name: 'Foreign Supplier Verification Program (FSVP)', nameTH: 'โปรแกรมตรวจสอบผู้จัดหาต่างประเทศ', description: 'Records demonstrating compliance with FSVP requirements for exporters to US.', isRequired: true },
        ],
    },
    {
        code: 'ASEAN',
        name: 'ASEAN GHP',
        nameTH: 'มาตรฐาน ASEAN',
        description: 'ASEAN Good Hygiene Practice for Traditional Medicines and Health Supplements',
        version: 'v2021',
        isActive: true,
        sortOrder: 4,
        logoUrl: null,
        targetMarket: 'ASEAN',
        requirements: [
            { category: 'PERSONNEL', name: 'Health & Hygiene Training', nameTH: 'การฝึกอบรมสุขอนามัย', description: 'Annual training records for all personnel regarding personal hygiene and sanitation.', isRequired: true },
            { category: 'FACILITY', name: 'Pest Control System', nameTH: 'ระบบควบคุมสัตว์พาหะ', description: 'Documented pest control program with bait map and regular monitoring records.', isRequired: true },
            { category: 'PROCESS', name: 'Waste Management', nameTH: 'การจัดการของเสีย', description: 'Proper segregation and disposal of organic and inorganic waste away from production areas.', isRequired: true },
            { category: 'DOCUMENTATION', name: 'Cleaning Records', nameTH: 'บันทึกการทำความสะอาด', description: 'Daily logs of cleaning and sanitization of equipment and facilities.', isRequired: true },
        ],
    },
    {
        code: 'THAI_GACP',
        name: 'Thai GACP',
        nameTH: 'มาตรฐาน GACP ไทย',
        description: 'Good Agricultural and Collection Practice - Thailand',
        version: 'v2024',
        isActive: true,
        sortOrder: 1,
        logoUrl: null,
        targetMarket: 'DOMESTIC',
        requirements: [
            { category: 'LEGAL', name: 'Farm Registration', nameTH: 'ทะเบียนเกษตรกร', description: 'Must register with Department of Agriculture extension office.', isRequired: true },
            { category: 'PROCESS', name: 'GAP Guidelines', nameTH: 'แนวทาง GAP', description: 'Follow basic GAP guidelines for site selection and water sources.', isRequired: true },
        ],
    },
];

async function seedStandards() {
    console.log('Seeding Certification Standards...');

    for (const standardData of STANDARDS) {
        const { requirements, ...standard } = standardData;

        // Upsert Standard
        const created = await prisma.certificationStandard.upsert({
            where: { code: standard.code },
            update: standard,
            create: standard,
        });

        console.log(`${created.code}: ${created.name}`);

        // Replace this standard's requirements (idempotent re-seed).
        //
        // StandardRequirement has only @@index on (standardId)/(category) —
        // no unique constraint — so a bare `create` never throws on re-run
        // and the old `.catch(() => {})` swallowed nothing: every run *added*
        // a fresh duplicate set. Delete-then-recreate scoped to this standard
        // (mirrors seed-plants.js' documentRequirement replace) makes the
        // seed safe to re-run, which seed-all.js relies on.
        await prisma.standardRequirement.deleteMany({
            where: { standardId: created.id },
        });
        for (let i = 0; i < requirements.length; i++) {
            const req = requirements[i];
            await prisma.standardRequirement.create({
                data: {
                    standardId: created.id,
                    category: req.category,
                    name: req.name,
                    nameTH: req.nameTH,
                    description: req.description,
                    isRequired: req.isRequired,
                    sortOrder: i + 1,
                },
            });
        }
    }

    console.log('Seeding complete!');
}

seedStandards()
    .catch(e => {
        console.error('Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
