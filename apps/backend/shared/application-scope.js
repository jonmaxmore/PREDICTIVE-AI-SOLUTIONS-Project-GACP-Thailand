/**
 * How many certification scopes an application is billed for.
 *
 * `Application.cultivationScopeCount` is the column that says what it holds:
 * one scope per DISTINCT cultivation method the applicant declared, resolved by
 * feeService.resolveCultivationScopeCount and stamped by every writer as
 * `fees.scopeCount`. It is the multiplier on every quotation, invoice and
 * receipt line.
 *
 * `Application.totalAreaTypes` is the name it replaces (migration
 * 20260826090000_area_sqm_and_cultivation_scope_expand). It never counted area
 * types; it was named for a design in which one submission fanned out into N
 * sibling applications, one per area type, which nothing writes any more. It is
 * still written by every writer, so a rollback to the previous image prices
 * correctly, and it is what a row carries when it was last written by that
 * image or when a caller's `select` predates the rename.
 *
 * DELETE THE FALLBACK in the contract change, once `totalAreaTypes` is dropped:
 * `application.cultivationScopeCount` then stands alone.
 *
 * Returns null rather than a default, so each caller keeps the default it
 * already chose — `?? 1` where a missing count means one scope, `undefined`
 * where a missing count means "do not override the fee service".
 *
 * @param {{ cultivationScopeCount?: unknown, totalAreaTypes?: unknown }} application
 * @returns {number|null} a positive scope count, or null if the row does not state one
 */
function storedCultivationScopeCount(application) {
    const raw = application?.cultivationScopeCount ?? application?.totalAreaTypes;
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * คำเดียวที่ลงคอลัมน์ `Application.areaType` ได้ — **มาจากสิ่งที่ผู้ยื่นติ๊ก ไม่ใช่จากค่าเริ่มต้น**
 *
 * operator 2026-09-11: *"ค่า draft เริ่มต้นไม่ใช่ OUTDOOR แต่ต้องตรงกับรูปแบบการปลูกที่เลือก"*
 *
 * ปัญหาเดิม: คอลัมน์นี้เป็น NOT NULL จากยุคที่หนึ่งคำขอมีหนึ่งลักษณะ · พอโลกเปลี่ยนเป็น
 * ติ๊กได้หลายข้อ คอลัมน์ไม่ถูกจัดการ ประตูร่างจึงเติม `'OUTDOOR'` ให้เองเพื่อให้มีค่า
 * แล้วค่าที่ประดิษฐ์นั้นถูกอ่านต่อเหมือนเป็นคำตอบของคน: เป็นทางถอยของราคา เป็นมิติสุดท้าย
 * ที่ทะเบียนกฎใช้เลือกชุดเอกสาร และพิมพ์บนจอเจ้าหน้าที่ว่า "ประเภทพื้นที่: OUTDOOR"
 *
 * ลำดับคำคงที่ตามทะเบียน ไม่ใช่ตามลำดับที่ผู้ยื่นคลิก — คำขอเดียวกันต้องได้ค่าเดิมเสมอ
 *
 * ยังไม่ติ๊ก = `'UNDECLARED'` ไม่ใช่คำใดในทะเบียน จึงไม่มีใครอ่านมันเป็นคำประกาศได้:
 * ทะเบียนกฎกรองคำที่ไม่รู้จักทิ้ง (= เงียบ = wildcard เหมือน NULL) และตัวคิดเงินเลิกอ่าน
 * คอลัมน์นี้ไปแล้ว · ค่านี้โผล่ได้เฉพาะบนร่างที่ยังไม่ยื่น เพราะประตูยื่นบังคับให้ติ๊ก
 * ⇒ ปลายทางที่ถูกต้องคือคอลัมน์ nullable ซึ่งต้อง migration แยกใบ
 */
const AREA_TYPE_UNDECLARED = 'UNDECLARED';

function areaTypeFromTicks(formData, fallback = AREA_TYPE_UNDECLARED) {
    const { AREA_TYPES } = require('../validation/canonical-application-validator');
    const farmData = formData && typeof formData === 'object' ? formData.farmData : null;
    const ticks = Array.isArray(farmData?.areaTypes) ? farmData.areaTypes : [];
    const words = new Set(ticks.map((t) => String(t ?? '').trim().toUpperCase()));
    const inRegisterOrder = AREA_TYPES.filter((word) => words.has(word));
    return inRegisterOrder[0] || fallback;
}

/**
 * WHICH cultivation types this application is billed for.
 *
 * ONE function for every reader of the price (moved here from quotation-service.js
 * 2026-10-02, M4): the quotation prices with it, and so does the applicant preview
 * (routes/api/preview/preview.js), so the figure the applicant sees before submitting
 * is the figure the quotation will charge.
 *
 * The DECLARATION wins. `formData` is where the six-step wizard records ลักษณะพื้นที่ (กทล.๑
 * ส่วนที่ ๒ asks it as a checkbox row), and it is the same declaration the submit gate is
 * judged by — the price and the paperwork have to describe one application.
 *
 * Found by walking the real doors 2026-09-06: this function read
 * `storedCultivationScopeCount` FIRST, which looks at the `cultivationScopeCount` /
 * `totalAreaTypes` COLUMNS and falls back to 1. The wizard writes neither column, so a
 * filing that ticked three types was quoted for one — 35,310 THB against the 105,930 the
 * operator's ruling makes it, and no unit test could see it because they all call the fee
 * engine with formData directly.
 *
 * The stored column stays as the FALLBACK, for a row that declares nothing: an application
 * priced before the wizard recorded its ticks has nothing else left that knows what it was
 * quoted for, and re-pricing it down to one scope would be a worse answer than trusting the
 * number it was issued with.
 */
function billableScopes(application) {
    // Lazy: modules/billing is not needed by the other readers of this file.
    const { collectUniqueCultivationMethods } = require('../modules/billing');
    const declared = collectUniqueCultivationMethods(application?.formData || {});
    if (declared.length > 0) {
        return declared;
    }
    const stored = storedCultivationScopeCount(application);
    const count = Number.isFinite(stored) && stored > 0 ? stored : 1;
    return Array.from({ length: count }, (_unused, i) => `SCOPE_${i + 1}`);
}

module.exports = {
    storedCultivationScopeCount,
    billableScopes,
    areaTypeFromTicks,
    AREA_TYPE_UNDECLARED,
};
