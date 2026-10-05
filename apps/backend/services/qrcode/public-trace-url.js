'use strict';

/**
 * URL ที่ QR พาไป — และกฎว่าเมื่อไรค่าที่เก็บไว้ใช้ไม่ได้
 *
 * QR บนถุงคือของที่ออกจากมือเราไปแล้ว เรียกคืนไม่ได้ ค่าที่อยู่ข้างในจึงต้องพาคนสแกนไปถึง
 * หน้าจริงเสมอ · operator 2026-09-07: "QR code ที่เจนมาต้องเป็น QR ที่แสกนได้จริง และมีข้อมูล
 * ที่ถูกต้องข้างใน ไม่ใช่ mockup"
 *
 * สิ่งที่วัดได้บน demo (2026-09-07):
 *   ค่าที่ระบบสร้างตอนนี้   https://demo.gacpth.com/trace/lot/…   ถูกต้อง
 *   ค่าที่ค้างในฐานข้อมูล    http://localhost/trace/lot/…          ตายแล้ว
 * แถวเก่าเกิดตอนที่ยังไม่ได้ตั้ง PUBLIC_TRACE_URL บนเครื่องนั้น ตัวสร้าง URL จึงถอยไปใช้
 * localhost เป็นค่าสุดท้าย · ปัญหาไม่ได้อยู่ที่โค้ดวันนี้ แต่อยู่ที่ **ตัวเรนเดอร์ป้ายเคารพค่าที่
 * เก็บไว้เสมอ** ป้ายที่พิมพ์วันนี้จึงยังพา URL ที่ตายแล้วออกไปติดถุง
 *
 * กฎเดียวกับที่ใช้กับชื่อฟาร์ม 'Certified Farm' และกับที่ตั้งฟาร์มที่เป็น 'Unknown':
 * ค่าที่เก็บไว้ซึ่งเป็นไปไม่ได้ในโลกจริง ไม่ใช่ข้อเท็จจริงที่ต้องเคารพ — ถือว่าไม่มี แล้วสร้างใหม่
 *
 * ไม่เขียนทับของที่ถูกอยู่แล้ว: ล็อตที่มี URL สาธารณะจริงเก็บไว้ ยังใช้ค่านั้นต่อ เพราะ QR ที่
 * พิมพ์ไปแล้วกับ QR ที่พิมพ์ใหม่ต้องพาไปที่เดียวกัน
 *
 * @module services/qrcode/public-trace-url
 */

/** โฮสต์ที่มีความหมายเฉพาะบนเครื่องที่รัน — ใครสแกนจากข้างนอกก็ไปไม่ถึง */
const UNREACHABLE_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
]);

/**
 * @param {unknown} url
 * @returns {boolean} true เมื่อค่านี้พาคนสแกนไปถึงไม่ได้ (รวมถึงค่าว่างและค่าที่ไม่ใช่ URL)
 */
function isUnscannableTraceUrl(url) {
    const text = String(url == null ? '' : url).trim();
    if (!text) { return true; }
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        return true;
    }
    const host = String(parsed.hostname || '').toLowerCase();
    return UNREACHABLE_HOSTS.has(host) || host === '';
}

/**
 * URL ที่ควรอยู่ใน QR ของสิ่งนี้
 *
 * @param {string|null|undefined} storedUrl  ค่าที่เก็บไว้กับแถว (lot.trackingUrl ฯลฯ)
 * @param {string} pathFragment              เช่น 'lot/<id>' หรือ 'batch/<id>'
 * @returns {string}
 */
function publicTraceUrlFor(storedUrl, pathFragment) {
    if (!isUnscannableTraceUrl(storedUrl)) {
        return String(storedUrl).trim();
    }
    // อ่านค่าที่ตั้งไว้ **ตอนใช้งาน** ไม่ใช่ค่าที่ค้างมาจากตอนบูต — qrcode-service อ่านครั้งเดียว
    // ตอนสร้าง instance ซึ่งเป็นบั๊กคลาสเดียวกับที่ทำให้เกิดแถว localhost ตั้งแต่แรก
    // ใช้ config/public-urls ซึ่งเป็นที่เดียวใน repo ที่ตอบว่า "ระบบนี้อยู่ที่ไหน" และปฏิเสธ
    // ที่จะเดาบนเครื่องจริง
    const { traceBaseUrl } = require('../../config/public-urls');
    const base = String(traceBaseUrl() || '').replace(/\/+$/, '');
    const fragment = String(pathFragment || '').trim().replace(/^\/+/, '');
    return fragment ? `${base}/trace/${fragment}` : `${base}/trace`;
}

/**
 * URL ที่ควรอยู่ใน QR ของใบรับรอง
 *
 * ใบรับรองเก็บที่อยู่ไว้ใน `qrData` ตั้งแต่วันออกใบ และตัวเรนเดอร์ PDF เคารพค่านั้นเสมอ เพื่อให้
 * ใบที่พิมพ์ซ้ำพาไปที่เดิม — ถูกต้อง ยกเว้นเมื่อค่าที่แช่ไว้เป็นที่อยู่ที่โลกภายนอกไปไม่ถึง
 * วัดได้จริง 2026-09-07: ใบรับรอง 5 จาก 7 ใบถือ http://127.0.0.1:8099/verify/… เอาไว้
 * ⇒ พิมพ์ออกมาก็ได้ใบรับรองของรัฐที่มี QR ตายติดอยู่บนหน้ากระดาษ
 *
 * @param {string|null|undefined} storedQrData      ค่าที่เก็บไว้กับใบรับรอง
 * @param {string} certificateNumber
 * @returns {string}
 */
function publicVerifyUrlFor(storedQrData, certificateNumber) {
    if (!isUnscannableTraceUrl(storedQrData)) {
        return String(storedQrData).trim();
    }
    const { verifyBaseUrl } = require('../../config/public-urls');
    const base = String(verifyBaseUrl() || '').replace(/\/+$/, '');
    const { toCertificateSlug } = require('../certificate-number-display');
    const number = toCertificateSlug(String(certificateNumber || '').trim());
    return number ? `${base}/${number}` : base;
}

module.exports = {
    isUnscannableTraceUrl,
    publicTraceUrlFor,
    publicVerifyUrlFor,
    UNREACHABLE_HOSTS,
};
