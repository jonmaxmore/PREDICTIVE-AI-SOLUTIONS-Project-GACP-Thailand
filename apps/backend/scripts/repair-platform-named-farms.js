#!/usr/bin/env node
/**
 * ซ่อมแถวฟาร์มที่ถูกแพลตฟอร์มตั้งชื่อให้เอง ให้กลับไปใช้ชื่อที่เกษตรกรประกาศในคำขอ
 *
 * ที่มา: จนถึง 2026-09-07 เส้นทางออกใบรับรองมีค่าตายตัว `farmName: requestedFarmName ||
 * 'Certified Farm'` แถวฟาร์มที่เกิดตอนออกใบรับรองจึงถูกตั้งชื่อว่า "Certified Farm" แล้วทุก
 * ประตูก็พิมพ์ต่อในฐานะชื่อฟาร์มจริง — ใบรับรอง หน้าสแกนสาธารณะทั้งสองหน้า และ COA
 * operator เห็นจากหน้าสแกนจริงและสั่งให้แก้
 *
 * โค้ดปิดทางไว้แล้วสองชั้น: (1) create ปฏิเสธเมื่อคำขอไม่ระบุชื่อ (2) reuse ถือว่าชื่อที่เป็น
 * ค่าตายตัวเก่าคือ "ยังไม่มีชื่อ" แล้วเติมชื่อจากคำขอให้ — แต่ชั้นที่ (2) ทำงานเฉพาะตอนออก
 * ใบรับรองรอบถัดไป ฟาร์มที่ออกใบไปแล้วจึงยังค้างชื่อผิด สคริปต์นี้คือการจ่ายหนี้ก้อนนั้น
 *
 * ที่มาของชื่อที่ถูก: คำขอที่ผูกกับใบรับรองของฟาร์มนั้น อ่านผ่าน readFilingSite ตัวเดียวกับ
 * ที่ทั้งเส้นทางใช้ — ไม่มีการเดา ไม่มีการแต่งชื่อ ฟาร์มที่หาชื่อจากคำขอไม่ได้จะถูกข้าม และ
 * รายงานไว้ให้คนตัดสิน ไม่ใช่ให้สคริปต์ตัดสิน
 *
 *   node scripts/repair-platform-named-farms.js            # ดูอย่างเดียว ไม่เขียน
 *   node scripts/repair-platform-named-farms.js --apply    # เขียนจริง
 */

'use strict';

const { prisma } = require('../services/prisma-database');
const { readFilingSite } = require('../services/application-service/application-farm-materialization');

/** ชื่อที่ไม่ใช่ชื่อ — ต้องตรงกับ RETIRED_FARM_NAME_STAND_INS ใน certificate-service.js */
const PLATFORM_NAMES = ['Certified Farm', 'Unknown', '-'];

const APPLY = process.argv.includes('--apply');

async function main() {
    const farms = await prisma.farm.findMany({
        where: { farmName: { in: PLATFORM_NAMES } },
        select: { id: true, farmName: true, province: true, district: true },
    });

    if (farms.length === 0) {
        console.log('ไม่มีฟาร์มที่ถูกแพลตฟอร์มตั้งชื่อ — ไม่มีอะไรต้องซ่อม');
        return;
    }
    console.log(`พบ ${farms.length} ฟาร์มที่ยังใช้ชื่อของแพลตฟอร์ม`);

    let repaired = 0;
    let skipped = 0;

    for (const farm of farms) {
        // ใบรับรองของฟาร์มนี้ → คำขอ → ชื่อสถานที่ที่เกษตรกรกรอกเอง
        const cert = await prisma.certificate.findFirst({
            where: { farmId: farm.id },
            select: { certificateNumber: true, application: { select: { id: true, formData: true } } },
            orderBy: { issuedDate: 'desc' },
        });
        const declared = cert?.application?.formData
            ? readFilingSite(cert.application.formData).farmName
            : null;

        if (!declared || PLATFORM_NAMES.includes(declared)) {
            console.log(`  ข้าม ${farm.id} (${farm.province} ${farm.district}) — คำขอไม่ได้ระบุชื่อสถานที่`);
            skipped += 1;
            continue;
        }

        console.log(`  ${farm.id}: "${farm.farmName}" → "${declared}"`
            + (cert?.certificateNumber ? `  [${cert.certificateNumber}]` : ''));

        if (APPLY) {
            // ชื่อบนใบรับรองถูกตรึงไว้ตอนออกใบ (Certificate.farmName) และเป็นส่วนหนึ่งของ
            // ข้อมูลที่เซ็น — แก้ที่นี่ไม่ได้ ใบที่พิมพ์ชื่อผิดต้องออกฉบับแก้ไขตามกติกาของมัน
            // สคริปต์นี้จึงซ่อมเฉพาะแถวฟาร์ม ซึ่งเป็นที่ที่หน้าสแกนและ COA อ่าน
            await prisma.farm.update({ where: { id: farm.id }, data: { farmName: declared } });
            repaired += 1;
        }
    }

    console.log('');
    if (APPLY) {
        console.log(`ซ่อมแล้ว ${repaired} แถว · ข้าม ${skipped} แถว`);
        console.log('หมายเหตุ: ชื่อบนใบรับรองที่ออกไปแล้วไม่ถูกแก้ (เป็นข้อมูลที่เซ็นไว้) '
            + 'ใบที่พิมพ์ชื่อผิดต้องออกฉบับแก้ไขผ่านประตูแก้ไขใบรับรอง');
    } else {
        console.log(`ยังไม่เขียนอะไร — ใส่ --apply เพื่อซ่อม ${farms.length - skipped} แถว`);
    }
}

main()
    .catch((error) => { console.error(`ล้มเหลว: ${error.message}`); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect().catch(() => {}); process.exit(process.exitCode || 0); });
