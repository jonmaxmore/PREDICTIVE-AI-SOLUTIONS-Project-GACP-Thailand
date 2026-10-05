'use strict';
/**
 * เปิดรอบปลูกได้เฉพาะบนแปลงที่อยู่ในขอบเขตของใบรับรอง
 *
 * operator 2026-09-10: "ระบบเราต้องบอกได้ว่าเกษตรกรขอแบบไหนมา ซึ่งมีผลต่อทั้งการจ่ายเงิน
 * เพราะการจ่ายเงินขึ้นอยู่กับรูปแบบการปลูกที่ขอมา และการบันทึกฟาร์มก็ตามรูปแบบที่ขอมา"
 *
 * ═══ ช่องที่โมดูลนี้ปิด ═══
 * `assertPlotWithinCertifiedScope` กั้นการ **สร้างแปลง** นอกขอบเขตอยู่แล้ว
 * (routes/api/cultivation/plots.js:80) แต่แปลงที่เกิด **ก่อน** ใบรับรองไม่เคยผ่านด่านนั้น
 * ฟาร์มที่สร้างแปลงในร่มไว้ตั้งแต่ยังไม่มีใบ แล้วได้ใบที่ครอบคลุมเฉพาะกลางแจ้ง
 * ยังเปิดรอบปลูกบนแปลงในร่มนั้นได้ และ QR ที่ออกมาจะพาผู้ซื้อไปหน้าที่อ้างใบรับรอง
 * ที่ไม่ได้ครอบคลุมการปลูกแบบนั้น
 *
 * ═══ ไม่มีการตีความ "ลักษณะพื้นที่" ที่นี่ ═══
 * ขอบเขตที่รับรองไว้อ่านจาก `certifiedAreaTypes({ farmId })` ซึ่งเดิน
 * ใบรับรอง → คำขอต้นทาง → deriveDimensions → tickedAreaTypes — ตัวเดียวกับที่ requirement
 * lens และด่านสร้างแปลงใช้
 *
 * โมดูลนี้แปลคำตอบนั้นเป็นรูปที่หน้าจอใช้ได้เท่านั้น: รายชื่อแปลงที่ติดด่าน พร้อมเหตุผล
 * รายตัว เพื่อให้ทำให้มัน "จางลงพร้อมบอกเหตุ" ไม่ใช่ซ่อนหายไป (ซ่อนแล้วเกษตรกรจะถามว่า
 * "แปลงโรงเรือนหายไปไหน" ซึ่งผิดเกณฑ์ "ต้องใช้ได้เองโดยไม่ต้องถามใคร")
 *
 * เขียนไว้เพราะเกือบพลาดเอง 2026-09-10: ผมกำลังจะสร้างตัวตัดสิน "ขอแบบไหนมา" ตัวที่สาม
 * ในโปรเจกต์นี้ ก่อนจะพบว่า certified-scope.js ทำครบแล้ว · ตัวตัดสินตัวที่สองคือจุดที่
 * สองตัวเริ่มขัดกันในวันที่ใครแก้ข้างเดียว
 */

const { certifiedAreaTypes } = require('./certified-scope');

/**
 * ลักษณะพื้นที่ → ชื่อไทยที่ผู้ยื่นเห็นในแบบฟอร์ม
 *
 * สามคำ · 'OTHER' ถูกถอดออก 2026-09-11 ตามมติ operator ("เรามีแค่ 3 อย่างนะ") —
 * ถอดจากจอ จากทะเบียนกฎ จากประตูยื่น และจากใบ กทล.1 ที่ระบบพิมพ์ ⇒ ไม่มีแปลงใด
 * ถือคำนั้นได้อีก และแถวในแมปนี้จะไม่มีวันถูกอ่าน
 *
 * หมายเหตุที่ควรรู้: แมปคำไทยของลักษณะพื้นที่มีหลายชุดในโครงนี้ (ที่นี่ ·
 * quotation-line-items.js · katorlor1-template-service.js · step3-site-land-config.ts ·
 * canonical-application-validator.js) · ยุบให้เหลือชุดเดียวเป็นงานแยกใบ ที่นี่ทำได้แค่
 * ไม่เพิ่มชุดที่หก
 */
const AREA_TYPE_LABEL_TH = Object.freeze({
    OUTDOOR: 'กลางแจ้ง',
    GREENHOUSE: 'โรงเรือน',
    INDOOR: 'อาคารระบบปิด',
});

/** ชื่อไทยของลักษณะพื้นที่ หรือคำเดิมถ้าไม่รู้จัก — ไม่เคยคืนค่าว่าง */
function labelTh(areaType) {
    const key = String(areaType || '').trim().toUpperCase();
    return AREA_TYPE_LABEL_TH[key] || (key || 'ไม่ระบุ');
}

/** ลักษณะพื้นที่ของแปลง · `solarSystem` คือคอลัมน์จริง `cultivationMethod` คือชื่อเก่า */
function plotAreaType(plot) {
    const word = String(plot?.solarSystem || plot?.cultivationMethod || '').trim().toUpperCase();
    return word === 'INDOOR_CONTROLLED' ? 'INDOOR' : word;
}

/**
 * แปลงเหล่านี้เปิดรอบปลูกได้ไหม เมื่อเทียบกับขอบเขตของใบรับรองที่มีผล
 *
 * คืนผลเป็นข้อมูล ไม่ throw — ผู้เรียกแต่ละรายมีรูปแบบคำตอบของตัวเอง และหน้าจอต้องการ
 * รายชื่อแปลงที่ติดด่าน ไม่ใช่แค่คำว่า "ไม่ผ่าน"
 *
 * @param {{farmId: string, plots: object[], client?: object}} args
 * @returns {Promise<{allowed, certified, blocked, reasonTh, code}>}
 *   `certified === null` = ฟาร์มยังไม่มีใบรับรองที่มีผล ⇒ ด่านนี้เงียบ
 *   (ด่าน "ต้องมีใบรับรองก่อนปลูก" เป็นคนละด่าน อยู่ใน planting-service.createCycle)
 */
async function checkPlotsAgainstCertifiedScope({ farmId, plots, client, holderScope = null } = {}) {
    const list = Array.isArray(plots) ? plots : [];
    const { areaTypes, certificateNumber } = await certifiedAreaTypes({ farmId, client, holderScope });

    // null = ยังไม่มีใบรับรอง · ไม่ใช่หน้าที่ของด่านนี้ที่จะพูดถึงเรื่องนั้น
    if (areaTypes === null) {
        return { allowed: true, certified: null, blocked: [], reasonTh: null, code: null };
    }

    // ลิสต์ว่าง = มีใบรับรอง แต่คำขอต้นทางไม่เคยระบุลักษณะพื้นที่ · เกิดกับคำขอที่ยื่นก่อน
    // ช่องนี้มีอยู่ (วัดจริง 2026-09-10: 3 ใบบน demo มี farmData.areaTypes = null)
    // ห้ามเดาว่าเป็นกลางแจ้ง และห้ามล็อกเกษตรกรออกจากรอบปลูกด้วยข้อมูลที่เขาไม่เคยถูกถาม
    // — เรื่องนี้เป็นงานย้ายข้อมูล ไม่ใช่งานของด่าน
    if (areaTypes.length === 0) {
        return { allowed: true, certified: [], blocked: [], reasonTh: null, code: null };
    }

    const allow = new Set(areaTypes.map((word) => String(word).toUpperCase()));
    const blocked = list
        .filter((plot) => {
            const type = plotAreaType(plot);
            // แปลงที่ไม่บอกลักษณะของตัวเอง ไม่ถูกกั้น — ด่านนี้กั้นความขัดแย้งที่พิสูจน์ได้
            // ไม่ใช่กั้นข้อมูลที่ขาด
            return type !== '' && !allow.has(type);
        })
        .map((plot) => ({
            plotId: plot.id,
            plotName: plot.name || plot.plotCode || 'แปลงไม่ระบุชื่อ',
            areaType: plotAreaType(plot),
            reasonTh: `แปลงนี้เป็นแบบ${labelTh(plotAreaType(plot))} `
                + `แต่ใบรับรองของคุณครอบคลุมเฉพาะ${areaTypes.map(labelTh).join(' และ ')}`,
        }));

    if (blocked.length === 0) {
        return { allowed: true, certified: areaTypes, blocked: [], reasonTh: null, code: null };
    }

    return {
        allowed: false,
        certified: areaTypes,
        blocked,
        code: 'PLOT_OUTSIDE_CERTIFIED_SCOPE',
        reasonTh:
            `เปิดรอบปลูกไม่ได้ เพราะ ${blocked.map((b) => b.plotName).join(', ')} `
            + `ไม่ตรงกับรูปแบบการปลูกที่ใบรับรอง${certificateNumber ? ` ${certificateNumber}` : ''} ครอบคลุม `
            + `(${areaTypes.map(labelTh).join(' และ ')}) `
            + 'หากต้องการปลูกรูปแบบอื่น ให้ยื่นคำขอเพิ่มรูปแบบการปลูกก่อน',
    };
}

module.exports = {
    AREA_TYPE_LABEL_TH,
    labelTh,
    plotAreaType,
    checkPlotsAgainstCertifiedScope,
};
