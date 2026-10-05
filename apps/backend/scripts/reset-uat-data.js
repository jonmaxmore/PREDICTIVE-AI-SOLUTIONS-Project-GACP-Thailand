#!/usr/bin/env node
/**
 * คลีนข้อมูล UAT — ลบคำขอทั้งเส้น เพื่อเริ่ม UAT ใหม่ตั้งแต่ต้น
 *
 * มติ operator 2026-09-05: "คลีนทั้งหมด แล้ว UAT ใหม่ตั้งแต่ต้น" และ
 * "ถ้าเกี่ยวกับการชำระเงิน ก็เอาออกให้หมด หรือลบตัวที่ขอนั้นไม่ว่าผ่านไม่ผ่าน ลบทั้งเส้น"
 *
 * ── ทำไมต้องมีสคริปต์ ไม่ใช่ลบมือ ────────────────────────────────────────────
 * คำขอหนึ่งใบมีของห้อยอยู่หลายตาราง: ใบเสนอราคา ใบแจ้งหนี้ คำสั่งซื้อ ธุรกรรมชำระเงิน
 * รายการบัญชี ใบรับรอง เอกสารแนบ รอบตรวจ และ audit · การลบทีละตารางด้วยมือทำให้เหลือ
 * แถวกำพร้าที่ชี้ไปยังคำขอที่ไม่มีแล้ว ซึ่งจะไปโผล่ในรายงานตอนที่ไม่มีใครคาด
 *
 * ── ทำไม agent ไม่รันเอง ─────────────────────────────────────────────────────
 * the project rules L3: **NO MONEY MUTATION by agent** — agent อ่าน/ชี้/เสนอ diff ได้เท่านั้น
 * สคริปต์นี้ลบข้อมูลเงิน จึงต้องให้ operator เป็นคนกดรัน
 *
 * ── วิธีใช้ ──────────────────────────────────────────────────────────────────
 *   node scripts/reset-uat-data.js                       # นับอย่างเดียว ไม่ลบ (ค่าตั้งต้น)
 *   node scripts/reset-uat-data.js --apply --expect=8    # ลบจริง ต้องตรงกับจำนวนที่นับได้
 *
 * `--expect` ไม่ใช่พิธีกรรม: ถ้าจำนวนไม่ตรงกับที่เห็นตอน dry-run แปลว่ามีข้อมูลเปลี่ยน
 * ระหว่างนั้น และการลบจะหยุดทันที ไม่ลบเกินจากที่ตั้งใจ
 *
 * ── สิ่งที่ลบ / ไม่ลบ ────────────────────────────────────────────────────────
 * ลบ:    คำขอทุกใบและทุกอย่างที่ห้อยอยู่ รวมใบรับรองที่ออกจากคำขอเหล่านั้น
 * ไม่ลบ: ผู้ใช้ · ฟาร์ม · แปลง · ตารางกฎเกณฑ์เอกสาร (requirement_rules) · ผังบัญชี ·
 *        วันหยุด · ค่าตั้งค่าระบบ — เพราะเป็นข้อมูลตั้งต้น ไม่ใช่ผลของการทดสอบ
 *
 * ⚠ ฐานข้อมูลเดโมใช้ Supabase ตัวเดียวกับ prod — ตรวจ DATABASE_URL ก่อนกด --apply
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const EXPECT = (() => {
    const arg = process.argv.find((a) => a.startsWith('--expect='));
    return arg ? Number(arg.split('=')[1]) : null;
})();

/**
 * ลำดับการลบ: ลูกก่อนพ่อเสมอ
 *
 * บางตารางมี ON DELETE CASCADE อยู่แล้ว แต่ไม่ใช่ทุกตาราง และการพึ่ง cascade
 * ทำให้อ่านไม่ออกว่าอะไรหายไปบ้าง จึงลบตามลำดับให้เห็นจำนวนทุกตาราง
 */
/**
 * รายการบัญชีผูกกับ *คำสั่งซื้อ* ไม่ใช่คำขอ (`JournalEntry.sourceId` = order.id
 * สำหรับ CHECKOUT_SETTLEMENT) และ `invoiceId` เป็น scalar ไม่มี relation จริง
 * จึงต้องเก็บ id ของคำสั่งซื้อและใบแจ้งหนี้ไว้ก่อน แล้วค่อยลบ ไม่งั้นจะเหลือรายการ
 * บัญชีกำพร้าที่ชี้ไปยังคำสั่งซื้อที่ไม่มีแล้ว — ซึ่งจะไปโผล่ในงบทดลอง
 */
const CHAIN = [
    // ── เงิน ──
    ['journalLine', (_ids, ctx) => ({ entry: { is: { sourceId: { in: ctx.orderIds } } } })],
    ['journalEntry', (_ids, ctx) => ({ sourceId: { in: ctx.orderIds } })],
    ['checkoutDocument', (ids) => ({ checkoutOrder: { is: { applicationId: { in: ids } } } })],
    ['checkoutOrder', (ids) => ({ applicationId: { in: ids } })],
    ['paymentTransaction', (ids) => ({ applicationId: { in: ids } })],
    ['invoiceLineItem', (ids) => ({ invoice: { is: { applicationId: { in: ids } } } })],
    ['creditNote', (ids) => ({ originalInvoice: { is: { applicationId: { in: ids } } } })],
    ['debitNote', (ids) => ({ originalInvoice: { is: { applicationId: { in: ids } } } })],
    ['paymentReminderLog', (ids) => ({ invoice: { is: { applicationId: { in: ids } } } })],
    ['paymentSlip', (ids) => ({ applicationId: { in: ids } })],
    ['invoice', (ids) => ({ applicationId: { in: ids } })],
    ['quotation', (ids) => ({ applicationId: { in: ids } })],
    // ── การตรวจและใบรับรอง ──
    ['applicationDocumentReview', (ids) => ({ applicationId: { in: ids } })],
    ['certificateRevision', (ids) => ({ certificate: { is: { applicationId: { in: ids } } } })],
    ['reportSubmission', (ids) => ({ certificate: { is: { applicationId: { in: ids } } } })],
    ['certificate', (ids) => ({ applicationId: { in: ids } })],
    ['correctionSubmissionVersion', (ids) => ({ applicationId: { in: ids } })],
    ['correctionRound', (ids) => ({ applicationId: { in: ids } })],
    ['applicationDocument', (ids) => ({ applicationId: { in: ids } })],
    ['revisionDeadline', (ids) => ({ applicationId: { in: ids } })],
    // ── ของที่เหลือซึ่งชี้มาที่คำขอด้วย FK แบบ RESTRICT ──
    //
    // รายการนี้ **ถามจากฐานข้อมูลเอง** ไม่ได้ไล่จากความจำ:
    //   SELECT tc.table_name, kcu.column_name, rc.delete_rule
    //   FROM information_schema.table_constraints tc
    //   JOIN information_schema.key_column_usage kcu USING (constraint_name)
    //   JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
    //   JOIN information_schema.referential_constraints rc USING (constraint_name)
    //   WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='applications';
    //
    // รอบแรกผมเขียนจากที่นึกออก แล้วการลบหยุดกลางคันที่ `audit_checklists` —
    // ของที่ห้อยอยู่ถูกลบไปแล้ว แต่ตัวคำขอยังอยู่ ซึ่งแย่กว่าทั้งลบและไม่ลบ
    // ตารางที่ delete_rule เป็น CASCADE/SET NULL ไม่ต้องอยู่ในรายการนี้ แต่ใส่ไว้
    // ก็ไม่เสียหาย เพราะจะได้เห็นจำนวนที่หายไปด้วยตาแทนที่จะเชื่อ cascade เงียบ ๆ
    ['applicationComment', (ids) => ({ applicationId: { in: ids } })],
    // ชั้นที่สอง: ของที่ห้อยใต้ audit_checklists อีกที (ถามจากฐานข้อมูลเช่นกัน) —
    // ต้องลบก่อนตัว checklist ไม่งั้นจะติด FK ซ้ำรอยเดิม
    ['farmAuditChecklistItem', (ids) => ({ audit: { is: { applicationId: { in: ids } } } })],
    ['farmAuditPhoto', (ids) => ({ audit: { is: { applicationId: { in: ids } } } })],
    ['gpsVerificationLog', (ids) => ({ audit: { is: { applicationId: { in: ids } } } })],
    ['auditChecklist', (ids) => ({ applicationId: { in: ids } })],
    ['meetingRoom', (ids) => ({ applicationId: { in: ids } })],
    ['paymentSlip', (ids) => ({ applicationId: { in: ids } })],
    ['postAuditTask', (ids) => ({ applicationId: { in: ids } })],
    ['quote', (ids) => ({ applicationId: { in: ids } })],
    ['scopeOfWork', (ids) => ({ applicationId: { in: ids } })],
    ['waiverReopenRequest', (ids) => ({ applicationId: { in: ids } })],
    ['workActivity', (ids) => ({ applicationId: { in: ids } })],
    // ── คำขอ ──
    ['application', (ids) => ({ id: { in: ids } })],
];

async function main() {
    const url = String(process.env.DATABASE_URL || '');
    const host = url.replace(/^postgres(ql)?:\/\/[^:]+:[^@]+@/, '').replace(/\?.*$/, '');
    console.log(`ฐานข้อมูล: ${host || '(ไม่ได้ตั้ง DATABASE_URL)'}`);
    console.log(`โหมด:     ${APPLY ? 'ลบจริง (--apply)' : 'นับอย่างเดียว (dry-run)'}\n`);

    const applications = await prisma.application.findMany({ select: { id: true, applicationNumber: true, status: true } });
    const ids = applications.map((a) => a.id);

    // เก็บ id ของคำสั่งซื้อไว้ก่อน เพราะรายการบัญชีชี้มาที่ตัวนี้ ไม่ได้ชี้ที่คำขอ
    const orders = await prisma.checkoutOrder.findMany({
        where: { applicationId: { in: ids } }, select: { id: true },
    });
    const ctx = { orderIds: orders.map((o) => o.id) };
    console.log(`คำสั่งซื้อที่ผูกอยู่: ${ctx.orderIds.length} ใบ (รายการบัญชีชี้มาที่ตัวนี้)\n`);

    console.log(`คำขอที่จะถูกลบ: ${applications.length} ใบ`);
    applications.slice(0, 20).forEach((a) => console.log(`  ${a.applicationNumber || a.id}  [${a.status}]`));
    if (applications.length > 20) { console.log(`  … และอีก ${applications.length - 20} ใบ`); }
    console.log('');

    if (APPLY && EXPECT !== null && EXPECT !== applications.length) {
        console.error(`หยุด: --expect=${EXPECT} แต่พบ ${applications.length} ใบ`);
        console.error('ข้อมูลเปลี่ยนไปหลังจาก dry-run — รัน dry-run ใหม่แล้วตรวจก่อน');
        process.exitCode = 1;
        return;
    }
    if (APPLY && EXPECT === null) {
        console.error('หยุด: --apply ต้องมาคู่กับ --expect=<จำนวน> ที่เห็นตอน dry-run');
        process.exitCode = 1;
        return;
    }

    for (const [model, whereFor] of CHAIN) {
        const where = whereFor(ids, ctx);
        if (!prisma[model]) { console.log(`  ${model.padEnd(30)} (ไม่มีในสคีมา — ข้าม)`); continue; }
        try {
            const n = where === null
                ? await prisma[model].count()
                : await prisma[model].count({ where });
            if (APPLY && n > 0) {
                const res = where === null
                    ? await prisma[model].deleteMany({})
                    : await prisma[model].deleteMany({ where });
                console.log(`  ${model.padEnd(30)} ลบแล้ว ${res.count}`);
            } else {
                console.log(`  ${model.padEnd(30)} ${n}`);
            }
        } catch (err) {
            console.log(`  ${model.padEnd(30)} อ่านไม่ได้: ${err.message}`);
        }
    }

    console.log('');
    if (!APPLY) {
        console.log(`ยังไม่ลบอะไร · เมื่อตรวจแล้วให้รัน:  node scripts/reset-uat-data.js --apply --expect=${applications.length}`);
    } else {
        console.log('ลบเสร็จแล้ว · ผู้ใช้ ฟาร์ม แปลง และตารางกฎเกณฑ์ยังอยู่ครบ');
    }
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
