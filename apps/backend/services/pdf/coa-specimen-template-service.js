/**
 * แผ่น COA ตัวอย่าง → ไฟล์ PDF (มติ operator 2026-09-07)
 *
 * ทำไมมีไฟล์นี้: หน้าสแกนสาธารณะเปิดให้ดาวน์โหลดไฟล์ COA ได้ตั้งแต่มติ 2026-09-05 แต่บน
 * เดโมไม่มีไฟล์จริงให้ดาวน์โหลดสักฉบับ ผู้ซื้อที่สแกนจึงเห็นการ์ด "มีผลตรวจแล้ว" ที่กดแล้ว
 * ไม่มีอะไร · แบบที่ออกแบบไว้ (docs/design/artifacts/2026-09-05-coa-anatomy.html) เป็น HTML
 * อยู่แล้ว จึงแปลเป็น PDF ด้วยเครื่องมือเดิมของ repo ได้ตรง ๆ
 *
 * เส้นที่ห้ามข้าม: **แพลตฟอร์มไม่ใช่ห้องปฏิบัติการ** เอกสารนี้ไม่ใช่ผลตรวจ และต้องไม่มีวัน
 * ถูกเข้าใจผิดว่าเป็น ⇒
 *   1. ลายน้ำ "ไม่ใช่รายงานผลการวิเคราะห์จริง" อยู่ในเทมเพลต ถอดไม่ได้จากฝั่งข้อมูล
 *   2. ชื่อห้องแล็บถูกบังคับให้มีคำว่า (ตัวอย่าง) และเลขที่รายงานขึ้นต้น TR-SPECIMEN-
 *   3. ฟังก์ชันนี้ปฏิเสธที่จะทำงานบนเครื่องจริงของกระทรวง (ดู assertNotMinistryProduction)
 * ค่าที่พิมพ์ในตารางเป็นค่าสาธิต — ระบบไม่ได้เก็บค่าเหล่านี้เป็นฟิลด์ (มติ 5 ก.ย. "ไม่แกะตัวเลข
 * ออกมาเก็บซ้ำ") ไฟล์คือแหล่งความจริงเดียว และการตัดสินผ่าน/ไม่ผ่านเป็นของห้องแล็บ
 */

'use strict';

const path = require('path');
const fs = require('fs');
const pdfGenerator = require('./pdf-generator.service');
const { formatThaiDateFull } = require('../../utils/thai-format');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'coa-specimen.html');

/** ชื่อห้องแล็บตัวอย่าง — คำว่า (ตัวอย่าง) เป็นส่วนหนึ่งของชื่อ ไม่ใช่คำอธิบายที่ตัดออกได้ */
const SPECIMEN_LAB_NAME = 'ห้องปฏิบัติการวิเคราะห์ (ตัวอย่าง)';
const SPECIMEN_REPORT_PREFIX = 'TR-SPECIMEN-';

/**
 * ตารางผลชุดสาธิต — โครงเดียวกับแบบที่ออกแบบไว้: สารสำคัญ · โลหะหนัก · สารกำจัดศัตรูพืช ·
 * จุลินทรีย์ · สารพิษจากเชื้อราและคุณลักษณะทั่วไป · คอลัมน์ "เกณฑ์" พูดว่า "ตามมาตรฐานอ้างอิง"
 * ไม่พิมพ์ตัวเลขเกณฑ์เอง เพราะเกณฑ์เป็นของประกาศ ไม่ใช่ของเรา
 */
const SPECIMEN_RESULTS = [
    ['grp', 'สารสำคัญ · Cannabinoid profile'],
    ['row', 'Δ9-THC', '0.14', '% w/w', 'ตามมาตรฐานอ้างอิง', 'HPLC-DAD', 'ผ่าน'],
    ['row', 'THCA', '0.32', '% w/w', 'รายงานค่า', 'HPLC-DAD', ''],
    ['row', 'Total THC', '0.42', '% w/w', 'ตามมาตรฐานอ้างอิง', 'คำนวณ', 'ผ่าน'],
    ['row', 'CBD', '7.85', '% w/w', 'รายงานค่า', 'HPLC-DAD', ''],
    ['row', 'CBDA', '2.10', '% w/w', 'รายงานค่า', 'HPLC-DAD', ''],
    ['grp', 'โลหะหนัก · Heavy metals'],
    ['row', 'ตะกั่ว (Pb)', '< 0.05', 'mg/kg', 'ตามมาตรฐานอ้างอิง', 'ICP-MS', 'ผ่าน'],
    ['row', 'แคดเมียม (Cd)', '< 0.02', 'mg/kg', 'ตามมาตรฐานอ้างอิง', 'ICP-MS', 'ผ่าน'],
    ['row', 'สารหนู (As)', '< 0.05', 'mg/kg', 'ตามมาตรฐานอ้างอิง', 'ICP-MS', 'ผ่าน'],
    ['row', 'ปรอท (Hg)', '< 0.01', 'mg/kg', 'ตามมาตรฐานอ้างอิง', 'ICP-MS', 'ผ่าน'],
    ['grp', 'สารกำจัดศัตรูพืชตกค้าง · Pesticide residues'],
    ['row', 'กลุ่มที่ตรวจ (๓๐ รายการ)', 'ไม่พบ', 'mg/kg', 'ตามมาตรฐานอ้างอิง', 'LC-MS/MS · GC-MS/MS', 'ผ่าน'],
    ['grp', 'จุลินทรีย์ · Microbiological'],
    ['row', 'ยีสต์และรา', '1.2 × 10³', 'CFU/g', 'ตามมาตรฐานอ้างอิง', 'ISO 21527', 'ผ่าน'],
    ['row', 'E. coli', 'ไม่พบ', '/g', 'ตามมาตรฐานอ้างอิง', 'ISO 16649', 'ผ่าน'],
    ['row', 'Salmonella spp.', 'ไม่พบ', '/25 g', 'ตามมาตรฐานอ้างอิง', 'ISO 6579', 'ผ่าน'],
    ['grp', 'สารพิษจากเชื้อรา และคุณลักษณะทั่วไป'],
    ['row', 'อะฟลาทอกซินรวม', '< 2.0', 'µg/kg', 'ตามมาตรฐานอ้างอิง', 'HPLC-FLD', 'ผ่าน'],
    ['row', 'ความชื้น', '9.8', '% w/w', 'ตามมาตรฐานอ้างอิง', 'Gravimetric', 'ผ่าน'],
    ['row', 'สิ่งแปลกปลอม', 'ไม่พบ', '—', 'ตามมาตรฐานอ้างอิง', 'Visual', 'ผ่าน'],
];

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function buildResultRowsHtml() {
    return SPECIMEN_RESULTS.map((entry) => {
        if (entry[0] === 'grp') {
            return `<tr class="grp"><td colspan="6">${esc(entry[1])}</td></tr>`;
        }
        const [, name, result, unit, criterion, method, verdict] = entry;
        const verdictCell = verdict
            ? `<span class="v p">${esc(verdict)}</span>`
            : '—';
        return `<tr><td>${esc(name)}</td><td class="n">${esc(result)}</td>`
            + `<td class="n">${esc(unit)}</td><td>${esc(criterion)}</td>`
            + `<td>${esc(method)}</td><td>${verdictCell}</td></tr>`;
    }).join('\n');
}

function addDays(date, days) {
    // Plain instant arithmetic (Bangkok has no DST), no calendar read.
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * ปฏิเสธที่จะสร้างเอกสารตัวอย่าง เว้นแต่จะรู้แน่ว่าเครื่องนี้ไม่ใช่ระบบที่ออกใบรับรองจริง
 *
 * ตัวชี้ขาดคือ **ที่อยู่สาธารณะของระบบ** ไม่ใช่ NODE_ENV — apps/backend/.env ตั้ง
 * NODE_ENV=production ไว้แม้บนแล็ปท็อป (ดู [[jest-reads-the-backend-dotenv]]) การ์ดที่อ่าน
 * NODE_ENV จึงบอกไม่ได้ว่าอยู่เครื่องไหน ส่วน public URL คือคำตอบที่ repo นี้ใช้อยู่แล้วว่า
 * "ระบบนี้คือใคร" (config/public-urls.js) และเป็นสิ่งที่ operator ตั้งต่างกันจริงในแต่ละเครื่อง
 *
 * ปิดไว้ก่อนเป็นค่าตั้งต้น: โฮสต์ที่อ่านไม่ออกหรือไม่รู้จัก = ปฏิเสธ ไม่ใช่อนุญาต
 */
const NON_PRODUCTION_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|(^|\.)(demo|staging|dev|test|local)\./i;

function assertNotMinistryProduction() {
    if (String(process.env.ALLOW_SPECIMEN_COA || '').toLowerCase() === 'true') { return; }

    let host = null;
    try {
        host = new URL(require('../../config/public-urls').appBaseUrl()).hostname;
    } catch {
        host = null; // อ่านไม่ออก = ไม่รู้ว่าเครื่องไหน = ปฏิเสธ
    }

    if (host && NON_PRODUCTION_HOST.test(host)) { return; }

    const err = new Error(
        `สร้าง COA ตัวอย่างบนระบบนี้ไม่ได้ (${host || 'ไม่ทราบที่อยู่สาธารณะ'}) — `
        + 'แพลตฟอร์มไม่ใช่ห้องปฏิบัติการ เอกสารตัวอย่างไม่มีธุระบนระบบที่ออกใบรับรองจริง '
        + '· ตั้ง ALLOW_SPECIMEN_COA=true หากตั้งใจสร้างบนเครื่องนี้',
    );
    err.code = 'SPECIMEN_COA_REFUSED_HERE';
    throw err;
}

/**
 * สร้างไฟล์ PDF ของ COA ตัวอย่างสำหรับรุ่นเก็บเกี่ยวหนึ่งรุ่น
 *
 * @param {Object} input
 * @param {string} input.batchCode        รหัสรุ่นเก็บเกี่ยว — ช่อง "รหัสตัวอย่างของผู้ส่ง"
 * @param {string} [input.clientName]     ชื่อฟาร์ม/ผู้ขอรับบริการ
 * @param {string} [input.clientAddress]  ที่อยู่ระดับตำบล/อำเภอ/จังหวัด
 * @param {string} [input.certificateNumber]
 * @param {string} [input.sampleName]
 * @param {Date}   [input.reportedAt]     วันที่ออกรายงาน (ค่าตั้งต้น: วันนี้)
 * @returns {Promise<{buffer: Buffer, labName: string, reportNumber: string,
 *                    reportedAt: Date, verificationCode: string}>}
 */
async function generateSpecimenCoaPdf(input = {}) {
    assertNotMinistryProduction();

    const batchCode = String(input.batchCode || '').trim();
    if (!batchCode) {
        const err = new Error('ต้องระบุรหัสรุ่นเก็บเกี่ยว — COA ที่ไม่บอกว่าเป็นของรุ่นไหนจับคู่กับอะไรไม่ได้');
        err.code = 'SPECIMEN_COA_BATCH_CODE_REQUIRED';
        throw err;
    }

    const reportedAt = input.reportedAt instanceof Date ? input.reportedAt : new Date();
    const receivedAt = addDays(reportedAt, -12);
    const analysedFrom = addDays(reportedAt, -11);
    const analysedTo = addDays(reportedAt, -3);

    // เลขที่รายงานและรหัสตรวจสอบผูกกับรหัสรุ่น เพื่อให้ไฟล์ฉบับเดียวกันได้เลขเดิมทุกครั้ง
    const suffix = batchCode.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase().padStart(8, '0');
    const reportNumber = `${SPECIMEN_REPORT_PREFIX}${suffix}`;
    const verificationCode = `${suffix.slice(0, 4)}-${suffix.slice(4)}`;

    const data = {
        LAB_NAME: SPECIMEN_LAB_NAME,
        LAB_ACCREDITATION: 'SPECIMEN-0000',
        LAB_CONTACT: 'ที่อยู่ห้องปฏิบัติการ (ตัวอย่าง) · โทร — · อีเมล —',
        REPORT_NUMBER: reportNumber,
        REPORTED_AT: formatThaiDateFull(reportedAt),
        CLIENT_NAME: input.clientName || '—',
        CLIENT_ADDRESS: input.clientAddress || '—',
        CERTIFICATE_NUMBER: input.certificateNumber || '—',
        SAMPLE_NAME: input.sampleName || 'ช่อดอกกัญชาแห้ง (Cannabis sativa L., dried inflorescence)',
        BATCH_CODE: batchCode,
        SAMPLE_CONDITION: 'แห้ง บรรจุถุงซีล สภาพสมบูรณ์',
        SAMPLE_AMOUNT: '50 กรัม',
        RECEIVED_AT: formatThaiDateFull(receivedAt),
        ANALYSED_AT: `${formatThaiDateFull(analysedFrom)} – ${formatThaiDateFull(analysedTo)}`,
        VERIFICATION_CODE: verificationCode,
        RESULT_ROWS_HTML: buildResultRowsHtml(),
    };

    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const html = pdfGenerator.replaceTemplateVariables(template, data);
    const buffer = await pdfGenerator.generatePDF(html, {
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });

    return { buffer, labName: SPECIMEN_LAB_NAME, reportNumber, reportedAt, verificationCode };
}

module.exports = {
    generateSpecimenCoaPdf,
    buildResultRowsHtml,
    assertNotMinistryProduction,
    SPECIMEN_LAB_NAME,
    SPECIMEN_REPORT_PREFIX,
    TEMPLATE_PATH,
};
