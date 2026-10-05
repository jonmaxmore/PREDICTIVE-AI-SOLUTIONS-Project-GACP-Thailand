#!/usr/bin/env node
/**
 * แนบ COA ตัวอย่างเข้ากับรุ่นเก็บเกี่ยว เพื่อให้หน้าสแกนสาธารณะมีไฟล์ให้ดาวน์โหลดจริง
 * (มติ operator 2026-09-07 — "ตัว COA ที่ออกแบบไว้ ให้แปลเป็น PDF แล้วใช้เป็นไฟล์แนบ
 *  ตอนให้บุคคลทั่วไปเห็นเมื่อสแกนดูข้อมูลฟาร์ม")
 *
 * ทำไมต้องเป็นสคริปต์ ไม่ใช่ปุ่มในระบบ: COA เป็นเอกสารของห้องปฏิบัติการ ไม่ใช่ของแพลตฟอร์ม
 * ประตูจริงของเกษตรกรคือ POST /api/harvest-batches/:id/lab-results (อัปโหลดไฟล์ของห้องแล็บ)
 * และมันต้องเป็นประตูเดียวตลอดไป · ตัวนี้เติมเฉพาะ "ข้อมูลสาธิต" ให้เดโมมีของให้กดดู และมัน
 * เขียนแถวผ่าน buildLabResultRow ตัวเดียวกับประตูจริง เพื่อไม่ให้มีรูปแบบแถวสองแบบในระบบ
 *
 *   node scripts/attach-specimen-coa.js --batch=<batchNumber|id>   [--force]
 *   node scripts/attach-specimen-coa.js --list                      # รุ่นที่ยังไม่มี COA
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../services/prisma-database');
const { generateSpecimenCoaPdf } = require('../services/pdf/coa-specimen-template-service');
const { buildLabResultRow } = require('../services/batch-lab-result-service');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'lab-results');

function arg(name) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
}
const has = (name) => process.argv.includes(`--${name}`);

async function listBatchesWithoutCoa() {
    const batches = await prisma.harvestBatch.findMany({
        where: { labResults: { none: { isDeleted: false } } },
        select: {
            id: true, batchNumber: true, qrCode: true,
            farm: { select: { farmName: true, province: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });
    if (batches.length === 0) {
        console.log('ทุกรุ่นเก็บเกี่ยวมีผลวิเคราะห์แนบแล้ว');
        return;
    }
    console.log(`รุ่นที่ยังไม่มีผลวิเคราะห์ (${batches.length} รุ่นล่าสุด):`);
    for (const b of batches) {
        console.log(`  ${b.batchNumber.padEnd(22)} ${b.farm?.farmName || '—'} · ${b.id}`);
    }
}

async function attach(key, force) {
    const batch = await prisma.harvestBatch.findFirst({
        where: { OR: [{ id: key }, { batchNumber: key }, { uuid: key }] },
        include: {
            farm: { select: { farmName: true, province: true, district: true, subDistrict: true } },
            labResults: { where: { isDeleted: false }, select: { id: true, reportNumber: true } },
        },
    });
    if (!batch) { throw new Error(`ไม่พบรุ่นเก็บเกี่ยว: ${key}`); }

    if (batch.labResults.length > 0 && !force) {
        console.log(`รุ่น ${batch.batchNumber} มีผลวิเคราะห์แนบอยู่แล้ว `
            + `(${batch.labResults.map((r) => r.reportNumber || r.id).join(', ')}) — ใช้ --force เพื่อแนบเพิ่ม`);
        return;
    }

    // ใบรับรอง GACP ที่ยังใช้ได้ของฟาร์มนี้ ถ้ามี — COA อ้างถึงมันได้ แต่ไม่ใช่เงื่อนไข
    const cert = await prisma.certificate.findFirst({
        // ตัวพิมพ์ของ status ในตารางนี้เป็น lowercase ('active') — ดู schema certification.prisma
        where: { farmId: batch.farmId, status: { in: ['active', 'ACTIVE'] } },
        select: { certificateNumber: true },
        orderBy: { issuedDate: 'desc' },
    });

    const addressParts = [batch.farm?.subDistrict, batch.farm?.district, batch.farm?.province]
        .filter(Boolean);
    const { buffer, labName, reportNumber, reportedAt, verificationCode } = await generateSpecimenCoaPdf({
        batchCode: batch.batchNumber,
        clientName: batch.farm?.farmName || '—',
        clientAddress: addressParts.length ? addressParts.join(' ') : '—',
        certificateNumber: cert?.certificateNumber || '—',
    });

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const fileName = `${reportNumber}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);

    const row = buildLabResultRow({
        batch,
        file: { originalname: fileName, size: buffer.length, mimetype: 'application/pdf' },
        fileUrl: `/uploads/lab-results/${fileName}`,
        labName,
        reportNumber,
        reportedAt: reportedAt.toISOString(),
        verificationCode,
        uploadedBy: null,
    });
    row.fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const created = await prisma.batchLabResult.create({ data: row });
    console.log(`แนบแล้ว: รุ่น ${batch.batchNumber} → ${row.fileUrl} (${buffer.length} bytes)`);
    console.log(`  เลขที่รายงาน ${reportNumber} · รหัสตรวจสอบ ${verificationCode} · แถว ${created.id}`);
    if (batch.qrCode) {
        console.log(`  หน้าสแกนของรุ่นนี้: /trace/batch/${batch.qrCode}`);
    }
}

(async () => {
    try {
        if (has('list')) { await listBatchesWithoutCoa(); return; }
        const key = arg('batch');
        if (!key) {
            console.error('ต้องระบุ --batch=<batchNumber|id> หรือ --list');
            process.exitCode = 1;
            return;
        }
        await attach(key, has('force'));
    } catch (error) {
        console.error(`ล้มเหลว: ${error.message}`);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect().catch(() => {});
        process.exit(process.exitCode || 0);
    }
})();
