#!/usr/bin/env node
'use strict';
/**
 * Build ONE reviewable PDF for the G4 walk.
 *
 * The first G4 attempt uploaded a 70-byte 1×1 transparent PNG into all three ภท.
 * permit slots and the product accepted every one of them. That is a finding about the
 * product (recorded separately), but it also breaks the walk's own premise: GOALS §G4.0
 * rule 2 says officers must work ONLY from the documents the farmer submitted, and a
 * reviewer cannot read a blank pixel. An officer approving an invisible document proves
 * nothing about the review step.
 *
 * So the walk submits real one-page PDFs, in Thai, carrying the applicant's own details —
 * a document a human reviewer can open, read, and judge. Every page is stamped as demo
 * data so that no one can mistake it for a genuine ministry permit.
 *
 * Usage: node scripts/g4/make-document-fixture.js <out.pdf> <json-payload>
 *   payload: { code, title, description, applicant, nationalId, farmName, address, purpose }
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Sarabun is the Thai face already vendored in this repo (apps/mobile-app/assets/fonts).
// pdfkit's built-in faces are WinAnsi-only and would render Thai as blanks — which is the
// same failure mode as the pixel this fixture exists to replace.
const FONT_DIR = path.join(__dirname, '../../../mobile-app/assets/fonts');
const REGULAR = path.join(FONT_DIR, 'Sarabun-Regular.ttf');
const BOLD = path.join(FONT_DIR, 'Sarabun-Bold.ttf');

function main() {
    const [outPath, payloadJson] = process.argv.slice(2);
    if (!outPath || !payloadJson) {
        console.error('usage: make-document-fixture.js <out.pdf> <json-payload>');
        process.exit(2);
    }
    for (const f of [REGULAR, BOLD]) {
        if (!fs.existsSync(f)) {
            console.error(`FATAL: Thai font missing at ${f} — refusing to write a PDF whose Thai text would render blank`);
            process.exit(1);
        }
    }
    const d = JSON.parse(payloadJson);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    doc.registerFont('th', REGULAR);
    doc.registerFont('th-bold', BOLD);
    doc.pipe(fs.createWriteStream(outPath));

    doc.font('th-bold').fontSize(20).text(d.title, { align: 'center' });
    doc.moveDown(0.3);
    doc.font('th').fontSize(12).fillColor('#555')
        .text(`รหัสแบบฟอร์ม ${d.code}`, { align: 'center' });
    doc.moveDown(1.2);
    doc.fillColor('#000').fontSize(13).text(d.description || '');
    doc.moveDown(1);

    const row = (label, value) => {
        doc.font('th-bold').fontSize(13).text(`${label}  `, { continued: true });
        doc.font('th').text(String(value ?? '-'));
        doc.moveDown(0.35);
    };
    row('ชื่อผู้ยื่นคำขอ', d.applicant);
    row('เลขประจำตัวประชาชน', d.nationalId);
    row('ชื่อฟาร์ม', d.farmName);
    row('ที่ตั้งฟาร์ม', d.address);
    row('วัตถุประสงค์การรับรอง', d.purpose);
    row('ชนิดพืชที่ขอรับรอง', 'กัญชา');

    doc.moveDown(1.2);
    doc.font('th').fontSize(12).text(
        'ข้าพเจ้าขอรับรองว่าข้อความและเอกสารที่ยื่นมาพร้อมคำขอนี้เป็นความจริงทุกประการ '
        + 'และยินยอมให้พนักงานเจ้าหน้าที่เข้าตรวจสอบสถานที่เพาะปลูกตามที่แจ้งไว้',
        { align: 'thai_distributed' in doc ? 'left' : 'left' },
    );

    doc.moveDown(3);
    doc.font('th').fontSize(12).text('ลงชื่อ ..............................................  ผู้ยื่นคำขอ', { align: 'right' });
    doc.moveDown(0.4);
    doc.text(`(${d.applicant})`, { align: 'right' });

    // The stamp is not decoration. A file that looks like a ministry permit must say what
    // it is, on the page, in the language of the page.
    doc.moveDown(3);
    doc.font('th-bold').fontSize(11).fillColor('#b00')
        .text('เอกสารชุดทดสอบระบบ (G4) — ไม่ใช่เอกสารราชการ ใช้สำหรับการเดินระบบจริงเท่านั้น', { align: 'center' });

    doc.end();
}

main();
