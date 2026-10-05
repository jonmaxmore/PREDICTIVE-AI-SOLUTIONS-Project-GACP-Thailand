#!/usr/bin/env node
'use strict';

/**
 * คณะพนักงานที่ demo ยังขาด — เพื่อให้เดินได้ครบทุกแผนกจริง ๆ
 *
 * prisma/seed-gacp.js สร้างพนักงานไว้ห้าคน ซึ่งพอสำหรับเส้นทางหลัก แต่ยังเดินไม่ครบสองจุด
 * ที่ระบบจริงบังคับ:
 *
 *   1) ผู้ตัดสินการรับรอง — ISO/IEC 17065 §7.6 กำหนดว่าคนที่ "ตัดสินให้การรับรอง" ต้องไม่ใช่
 *      คนเดียวกับที่ลงไปตรวจแปลง จึงต้องมีผู้ตรวจประเมินอย่างน้อยสองตัวตน
 *      (seed มี auditor2 อยู่ในรายการแล้ว แต่ demo ถูกสร้างก่อนหน้านั้นจึงยังไม่มี)
 *   2) การเงินสองฝั่ง — มติ F-SCOPE-01 (operator 2026-09-07) แยกสิ่งที่ฝ่ายการเงินเห็นออกจาก
 *      ข้อมูลแปลง และค่าธรรมเนียมมีสองเจ้าของเงิน (กรม / แพลตฟอร์ม) ที่ออกเอกสารคนละใบ
 *      บัญชี role รวม 'account' เดิมแสดงเรื่องนี้ไม่ได้เพราะมีตัวตนเดียว
 *      **ไม่แตะบัญชี 'account' เดิม** — การแปลง role ของแถวที่มีอยู่เป็นมติที่ต้องบันทึก
 *      (scripts/migrate-account-role.js) ไม่ใช่สิ่งที่ fixture ตัดสินเงียบ ๆ
 *   3) ผู้ดูแลแพลตฟอร์ม — มีเมนูและประตูข้ามผู้เช่าอยู่จริง แต่ไม่มีตัวตนให้เข้า
 *
 * เขียนคอลัมน์ค้นหาผ่าน identityLookupColumns เหมือนประตูสมัครสมาชิก — เขียนแต่ *Hash
 * เท่ากับสร้างบัญชีที่ล็อกอินไม่ได้บนเครื่องที่เปิด AUTH_LOOKUP_USE_HMAC (เกิดมาแล้วบน demo)
 *
 * ปลอดภัยที่จะรันซ้ำ: upsert ด้วย providerIdHash · ไม่แตะ role และ password ของแถวที่มีอยู่
 * ด้วยเหตุผลเดียวกับ seed-gacp.js (รหัสผ่านของบัญชีที่มีอยู่คือ credential ไม่ใช่ fixture)
 *
 * วิธีใช้:
 *   node apps/backend/scripts/seed-demo-staff.js              # แสดงว่าจะทำอะไร ไม่เขียน
 *   node apps/backend/scripts/seed-demo-staff.js --apply      # เขียนจริง
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const {
    identityLookupColumns,
    AUTH_TYPE_PROVIDER,
} = require('../services/auth/identity-lookup-columns');

const BCRYPT_ROUNDS = 12;
/** ชุดเดียวกับพนักงานที่ seed-gacp.js สร้าง เพื่อให้เอกสารบัญชีของ demo เหลือรหัสผ่านชุดเดียว */
const OFFICER_PASSWORD = process.env.DEMO_OFFICER_PASSWORD || 'Gacp@2025';

const STAFF = [
    {
        // ผู้อนุมัติใบรับรอง (F-CERT-SOD 2026-09-10) — เคยเป็น role 'auditor' คนที่สอง
        // ที่อาศัยแค่ "เป็นคนละ id" เป็นด่าน · ตอนนี้ถือบทบาทของตัวเอง
        providerId: '2222222222223',
        firstName: 'วิชัย',
        lastName: 'รับรองผล',
        role: CANONICAL_ROLES.CERTIFICATE_APPROVER,
        email: 'approver@gacp.go.th',
        title: 'ผู้อนุมัติใบรับรอง',
    },
    {
        providerId: '5555555555555',
        firstName: 'อรวรรณ',
        lastName: 'การเงินกรม',
        role: CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
        email: 'account.dtam@gacp.go.th',
        title: 'เจ้าหน้าที่การเงิน กรมการแพทย์แผนไทยฯ',
    },
    {
        providerId: '6666666666666',
        firstName: 'ธีรศักดิ์',
        lastName: 'การเงินแพลตฟอร์ม',
        role: CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
        email: 'account.platform@gacp.go.th',
        title: 'เจ้าหน้าที่การเงิน ผู้ให้บริการแพลตฟอร์ม',
    },
    {
        providerId: '7777777777777',
        firstName: 'ณิชา',
        lastName: 'ดูแลแพลตฟอร์ม',
        role: CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
        email: 'platform.admin@gacp.go.th',
        title: 'ผู้ดูแลแพลตฟอร์ม (ข้ามผู้เช่า)',
    },
];

const hashId = (id) => crypto.createHash('sha256').update(id).digest('hex');

async function main() {
    const apply = process.argv.includes('--apply');
    const prisma = new PrismaClient();
    const summary = [];

    try {
        const org = await prisma.organization.findFirst({ where: { slug: 'default' } })
            || await prisma.organization.findFirst();
        if (!org) { throw new Error('no organization row to attach staff to'); }

        const password = await bcrypt.hash(OFFICER_PASSWORD, BCRYPT_ROUNDS);

        for (const s of STAFF) {
            const existing = await prisma.user.findFirst({
                where: { providerIdHash: hashId(s.providerId) },
                select: { id: true, role: true },
            });

            if (existing) {
                summary.push({ providerId: s.providerId, role: existing.role, action: 'ALREADY THERE' });
                continue;
            }
            if (!apply) {
                summary.push({ providerId: s.providerId, role: s.role, action: 'WOULD CREATE' });
                continue;
            }

            await prisma.user.create({
                data: {
                    email: s.email,
                    password,
                    firstName: s.firstName,
                    lastName: s.lastName,
                    authType: AUTH_TYPE_PROVIDER,
                    canonicalId: s.providerId,
                    providerId: s.providerId,
                    idCard: s.providerId,
                    ...identityLookupColumns(s.providerId, AUTH_TYPE_PROVIDER),
                    role: s.role,
                    accountType: 'PROVIDER',
                    status: 'ACTIVE',
                    ministryVerified: true,
                    ministryVerifiedAt: new Date(),
                    organizationId: org.id,
                },
            });
            summary.push({ providerId: s.providerId, role: s.role, action: 'CREATED' });
        }

        console.log(JSON.stringify({ apply, summary }, null, 2));
        for (const s of STAFF) { console.log(`${s.title}: ${s.providerId}`); }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
