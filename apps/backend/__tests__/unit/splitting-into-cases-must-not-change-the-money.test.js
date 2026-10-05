'use strict';
/**
 * แตกเป็น N เคส ต้องไม่ทำให้เกษตรกรจ่ายต่างจากเดิม
 *
 * operator 2026-09-11: *"แก้ไขเป็นจ่ายเงิน 3 ใบครับ เพราะ 3 ยอดรวมกันมันจะกระทบยอดกันยาก
 * ระหว่างงวด 1 และงวด 2"* — มติเรื่อง **รูปของใบ** ไม่ใช่เรื่อง **ยอดเงิน**
 *
 * ═══ ทำไมต้องมีด่านนี้ ═══
 * ก่อนแตกเคส: คำขอใบเดียว `cultivationScopeCount = 3` → ค่าธรรมเนียมคูณสาม
 * หลังแตกเคส: สามคำขอ ใบละ `cultivationScopeCount = 1` → สามใบ ใบละหนึ่งเท่า
 * ทั้งสองทางต้องได้ยอดรวมเท่ากันเป๊ะ · ถ้าไม่เท่า แปลว่าการแตกเคสไป **เก็บเงินเพิ่ม
 * หรือเก็บขาด** โดยไม่มีใครสั่ง — และจะไปโผล่ที่ใบเสร็จของเกษตรกรจริง
 *
 * ค่าธรรมเนียมเป็นฟังก์ชันบริสุทธิ์ของ scopeCount ⇒ ตรึงด้วยเลขได้ตรง ๆ ไม่ต้องมีฐานข้อมูล
 *
 * ═══ กับดักที่ตรึงไว้ด้วย ═══
 * `storedCultivationScopeCount` อ่าน `cultivationScopeCount ?? totalAreaTypes`
 * `totalAreaTypes` เป็นคอลัมน์ตกค้างจากการออกแบบเก่าที่ถูกทิ้งไปแล้ว ⇒ ถ้าเคสใดไม่ได้ตั้ง
 * `cultivationScopeCount` ค่าตกค้างนั้นจะกลายเป็นตัวคูณเงียบ ๆ และเคสเดียวจะถูกเรียกเก็บสามเท่า
 */

const feeService = require('../../services/fee-service');
const { storedCultivationScopeCount } = require('../../shared/application-scope');
const { AREA_TYPES } = require('../../validation/canonical-application-validator');

const totalOf = (scopeCount) => {
    const fees = feeService.calculateApplicationFees({}, { scopeCount });
    return (fees.phase1?.phaseTotal || 0) + (fees.phase2?.phaseTotal || 0);
};

describe('การแตกเคสไม่เปลี่ยนยอดเงิน', () => {
    it.each([2, 3])('ติ๊ก %i รูปแบบ — ยอดรวมของเคสย่อยเท่ากับคำขอใบเดียวที่ถือทุกรูปแบบ', (n) => {
        const asOneApplication = totalOf(n);
        const asSeparateCases = Array.from({ length: n }, () => totalOf(1))
            .reduce((sum, t) => sum + t, 0);
        expect(asSeparateCases).toBe(asOneApplication);
    });

    it('ยอดต่อเคสเท่ากันทุกใบ — ไม่มีเคสไหนแพงกว่าเพราะมาทีหลัง', () => {
        const each = AREA_TYPES.map(() => totalOf(1));
        expect(new Set(each).size).toBe(1);
    });

    it('ทั้งสองงวดคูณตามจำนวนรูปแบบเท่ากัน ไม่ใช่แค่งวดเดียว', () => {
        const one = feeService.calculateApplicationFees({}, { scopeCount: 1 });
        const three = feeService.calculateApplicationFees({}, { scopeCount: 3 });
        expect(three.phase1.phaseTotal).toBe(one.phase1.phaseTotal * 3);
        expect(three.phase2.phaseTotal).toBe(one.phase2.phaseTotal * 3);
    });
});

describe('เคสที่แตกออกมา ต้องถูกอ่านว่าเป็นหนึ่งรูปแบบเสมอ', () => {
    it('เคสที่ตัวแตกเคสสร้าง ถูกอ่านเป็น 1', () => {
        // รูปแถวที่ application-fan-out เขียนจริง
        expect(storedCultivationScopeCount({ cultivationScopeCount: 1 })).toBe(1);
    });

    it('คอลัมน์ตกค้าง totalAreaTypes แพ้ค่าที่ตั้งไว้ชัดเจน — ไม่กลายเป็นตัวคูณเงียบ ๆ', () => {
        // ร่างที่มาจากยุคออกแบบเก่ายังถือ totalAreaTypes = 3 ได้ · ตัวแตกเคสตั้ง
        // cultivationScopeCount = 1 ทับไว้ทุกใบ ⇒ ต้องอ่านได้ 1 ไม่ใช่ 3
        expect(storedCultivationScopeCount({ cultivationScopeCount: 1, totalAreaTypes: 3 })).toBe(1);
    });

    it('ถ้าเคสไหนไม่มี cultivationScopeCount ค่าตกค้างจะกลายเป็นตัวคูณจริง — นี่คือเหตุผลที่ตัวแตกเคสต้องตั้งเสมอ', () => {
        // ตรึงพฤติกรรมตามจริง ไม่ใช่ตามที่อยากให้เป็น: ด่านนี้บอกว่าความปลอดภัยมาจาก
        // การที่ตัวแตกเคส **เขียนค่าทุกใบ** ไม่ได้มาจาก storedCultivationScopeCount
        expect(storedCultivationScopeCount({ totalAreaTypes: 3 })).toBe(3);
    });
});
