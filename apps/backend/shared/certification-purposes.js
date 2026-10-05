'use strict';

/**
 * วัตถุประสงค์การขอรับรอง — ที่เดียวในระบบที่ตอบว่า "เลือกได้อะไรบ้าง และใบอนุญาตอะไรรองรับ"
 *
 * มติ operator 2026-10-05: วัตถุประสงค์ "เพื่อการแพทย์" ถูกถอด · วัตถุประสงค์ของคำขอใช้ได้เฉพาะ
 * ที่มีใบอนุญาต ภ.ท. สำหรับสมุนไพรควบคุมรองรับ และสิ่งที่ผู้ยื่นแนบคือ **ใบอนุญาตที่ออกให้แล้ว**
 * ไม่ใช่แบบคำขอ ภ.ท.:
 *   RESEARCH   = ภ.ท. 09  ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม
 *   EXPORT     = ภ.ท. 10  ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า
 *   PROCESSING = ภ.ท. 11  ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า
 *                          (รวมการจำหน่าย — ป้ายในวิซาร์ดจึงเป็น "แปรรูปหรือจำหน่ายเพื่อการค้า")
 *
 * ค่าอื่นทุกคำ (MEDICAL, COMMERCIAL, ว่าง) ถูกปฏิเสธที่ประตู ไม่มีการแปลงหรือเปลี่ยนชื่อเงียบ ๆ
 *
 * เว็บและมือถือไม่ import ไฟล์นี้: แต่ละฝั่งถือสำเนาฉบับเดียว
 *   web    apps/web-app/src/constants/certification-purposes.json
 *   mobile apps/mobile-app/lib/domain/certification_purposes.dart
 * ตรึงให้เท่ากับไฟล์นี้โดย __tests__/unit/certification-purposes-vocabulary.test.js
 *
 * @module shared/certification-purposes
 */

const CERTIFICATION_PURPOSES = Object.freeze({
    RESEARCH: Object.freeze({
        code: 'RESEARCH',
        label: 'ศึกษาวิจัย',
        licenceCode: 'ภ.ท. 09',
        licenceName: 'ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม',
        slotId: 'licence_pt09',
    }),
    EXPORT: Object.freeze({
        code: 'EXPORT',
        label: 'ส่งออกเพื่อการค้า',
        licenceCode: 'ภ.ท. 10',
        licenceName: 'ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า',
        slotId: 'licence_pt10',
    }),
    PROCESSING: Object.freeze({
        code: 'PROCESSING',
        label: 'แปรรูปหรือจำหน่ายเพื่อการค้า',
        licenceCode: 'ภ.ท. 11',
        licenceName: 'ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า',
        slotId: 'licence_pt11',
    }),
});

/** ลำดับตามเลขใบอนุญาต — ลำดับเดียวกับที่พิมพ์ลงแบบ */
const PURPOSE_CODES = Object.freeze(Object.keys(CERTIFICATION_PURPOSES));

/**
 * ใบอนุญาตส่งออกพืชกระท่อม — ตามมาตรา 10 แห่ง พ.ร.บ.พืชกระท่อม พ.ศ. 2565 (มติ operator 2026-10-05, fix round 2)
 * ไม่มีเลขแบบ ภ.ท. เพราะ ภ.ท. 09/10/11 เป็นของสมุนไพรควบคุม (กัญชา) ตามกฎกระทรวง 2559 ไม่ใช่ของกระท่อม ·
 * ไม่พบเลขแบบของใบอนุญาตนี้ จึงไม่ตั้งเลขให้ (reports/research/2026-09-01-dtam-application-baseline/facts.md)
 */
const KRATOM_EXPORT_LICENCE_SLOT_ID = 'kratom_export_licence';

/**
 * ช่องใบอนุญาตที่วัตถุประสงค์หนึ่งของพืชหนึ่งชนิดต้องแนบ — หรือ null เมื่อกฎหมายไม่บังคับ
 *   กัญชา   : ภ.ท. 09/10/11 ตามวัตถุประสงค์
 *   กระท่อม : ส่งออกเท่านั้น (ใบอนุญาตมาตรา 10) · วิจัยและแปรรูปไม่ต้องมีใบอนุญาต
 *   อีกสี่ชนิด และชนิดที่ไม่รู้จัก : ไม่มี (ชนิดที่ไม่รู้จักถูกปฏิเสธที่ชั้นอื่นอยู่แล้ว)
 * รับ slug ของพืชตามที่ asPlantSlug ตอบ ไม่ normalise เอง
 */
function purposeLicenceSlotId(plantSlug, purposeCode) {
    if (plantSlug === 'cannabis') {
        const purpose = CERTIFICATION_PURPOSES[purposeCode];
        return purpose ? purpose.slotId : null;
    }
    if (plantSlug === 'kratom' && purposeCode === 'EXPORT') {
        return KRATOM_EXPORT_LICENCE_SLOT_ID;
    }
    return null;
}

/** ป้ายตัวเลือกในวิซาร์ด: ป้ายพร้อมรหัสใบอนุญาต */
function optionLabel(code) {
    const purpose = CERTIFICATION_PURPOSES[code];
    return purpose ? `${purpose.label} (${purpose.licenceCode})` : '';
}

/**
 * รายการวัตถุประสงค์ต้องเป็นสับเซตไม่ว่างของสามคำ — ตรงตัวอักษร ไม่ trim ไม่แปลงตัวพิมพ์
 * (ค่าที่ส่งมาไม่ตรงคือคำที่ไม่รู้จัก ไม่ใช่คำที่ "เกือบถูก" ให้ระบบเดาแทน)
 *
 * @param {unknown} value
 * @returns {{ ok: boolean, empty: boolean, unknown: string[] }}
 */
function assessPurposes(value) {
    if (!Array.isArray(value)) {
        return { ok: false, empty: !value, unknown: value ? [String(value)] : [] };
    }
    const unknown = value
        .filter((word) => !Object.prototype.hasOwnProperty.call(CERTIFICATION_PURPOSES, word))
        .map(String);
    return { ok: value.length > 0 && unknown.length === 0, empty: value.length === 0, unknown };
}

/** ข้อความภาษาไทยของการปฏิเสธ — บอกว่าเลือกได้จากอะไร */
function refusalMessageTh() {
    const choices = PURPOSE_CODES.map(optionLabel).join(' · ');
    return `วัตถุประสงค์ต้องเลือกจาก ${choices} เท่านั้น — แต่ละข้อมีใบอนุญาต ภ.ท. ที่ออกให้แล้วรองรับ`;
}

/**
 * บรรทัดเสริมใน กทล.1 ส่วนที่ ๒: ชื่อวัตถุประสงค์พร้อมรหัสใบอนุญาต ตามลำดับของทะเบียน
 * คำนอกทะเบียนไม่ถูกพิมพ์
 */
function describePurposesForForm(codes) {
    const chosen = new Set(Array.isArray(codes) ? codes : []);
    return PURPOSE_CODES.filter((code) => chosen.has(code)).map(optionLabel).join(', ');
}

module.exports = {
    CERTIFICATION_PURPOSES,
    PURPOSE_CODES,
    KRATOM_EXPORT_LICENCE_SLOT_ID,
    purposeLicenceSlotId,
    optionLabel,
    assessPurposes,
    refusalMessageTh,
    describePurposesForForm,
};
