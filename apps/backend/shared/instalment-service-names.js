'use strict';

/**
 * บริการที่เงินแต่ละงวดซื้อ — ที่เดียวในระบบที่ตอบคำถามนี้
 *
 * มติ operator 2026-09-07: *"เราแยกตามบริการ เช่น ค่าบริการตรวจสอบเอกสาร สำหรับขออนุญาต
 * รูปแบบการปลูกแบบกลางแจ้ง"* — และ *"เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง"*
 *
 * ก่อนหน้านี้ใบเสนอราคาแตกบรรทัดตาม **องค์ประกอบบัญชี** (ค่าธรรมเนียมกรม · ค่าบริการ
 * แพลตฟอร์ม · VAT) คูณด้วยจำนวนรูปแบบการปลูก ⇒ ปลูก 3 รูปแบบได้ 9 บรรทัด ซึ่งเป็นการ
 * กางบัญชีภายในให้ลูกค้าดู ไม่ใช่การบอกว่าเขาซื้ออะไร · มติข้างต้นกลับทิศ: หนึ่งบรรทัด
 * = หนึ่งบริการ × หนึ่งรูปแบบการปลูก ⇒ 3 บรรทัด แต่ละบรรทัดคือราคาที่จ่ายจริงของรูปแบบนั้น
 *
 * ทำไมต้องเป็นไฟล์แยก: ก่อนหน้านี้ไม่มีที่ไหนในระบบตอบว่า "งวดที่ 1 ซื้อบริการอะไร" —
 * ชื่อบริการกระจายอยู่ในตัวเรนเดอร์ PDF ปนกับชื่อ stage ('ตรวจประเมิน'/'รับรองผล') ซึ่งเป็น
 * คนละเรื่องกับชื่อบริการ · หน้าจอกับเอกสารจึงมีสิทธิ์ตอบไม่ตรงกันได้ตลอดเวลา
 *
 * @module shared/instalment-service-names
 */

/**
 * แค็ตตาล็อกบรรทัดค่าบริการ — มติ operator 2026-10-03 (คำต่อคำ)
 *
 * ค่าบริการก้อนเดียว ไม่แยกส่วนกรม/ส่วนแพลตฟอร์ม · แต่ทุกเอกสารการเงิน (ใบเสนอราคา
 * ใบวางบิล ใบเสร็จ/ใบกำกับภาษี) และทุกหน้าจอที่บอกราคา ต้องเรียกบรรทัดด้วยชื่อเดียวกัน
 * และบอกให้ชัดว่าครอบคลุมอะไร — กรมจะได้ไม่ต้องถามว่า "ทำไมเก็บเกินค่าบริการ"
 *
 * งวดที่ 2 **ไม่รวม** ค่าเดินทาง ค่าที่พัก หรือค่าตอบแทนผู้ตรวจ — ห้ามเขียนว่ารวม
 *
 * เว็บไม่คัดลอกไฟล์นี้: ชื่อและความครอบคลุมเสิร์ฟผ่าน GET /api/pricing/fees `services` และ
 * GET /applications/:id/quotations `copy.services` · ฉบับสำรองของเว็บมีฉบับเดียว
 * (apps/web-app/src/constants/fee-service-catalogue.json) ตรึงให้เท่ากันโดย
 * __tests__/unit/fee-service-catalogue-web-mirror.test.js
 */
const SERVICE_CATALOGUE = Object.freeze({
    PHASE_1: Object.freeze({
        key: 'PHASE_1',
        name: 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร',
        nameEn: 'Instalment 1: document review service fee',
        coverage: 'ครอบคลุม: รับและตรวจความครบถ้วน ความถูกต้องของเอกสารคำขอตามหลักเกณฑ์ GACP · ตรวจเบื้องต้นด้วยระบบ · แจ้งผลและรับเอกสารแก้ไข · จัดเก็บเอกสารอิเล็กทรอนิกส์ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์',
        coverageEn: 'Covers: receiving the application documents and checking them for completeness and correctness against the GACP criteria · automated preliminary check · notifying the result and receiving corrected documents · electronic document storage · use of the online application and status-tracking system',
    }),
    PHASE_2: Object.freeze({
        key: 'PHASE_2',
        name: 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง',
        nameEn: 'Instalment 2: site assessment and certificate issuance service fee',
        coverage: 'ครอบคลุม: นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง · บันทึกหลักฐานการตรวจ · ออกใบรับรองอิเล็กทรอนิกส์พร้อมลายมือชื่อดิจิทัลและ QR ตรวจสอบย้อนกลับ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์',
        coverageEn: 'Covers: scheduling and carrying out the on-site assessment of the cultivation site · recording the assessment evidence · issuing the electronic certificate with a digital signature and a traceability QR code · use of the online application and status-tracking system',
    }),
    RENEWAL: Object.freeze({
        key: 'RENEWAL',
        name: 'ค่าบริการต่ออายุใบรับรอง',
        nameEn: 'Certificate renewal service fee',
        coverage: 'ครอบคลุม: ตรวจประเมินเพื่อต่ออายุ · ออกใบรับรองฉบับใหม่พร้อมลายมือชื่อดิจิทัลและ QR · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์',
        coverageEn: 'Covers: the renewal assessment · issuing the new certificate with a digital signature and QR code · use of the online application and status-tracking system',
    }),
});

/**
 * บรรทัดภาษีมูลค่าเพิ่ม — อัตรามาจากผู้เรียก (อัตราที่เสิร์ฟ/ที่ใช้คิดจริง) ไม่ใช่เลข 7 ที่พิมพ์ไว้
 *
 * @param {number} vatRate  เช่น 0.07
 * @returns {{name: string, nameEn: string}}
 */
function vatLine(vatRate) {
    const pct = Math.round(Number(vatRate) * 10000) / 100;
    return {
        name: `ภาษีมูลค่าเพิ่ม ${pct}% คิดจากค่าบริการทั้งจำนวน`,
        nameEn: `Value added tax ${pct}% on the whole service fee`,
    };
}

/**
 * บริการของงวด/milestone หนึ่ง · การต่ออายุเป็นบริการเดียว (fee-service วางไว้ใน slot
 * PHASE_2 / M2 เพื่อความเข้ากันได้เท่านั้น) จึงได้ RENEWAL เสมอ
 *
 * @param {number|string} phase  1 | 2 | 'PHASE_1' | 'PHASE_2' | 'M1' | 'M2'
 * @param {object} [opts]
 * @param {boolean} [opts.isRenewal]
 * @returns {object} รายการในแค็ตตาล็อก
 */
function serviceFor(phase, { isRenewal = false } = {}) {
    if (isRenewal) { return SERVICE_CATALOGUE.RENEWAL; }
    const s = String(phase || '').toUpperCase();
    return (s === '2' || s === 'PHASE_2' || s === 'M2') ? SERVICE_CATALOGUE.PHASE_2 : SERVICE_CATALOGUE.PHASE_1;
}

/**
 * บริการของใบแจ้งหนี้ตาม serviceType ที่ checkout ออก (CERTIFICATION_CHECKOUT_M1/M2)
 * serviceType อื่น (สมาชิก, แถวรุ่นเก่า) = null ให้ผู้เรียกใช้ป้ายของตัวเอง
 *
 * @param {string} serviceType
 * @param {object} [opts]
 * @param {boolean} [opts.isRenewal]
 * @returns {object|null}
 */
function serviceForServiceType(serviceType, { isRenewal = false } = {}) {
    const m = /^CERTIFICATION_CHECKOUT_(M[12])$/.exec(String(serviceType || '').toUpperCase());
    return m ? serviceFor(m[1], { isRenewal }) : null;
}

/** ชื่อบริการต่องวด (คีย์ = หมายเลขงวด) — มาจากแค็ตตาล็อก */
const INSTALMENT_SERVICE_NAMES = Object.freeze({
    1: SERVICE_CATALOGUE.PHASE_1.name,
    2: SERVICE_CATALOGUE.PHASE_2.name,
});

/** บริการของการต่ออายุ — เก็บค่าเดียว ไม่แบ่งงวด */
const RENEWAL_SERVICE_NAME = SERVICE_CATALOGUE.RENEWAL.name;

/** คำที่บอกว่าเงินก้อนนี้จ่ายเพื่ออะไร */
const PURPOSES = Object.freeze({
    NEW: 'ขออนุญาต',
    RENEWAL: 'ต่ออายุ',
});

/**
 * @param {number|string} phase   1 หรือ 2
 * @param {object} [opts]
 * @param {boolean} [opts.isRenewal]  true = คำขอต่ออายุ ซึ่งมีค่าบริการก้อนเดียว
 * @returns {string} ชื่อบริการที่พิมพ์บนบรรทัด
 */
function serviceNameForInstalment(phase, { isRenewal = false } = {}) {
    return serviceFor(phase, { isRenewal }).name;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.isRenewal]
 * @returns {string} 'ขออนุญาต' หรือ 'ต่ออายุ'
 */
function purposeWord({ isRenewal = false } = {}) {
    return isRenewal ? PURPOSES.RENEWAL : PURPOSES.NEW;
}

/**
 * คำขอนี้เป็นการต่ออายุหรือไม่ — คำตอบเดียวของระบบ
 *
 * `formData.renewalOf` คือรอยที่ renewal-service ประทับไว้ตอนสร้างคำขอต่ออายุ
 * เดิมคำตอบนี้ถูกเขียนซ้ำในตัวคิดราคา (stripe-checkout-service) ซึ่งแปลว่าเอกสารกับ
 * ราคามีสิทธิ์ตอบไม่ตรงกัน — คลาสเดียวกับข้อบกพร่องที่เจอ 19 ตัวเมื่อ 2026-09-07
 *
 * @param {object|null|undefined} application
 * @returns {boolean}
 */
function isRenewalFiling(application) {
    const formData = typeof application?.formData === 'object' && application.formData
        ? application.formData
        : {};
    return Boolean(formData.renewalOf);
}

/** ค่าที่เสิร์ฟให้หน้าจอ — ไม่มี `key` ภายใน */
function publicEntry(entry) {
    if (!entry) { return null; }
    const { name, nameEn, coverage, coverageEn } = entry;
    return { name, nameEn, coverage, coverageEn };
}

/**
 * แค็ตตาล็อกทั้งชุดสำหรับ GET /api/pricing/fees
 * @param {number} vatRate
 */
function catalogueForApi(vatRate) {
    return {
        PHASE_1: publicEntry(SERVICE_CATALOGUE.PHASE_1),
        PHASE_2: publicEntry(SERVICE_CATALOGUE.PHASE_2),
        RENEWAL: publicEntry(SERVICE_CATALOGUE.RENEWAL),
        VAT: vatLine(vatRate),
    };
}

/**
 * บริการของคำขอหนึ่งใบ ตามช่องงวดที่ใบเสนอราคาใช้ — คำขอต่ออายุไม่มีงวดที่ 1
 * @param {object} application
 * @param {number} vatRate
 */
function servicesForApplication(application, vatRate) {
    const isRenewal = isRenewalFiling(application);
    return {
        PHASE_1: isRenewal ? null : publicEntry(SERVICE_CATALOGUE.PHASE_1),
        PHASE_2: publicEntry(serviceFor(2, { isRenewal })),
        VAT: vatLine(vatRate),
    };
}

module.exports = {
    SERVICE_CATALOGUE,
    vatLine,
    serviceFor,
    serviceForServiceType,
    catalogueForApi,
    servicesForApplication,
    INSTALMENT_SERVICE_NAMES,
    RENEWAL_SERVICE_NAME,
    PURPOSES,
    serviceNameForInstalment,
    purposeWord,
    isRenewalFiling,
};
