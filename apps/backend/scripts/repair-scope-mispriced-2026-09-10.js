#!/usr/bin/env node
'use strict';
/**
 * ซ่อมคำขอที่ถูกคิดราคาตามจำนวนรูปแบบการปลูกที่ผิด
 *
 * operator 2026-09-10 อนุมัติสองข้อ:
 *   1. คำนวณยอดของคำขอที่ถูกคิดเกินใหม่ ให้ตรงกับลักษณะพื้นที่ที่ยื่นขอจริง
 *   2. ล้าง legacy cultivationMethods ที่ขัดกับ farmData.areaTypes
 *
 * ที่มาของบั๊ก: ก่อนคำวินิจฉัย 2026-09-06 ราคาคิดจาก formData.cultivationMethods
 * คำขอที่ยื่นขอ 1 รูปแบบ แต่มี legacy ค้างอยู่ 3 รูปแบบ จึงถูกคิดราคาสามเท่า —
 * "เลือก 1 รูปแบบการปลูก ทำไมจ่ายของ 3" · โค้ดแก้แล้ว (areaTypes ชนะ legacy)
 * แต่ยอดที่คิดไว้ก่อนหน้ายังค้างในแถว และ legacy ที่เป็นต้นเหตุก็ยังอยู่
 *
 * ═══ กติกาที่สคริปต์นี้ยึด ═══
 *
 * ไม่แตะคำขอที่จ่ายเงินแล้ว — ใบที่ชำระแล้วไม่ใช่การ "คำนวณใหม่" แต่เป็นการคืนเงิน
 * ซึ่งเป็นการตัดสินใจของคน ไม่ใช่ของสคริปต์ (L3)
 *
 * ไม่ hardcode เลขคำขอ — เลือกด้วยกฎ ("ยอดที่เก็บไว้ ≠ ยอดที่คิดจากลักษณะพื้นที่ที่ยื่น")
 * ⇒ ซ่อมได้ทุกใบที่มีอาการเดียวกัน และรันซ้ำแล้วไม่ทำอะไรเพิ่ม
 *
 * ไม่คิดราคาเอง — เรียก feeService ตัวเดียวกับที่ระบบใช้จริง
 *
 * ═══ ช่องว่างที่พบ และไม่ได้แก้เอง ═══
 * QUOTATION_STATUS ไม่มีคำที่แปลว่า "ถอนเพราะคิดราคาผิด" มีแค่ REJECTED (ลูกค้าปฏิเสธ)
 * และ EXPIRED (หมดอายุ) ซึ่งทั้งคู่เล่าเรื่องผิด · สคริปต์นี้ใช้ soft-delete พร้อม
 * deleteReason ที่เป็นความจริง และตั้งสถานะ EXPIRED เพราะเป็นสถานะสิ้นสุดที่ใกล้ที่สุด
 * ที่มีอยู่ — การเพิ่มคำใหม่ในคำศัพท์เอกสารการเงินเป็นการตัดสินใจของ operator
 *
 * ใช้งาน:
 *   node scripts/repair-scope-mispriced-2026-09-10.js            # ดูอย่างเดียว ไม่แก้
 *   node scripts/repair-scope-mispriced-2026-09-10.js --apply    # แก้จริง
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { prisma } = require('../services/prisma-database');
const feeService = require('../services/fee-service');
const { collectUniqueCultivationMethods } = require('../modules/billing');

const APPLY = process.argv.includes('--apply');
const baht = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });

/** ใบที่จ่ายแล้ว = ห้ามแตะ · ตรวจทั้งสองงวด */
function isPaid(app) {
    const paid = (s) => String(s || '').toUpperCase() === 'PAID';
    return paid(app.phase1Status) || paid(app.phase2Status);
}

async function main() {
    console.log(APPLY ? '=== โหมดแก้จริง (--apply) ===' : '=== โหมดดูอย่างเดียว · ใส่ --apply เพื่อแก้จริง ===');
    console.log('');

    const apps = await prisma.application.findMany({
        where: { isDeleted: false },
        select: {
            id: true, applicationNumber: true, status: true, formData: true,
            phase1Amount: true, phase2Amount: true, phase1Status: true, phase2Status: true,
        },
    });

    const repriced = [];
    const legacyOnly = [];

    for (const app of apps) {
        const formData = (app.formData && typeof app.formData === 'object') ? app.formData : {};
        const farmData = (formData.farmData && typeof formData.farmData === 'object') ? formData.farmData : {};
        const declared = Array.isArray(farmData.areaTypes) ? farmData.areaTypes : [];
        const legacy = Array.isArray(formData.cultivationMethods) ? formData.cultivationMethods : [];

        // ใบที่ยังไม่เคยบอกลักษณะพื้นที่ ไม่มีอะไรให้เทียบ — ปล่อยไว้
        if (declared.length === 0) { continue; }

        const scopes = collectUniqueCultivationMethods(app);
        const fees = feeService.calculateApplicationFees({ ...app, formData, scopes });
        const want1 = Math.round(Number(fees.phase1.phaseTotal));
        const want2 = Math.round(Number(fees.phase2.phaseTotal));
        const has1 = Math.round(Number(app.phase1Amount || 0));
        const has2 = Math.round(Number(app.phase2Amount || 0));
        const priceWrong = has1 !== want1 || has2 !== want2;
        const legacyConflicts = legacy.length > 0;

        if (!priceWrong && !legacyConflicts) { continue; }
        const row = { app, declared, legacy, has1, has2, want1, want2, priceWrong, legacyConflicts };
        (priceWrong ? repriced : legacyOnly).push(row);
    }

    if (repriced.length === 0 && legacyOnly.length === 0) {
        console.log('ไม่พบคำขอที่ต้องซ่อม — ระบบตรงกันหมดแล้ว');
        return;
    }

    console.log(`── ยอดไม่ตรงกับลักษณะพื้นที่ที่ยื่น: ${repriced.length} ใบ ──`);
    for (const r of repriced) {
        const lock = isPaid(r.app) ? '  [ชำระแล้ว — ข้าม]' : '';
        console.log(`  ${r.app.applicationNumber}  (${r.app.status})${lock}`);
        console.log(`     ยื่นขอ    : ${r.declared.join(', ')}  (${r.declared.length} รูปแบบ)`);
        if (r.legacy.length) { console.log(`     legacy ค้าง: ${r.legacy.join(', ')}  ← ต้นเหตุ`); }
        console.log(`     งวด 1     : ${baht(r.has1)}  →  ${baht(r.want1)}`);
        console.log(`     งวด 2     : ${baht(r.has2)}  →  ${baht(r.want2)}`);
    }

    if (legacyOnly.length) {
        console.log('');
        console.log(`── ยอดถูกแล้ว แต่มี legacy ค้าง: ${legacyOnly.length} ใบ ──`);
        for (const r of legacyOnly) {
            console.log(`  ${r.app.applicationNumber}  ยื่นขอ ${r.declared.join(', ')} · legacy ${r.legacy.join(', ')}`);
        }
    }

    if (!APPLY) {
        console.log('');
        console.log('ยังไม่ได้แก้อะไร · รันซ้ำด้วย --apply เพื่อแก้จริง');
        return;
    }

    console.log('');
    console.log('── กำลังแก้ ──');
    let fixed = 0; let skipped = 0; let cleaned = 0;

    for (const r of [...repriced, ...legacyOnly]) {
        if (isPaid(r.app)) {
            console.log(`  ข้าม ${r.app.applicationNumber} — ชำระเงินแล้ว การแก้ยอดหลังชำระคือการคืนเงิน ต้องให้คนตัดสิน`);
            skipped += 1;
            continue;
        }

        await prisma.$transaction(async (tx) => {
            const formData = { ...(r.app.formData || {}) };
            if (r.legacyConflicts) {
                delete formData.cultivationMethods;
            }

            await tx.application.update({
                where: { id: r.app.id },
                data: {
                    ...(r.priceWrong ? { phase1Amount: r.want1, phase2Amount: r.want2 } : {}),
                    ...(r.legacyConflicts ? { formData } : {}),
                },
            });

            if (r.priceWrong) {
                // ใบเสนอราคาที่ถือยอดผิด ต้องไม่ค้างอยู่ให้ใครยอมรับ
                const stale = await tx.quotation.findMany({
                    where: { applicationId: r.app.id, isDeleted: false, status: { notIn: ['ACCEPTED', 'INVOICED'] } },
                    select: { id: true, quotationNumber: true, totalAmount: true },
                });
                for (const q of stale) {
                    await tx.quotation.update({
                        where: { id: q.id },
                        data: {
                            status: 'EXPIRED',
                            isDeleted: true,
                            deletedAt: new Date(),
                            deleteReason: 'REPRICED_SCOPE_CORRECTION_2026_09_10',
                        },
                    });
                    console.log(`     ถอนใบเสนอราคา ${q.quotationNumber} (${baht(q.totalAmount)})`);
                }
                const accepted = await tx.quotation.count({
                    where: { applicationId: r.app.id, isDeleted: false, status: { in: ['ACCEPTED', 'INVOICED'] } },
                });
                if (accepted > 0) {
                    throw new Error(
                        `${r.app.applicationNumber}: มีใบเสนอราคาที่ยอมรับ/ออกใบแจ้งหนี้แล้ว — หยุดทั้งรายการ ไม่แก้เงียบ`,
                    );
                }
            }
        });

        if (r.priceWrong) { fixed += 1; } else { cleaned += 1; }
        console.log(`  ✔ ${r.app.applicationNumber}`
            + (r.priceWrong ? `  ยอดใหม่ ${baht(r.want1)} / ${baht(r.want2)}` : '')
            + (r.legacyConflicts ? '  · ล้าง legacy แล้ว' : ''));
    }

    console.log('');
    console.log(`เสร็จ — แก้ยอด ${fixed} ใบ · ล้าง legacy อย่างเดียว ${cleaned} ใบ · ข้าม (ชำระแล้ว) ${skipped} ใบ`);
    console.log('ใบเสนอราคาใบใหม่จะออกให้เองตามขั้นตอนปกติเมื่อผู้ยื่นดำเนินการต่อ');
}

main()
    .catch((error) => { console.error('ล้มเหลว:', error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
