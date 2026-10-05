const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_CONFIGS = [
    {
        key: 'system_maintenance_mode',
        value: 'false',
        type: 'BOOLEAN',
        description: 'Enable maintenance mode (block all non-admin access)',
    },
    {
        key: 'feature_registration_enabled',
        value: 'true',
        type: 'BOOLEAN',
        description: 'Allow new Applicant registrations',
    },
    {
        key: 'service_organic_enabled',
        value: 'true',
        type: 'BOOLEAN',
        description: 'Enable Organic Certification service flow',
    },
    {
        key: 'marketing_banner_active',
        value: 'false',
        type: 'BOOLEAN',
        description: 'Show promotional banner on dashboard',
    },
    {
        key: 'contact_support_phone',
        value: '02-123-4567',
        type: 'STRING',
        description: 'Support phone number displayed in footer',
    },
    // ── Sprint 0-5 Feature Flags ──────────────────────────────────────────────
    {
        key: 'feature.task_router',
        value: 'true',
        type: 'BOOLEAN',
        description: 'แสดง Task Router (หน้าเริ่มต้นเลือกบริการ)',
    },
    {
        key: 'feature.readiness_check',
        value: 'true',
        type: 'BOOLEAN',
        description: 'แสดง Readiness Check (ตรวจความพร้อมก่อนยื่นคำขอ)',
    },
    {
        key: 'feature.document_repo',
        value: 'true',
        type: 'BOOLEAN',
        description: 'แสดง Document Repository (เอกสารของฉัน)',
    },
    {
        key: 'feature.sop_library',
        value: 'true',
        type: 'BOOLEAN',
        description: 'แสดง SOP Library (ดาวน์โหลดแบบฟอร์ม SOP 8 หมวด)',
    },
    {
        key: 'feature.report_center',
        value: 'true',
        type: 'BOOLEAN',
        description: 'แสดง Report Center (ส่งรายงานรายเดือน ภ.ท.27/28)',
    },
    {
        key: 'feature.official_templates',
        value: 'true',
        type: 'BOOLEAN',
        description: 'แสดง Official Document Center (เอกสารทางการ)',
    },
    {
        key: 'feature.export_documents',
        value: 'false',
        type: 'BOOLEAN',
        description: 'แสดง Export Documents (เอกสารส่งออก) · เร็ว ๆ นี้',
    },
    // ── DTAM Permit Form Flags ─────────────────────────────────────────────────
    {
        key: 'feature.permit_forms',
        value: 'false',
        type: 'BOOLEAN',
        description: 'แสดงแบบฟอร์มใบอนุญาต ภ.ท.09/10/11/12 (รอทีมอื่นทำฟอร์มเต็ม)',
    },
];

async function main() {
    console.log('Seeding System Configurations...');

    for (const config of DEFAULT_CONFIGS) {
        await prisma.systemConfig.upsert({
            where: { key: config.key },
            update: {}, // Don't overwrite if exists (preserve admin changes)
            create: config,
        });
    }

    console.log('System Configuration seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
