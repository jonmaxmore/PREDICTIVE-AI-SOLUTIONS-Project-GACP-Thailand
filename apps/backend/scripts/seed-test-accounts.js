/**
 * สร้างบัญชีทดสอบสำหรับทุกแผนก (2 บัญชีต่อแผนก)
 * 
 * แผนกทั้งหมด:
 *   1. เกษตรกร (Applicant)         - เข้าระบบที่ /login ด้วย Health ID
 *   2. ผู้ดูแลระบบ (ADMIN)       - เข้าระบบที่ /provider/login ด้วย Provider ID
 *   3. ผู้ตรวจเอกสาร (REVIEWER)  - เข้าระบบที่ /provider/login ด้วย Provider ID
 *   4. ผู้จัดตาราง (SCHEDULER)   - เข้าระบบที่ /provider/login ด้วย Provider ID
 *   5. ผู้ตรวจพื้นที่ (AUDITOR)   - เข้าระบบที่ /provider/login ด้วย Provider ID
 *   6. การเงิน (ACCOUNTANT)     - เข้าระบบที่ /provider/login ด้วย Provider ID
 * 
 * Usage:
 *   node scripts/seed-test-accounts.js                                    (local)
 *   docker exec gacp-backend node scripts/seed-test-accounts.js            (docker)
 *   ssh root@203.0.113.10 "docker exec gacp-backend node scripts/seed-test-accounts.js"
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { runWithTenantContext } = require('../services/tenant-context');

const prisma = new PrismaClient();

// ─── Valid Thai National IDs (checksum-valid) ───────────────────────────
// These are synthetic IDs that pass the checksum algorithm but are NOT real people.
function generateThaiId(prefix) {
    // Use a deterministic seed for reproducibility
    const digits = prefix.split('').map(Number);
    while (digits.length < 12) {
        digits.push(Math.floor(Math.random() * 10));
    }
    // Calculate checksum (digit 13)
    const weights = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += digits[i] * weights[i];
    }
    const checkDigit = (11 - (sum % 11)) % 10;
    digits.push(checkDigit);
    return digits.join('');
}

// Pre-computed valid Thai IDs (deterministic, checksum-valid)
const THAI_IDS = {
    // Applicants (Health Portal) - prefix 1
    Applicant1: generateThaiId('110000000000'),
    Applicant2: generateThaiId('110000000001'),
    // Admin - prefix 2
    admin1: generateThaiId('290000000000'),
    admin2: generateThaiId('290000000001'),
    // Reviewer - prefix 3
    reviewer1: generateThaiId('390000000000'),
    reviewer2: generateThaiId('390000000001'),
    // Scheduler - prefix 4
    scheduler1: generateThaiId('490000000000'),
    scheduler2: generateThaiId('490000000001'),
    // Auditor - prefix 5
    auditor1: generateThaiId('590000000000'),
    auditor2: generateThaiId('590000000001'),
    // Accountant - prefix 6
    accountant1: generateThaiId('690000000000'),
    accountant2: generateThaiId('690000000001'),
};

const DEFAULT_PASSWORD = 'Test@12345';

// ─── Test accounts definition ───────────────────────────────────────────
const TEST_ACCOUNTS = [
    // ═══ Professional Test Account (YOLO Mode Identity) ═══
    {
        label: '🌟 Professional #1',
        portal: 'Health',
        loginField: 'healthId',
        loginId: '4310100001149',
        email: 'professional-tester@gacp-test.local',
        firstName: 'ทดสอบ',
        lastName: 'โปร',
        role: 'HEALTH',
        accountType: 'INDIVIDUAL',
        authType: 'HEALTH_ID',
    },

    // ═══ เกษตรกร (Applicant) - Health Portal ═══
    {
        label: 'เกษตรกร #1',
        portal: 'Health',
        loginField: 'healthId',
        loginId: THAI_IDS.Applicant1,
        email: 'Applicant-test-1@gacp-test.local',
        firstName: 'สมชาย',
        lastName: 'ทดสอบ',
        role: 'HEALTH',
        accountType: 'INDIVIDUAL',
        authType: 'HEALTH_ID',
    },
    {
        label: 'เกษตรกร #2',
        portal: 'Health',
        loginField: 'healthId',
        loginId: THAI_IDS.Applicant2,
        email: 'Applicant-test-2@gacp-test.local',
        firstName: 'สมหญิง',
        lastName: 'ทดสอบ',
        role: 'HEALTH',
        accountType: 'INDIVIDUAL',
        authType: 'HEALTH_ID',
    },

    // ═══ ผู้ดูแลระบบ (ADMIN) - Provider Portal ═══
    {
        label: 'ผู้ดูแลระบบ #1',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.admin1,
        email: 'admin-test-1@gacp-test.local',
        firstName: 'แอดมิน',
        lastName: 'หนึ่ง',
        role: 'ADMIN',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },
    {
        label: 'ผู้ดูแลระบบ #2',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.admin2,
        email: 'admin-test-2@gacp-test.local',
        firstName: 'แอดมิน',
        lastName: 'สอง',
        role: 'ADMIN',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },

    // ═══ ผู้ตรวจสอบเอกสาร (REVIEWER) - Provider Portal ═══
    {
        label: 'ผู้ตรวจเอกสาร #1',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.reviewer1,
        email: 'reviewer-test-1@gacp-test.local',
        firstName: 'ผู้ตรวจ',
        lastName: 'เอกสารหนึ่ง',
        role: 'REVIEWER_AUDITOR',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },
    {
        label: 'ผู้ตรวจเอกสาร #2',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.reviewer2,
        email: 'reviewer-test-2@gacp-test.local',
        firstName: 'ผู้ตรวจ',
        lastName: 'เอกสารสอง',
        role: 'REVIEWER_AUDITOR',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },

    // ═══ ผู้จัดตารางนัดหมาย (SCHEDULER) - Provider Portal ═══
    {
        label: 'ผู้จัดตาราง #1',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.scheduler1,
        email: 'scheduler-test-1@gacp-test.local',
        firstName: 'ผู้จัด',
        lastName: 'ตารางหนึ่ง',
        role: 'SCHEDULER',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },
    {
        label: 'ผู้จัดตาราง #2',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.scheduler2,
        email: 'scheduler-test-2@gacp-test.local',
        firstName: 'ผู้จัด',
        lastName: 'ตารางสอง',
        role: 'SCHEDULER',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },

    // ═══ ผู้ตรวจสอบพื้นที่ (AUDITOR) - Provider Portal ═══
    {
        label: 'ผู้ตรวจพื้นที่ #1',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.auditor1,
        email: 'auditor-test-1@gacp-test.local',
        firstName: 'ผู้ตรวจ',
        lastName: 'พื้นที่หนึ่ง',
        role: 'AUDITOR',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },
    {
        label: 'ผู้ตรวจพื้นที่ #2',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.auditor2,
        email: 'auditor-test-2@gacp-test.local',
        firstName: 'ผู้ตรวจ',
        lastName: 'พื้นที่สอง',
        role: 'AUDITOR',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },

    // ═══ การเงิน/บัญชี (ACCOUNTANT) - Provider Portal ═══
    {
        label: 'การเงิน #1',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.accountant1,
        email: 'accountant-test-1@gacp-test.local',
        firstName: 'การเงิน',
        lastName: 'หนึ่ง',
        role: 'ACCOUNTANT',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },
    {
        label: 'การเงิน #2',
        portal: 'Provider',
        loginField: 'providerId',
        loginId: THAI_IDS.accountant2,
        email: 'accountant-test-2@gacp-test.local',
        firstName: 'การเงิน',
        lastName: 'สอง',
        role: 'ACCOUNTANT',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
    },
];

// ─── Main seed function ─────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║ สร้างบัญชีทดสอบสำหรับทุกแผนก (2 × 6 = 12 บัญชี) ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });

    await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const account of TEST_ACCOUNTS) {
        try {
            const idHash = crypto.createHash('sha256').update(account.loginId).digest('hex');

            const data = {
                email: account.email,
                password: hashedPassword,
                firstName: account.firstName,
                lastName: account.lastName,
                role: account.role,
                accountType: account.accountType,
                authType: account.authType,
                status: 'ACTIVE',
                isEmailVerified: true,
                ministryVerified: true,
                // canonicalId is required @unique on User; equals the Thai
                // ID (healthId or providerId) per provider-user-service.js.
                canonicalId: account.loginId,
                // ADR-014 multi-tenant: every User row needs explicit
                // organizationId. tenant-context middleware also exists but
                // Prisma needs the FK on direct creates.
                organizationId: defaultOrg.id,
            };

            // Set the right ID field based on portal
            if (account.loginField === 'healthId') {
                data.healthId = account.loginId;
                data.healthIdHash = idHash;
            } else {
                data.providerId = account.loginId;
                data.providerIdHash = idHash;
            }

            // Upsert by email
            const user = await prisma.user.upsert({
                where: { email: account.email },
                update: {
                    password: hashedPassword,
                    role: account.role,
                    accountType: account.accountType,
                    authType: account.authType,
                    status: 'ACTIVE',
                    isEmailVerified: true,
                    ministryVerified: true,
                    ...(account.loginField === 'healthId'
                        ? { healthId: account.loginId, healthIdHash: idHash }
                        : { providerId: account.loginId, providerIdHash: idHash }),
                },
                create: data,
            });

            const isNew = user.createdAt.getTime() === user.updatedAt.getTime();
            if (isNew) {
                console.log(`สร้างใหม่: ${account.label}`);
                created++;
            } else {
                console.log(`อัปเดต: ${account.label}`);
                updated++;
            }
        } catch (error) {
            console.error(`ล้มเหลว: ${account.label} — ${error.message}`);
            failed++;
        }
    }

    // ─── Print summary table ────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║ สรุปบัญชีทดสอบ · รหัสผ่านทุกบัญชี: Test@12345 ║');
    console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log('║  แผนก              │ Portal   │ Login ID (13 หลัก)  │ URL                           ║');
    console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');

    for (const account of TEST_ACCOUNTS) {
        const dept = account.label.padEnd(18);
        const portal = account.portal.padEnd(8);
        const id = account.loginId.padEnd(19);
        const url = account.portal === 'Health' ? '/login' : '/provider/login';
        console.log(`║  ${dept} │ ${portal} │ ${id} │ ${url.padEnd(30)}║`);
    }

    console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');

    console.log(`\n ผลลัพธ์: สร้างใหม่ ${created} | อัปเดต ${updated} | ล้มเหลว ${failed}`);
    });
}

main()
    .catch((e) => {
        console.error('เกิดข้อผิดพลาด:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
