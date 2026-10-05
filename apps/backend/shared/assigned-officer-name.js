'use strict';

/**
 * ชื่อของเจ้าหน้าที่ที่ถืองานอยู่ — และการไม่รู้ชื่อ ไม่เท่ากับ "ยังไม่มอบหมาย"
 *
 * เห็นจริงบน staging 2026-09-07 ที่หน้ามอบหมายงานใหม่ของผู้จัดตาราง:
 *
 *   { currentAuditorId: "e09508ad-…", currentAuditor: "ยังไม่มอบหมาย" }
 *
 * สองคีย์ที่ขัดกันเองในแถวเดียว · เพราะโค้ดอ่านชื่อจาก `formData.auditorName` ซึ่งเป็นสำเนา
 * ที่เขียนไว้ตอนมอบหมาย ถ้ารอบนั้นไม่ได้เขียน (มอบหมายด้วยเส้นทางอื่น หรือแถวเก่า) ก็ตกไปที่
 * คำว่า "ยังไม่มอบหมาย" ทั้งที่บรรทัดถัดไปมี id ของคนที่ถืองานอยู่
 *
 * ผลกับการทำงานจริง: ผู้จัดตารางเห็นว่างานนี้ไม่มีใครถือ แล้วดึงไปให้คนอื่น — ทั้งที่กำลัง
 * แย่งงานจากมือเพื่อนร่วมงานที่ลงพื้นที่อยู่ · บนแพลตฟอร์มที่มีผลทางกฎหมาย การบอกว่า
 * "ไม่มีใครรับผิดชอบ" ทั้งที่มี เป็นคำตอบที่ผิดคนละชั้นกับการบอกว่า "ไม่รู้ชื่อ"
 *
 * โมดูลนี้แยกสามสถานะออกจากกันอย่างที่ควรเป็น และให้ทั้งจอผู้ตรวจแปลงกับจอผู้ตรวจเอกสาร
 * ใช้คำเดียวกัน (ทั้งคู่มีบั๊กเดียวกันคนละไฟล์)
 *
 * @module shared/assigned-officer-name
 */

const UNASSIGNED_TH = 'ยังไม่มอบหมาย';
const ASSIGNED_UNKNOWN_NAME_TH = 'มอบหมายแล้ว (ไม่ทราบชื่อ)';

const fullName = (user) => {
    if (!user) { return ''; }
    return `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
};

/**
 * @param {object}  args
 * @param {string|null} [args.officerId]  ค่าในคอลัมน์ที่ผูกงานกับคน — เป็นตัวตัดสินว่า "มอบหมายแล้วหรือยัง"
 * @param {object|null} [args.officer]    แถวผู้ใช้ที่ join มา ถ้ามี
 * @param {string|null} [args.storedName] ชื่อที่ถูกคัดลอกไว้ตอนมอบหมาย (formData) — ใช้เป็นทางถอย
 * @returns {string}
 */
function assignedOfficerName({ officerId, officer, storedName } = {}) {
    if (!String(officerId || '').trim()) { return UNASSIGNED_TH; }
    const joined = fullName(officer);
    if (joined) { return joined; }
    const copied = String(storedName || '').trim();
    if (copied) { return copied; }
    // งานมีเจ้าของแน่นอน เพราะมี id — ที่ขาดคือชื่อ และต้องไม่ถูกอ่านว่าไม่มีเจ้าของ
    return ASSIGNED_UNKNOWN_NAME_TH;
}

module.exports = { assignedOfficerName, UNASSIGNED_TH, ASSIGNED_UNKNOWN_NAME_TH };
