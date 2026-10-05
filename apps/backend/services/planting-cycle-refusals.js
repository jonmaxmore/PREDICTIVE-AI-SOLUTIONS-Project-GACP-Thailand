'use strict';

/**
 * คำปฏิเสธตอนสร้างรอบปลูก — แยก "ผู้ใช้กรอกไม่ผ่านกฎ" ออกจาก "ระบบพัง"
 *
 * กดจริงบน staging 2026-09-07: เกษตรกรกดสร้างรอบปลูกแรกของตัวเอง แล้วได้
 *   500 {"error":"Failed to create planting cycle"}
 * ขณะที่ log ของเซิร์ฟเวอร์เขียนเหตุผลไว้ครบว่า
 *   "Allocated area for plot แปลงหลัก exceeds plot size"
 *
 * ระบบรู้ว่าทำไม แต่บอกผู้ใช้แค่ว่า "ล้มเหลว" เป็นภาษาอังกฤษ · และ 500 ยังบอกผิดชนิด
 * เพราะมันแปลว่าเซิร์ฟเวอร์พัง ทั้งที่เซิร์ฟเวอร์ทำงานถูกทุกขั้น — สิ่งที่ไม่ผ่านคือกฎ
 *
 * ด่านใน planting-service.js:255-270 โยน Error ธรรมดาทั้งหมด ประตูจึงแยกไม่ออกจาก
 * ข้อผิดพลาดจริง · ที่นี่คือที่แยก: ข้อความที่ตรงกับกฎ = คำปฏิเสธ 400 พร้อมเหตุผลภาษาไทย
 * นอกนั้นคืนค่า null แล้วปล่อยให้เป็น 500 ตามเดิม — ของที่พังจริงต้องไม่ถูกกลบ
 *
 * @module services/planting-cycle-refusals
 */

/** กฎ → คำอธิบายภาษาไทยที่ผู้ใช้เอาไปแก้ได้จริง */
const RULES = Object.freeze([
    {
        code: 'CYCLE_PLOT_AREA_EXCEEDED',
        match: /^Allocated area for plot (.+) exceeds plot size$/,
        messageTh: (m) => `พื้นที่ที่ระบุให้แปลง "${m[1]}" มากกว่าขนาดของแปลงที่บันทึกไว้ `
            + 'กรุณาลดพื้นที่ที่ใช้ในรอบนี้ หรือแก้ขนาดแปลงในข้อมูลฟาร์มให้ตรงกับความจริงก่อน',
    },
    {
        code: 'CYCLE_PLOT_AREA_ZERO',
        match: /^Allocated area must be greater than 0 sqm$/,
        messageTh: () => 'กรุณาระบุพื้นที่ที่ใช้ในรอบปลูกนี้ให้มากกว่า 0 ตารางเมตร',
    },
    {
        code: 'CYCLE_PLANT_COUNT_ZERO',
        match: /^plannedPlantCount must be greater than 0$/,
        messageTh: () => 'กรุณาระบุจำนวนต้นตามแผนให้มากกว่า 0',
    },
    {
        code: 'CYCLE_PLOT_UNKNOWN',
        match: /^Plot assignment references unknown plot$/,
        messageTh: () => 'ไม่พบแปลงที่เลือกไว้ในฟาร์มนี้ กรุณาเลือกแปลงใหม่อีกครั้ง',
    },
]);

/**
 * @param {Error} error
 * @returns {{status: number, code: string, error: string, messageTh: string}|null}
 *          null = ไม่ใช่คำปฏิเสธตามกฎ ให้ผู้เรียกจัดการเป็นข้อผิดพลาดของระบบตามเดิม
 */
function classifyCycleValidationError(error) {
    const text = String(error?.message || '').trim();
    if (!text) { return null; }
    for (const rule of RULES) {
        const m = text.match(rule.match);
        if (m) {
            return {
                status: 400,
                code: rule.code,
                error: text,
                messageTh: rule.messageTh(m),
            };
        }
    }
    return null;
}

module.exports = { classifyCycleValidationError, RULES };
