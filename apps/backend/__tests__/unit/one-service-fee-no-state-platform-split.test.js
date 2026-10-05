'use strict';
/**
 * ราคาเดียว: ค่าบริการ — ไม่มีการแยก "ค่าธรรมเนียมรัฐ" กับ "ค่าแพลตฟอร์ม" อีกต่อไป
 *
 * operator 2026-09-11: *"ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการ
 * ทั้งหมด 5,500 + 27,500 ถ้า +vat 7 จะเท่ากับ 5,885 + 29,425 รวม vat 7% จะเท่ากับ 35,310
 * เรามีราคานี้เท่านั้น ต่อ 1 รูปแบบการปลูก แบบอื่นไม่ถูกต้อง เก็บกวาด และคลีนทิ้งให้หมด"*
 *
 * ═══ ยอดไม่เปลี่ยนแม้แต่สตางค์เดียว ═══
 * เดิม: รัฐ 5,000 → แพลตฟอร์ม 10% = 500 → ค่าบริการ 5,500 → VAT 385 → 5,885
 * ใหม่: **ค่าบริการ 5,500** → VAT 385 → 5,885
 * นี่คือการเลิกคำนวณย้อนกลับ ไม่ใช่การขึ้นหรือลดราคา — ตัวเลขที่เกษตรกรจ่ายเท่าเดิมเป๊ะ
 * ด่านนี้จึงตรึงทั้งสองอย่างพร้อมกัน: **คำศัพท์เปลี่ยน** และ **เงินไม่เปลี่ยน**
 *
 * ═══ ทำไมการแยกนั้นเป็นคำโกหกอยู่แล้ว ═══
 * รางที่ใช้จริงมินต์ใบเดียว serviceType `CERTIFICATION_CHECKOUT_M1|M2` ซึ่งไม่ลงท้าย
 * `_STATE_FEE` ⇒ `invoice-side.js` จัดให้อยู่ฝั่งบริษัททั้งก้อนอยู่แล้ว · และไม่มีเส้นทางใด
 * ในระบบมินต์ใบ `*_STATE_FEE` อีกเลย (เหลือแต่ตัวอ่าน) · ที่ร้ายกว่านั้นคือ
 * `platformFeeGross = platformFeeNet + platformFeeVat` = 500 + 385 = 885 ซึ่ง **ไม่ใช่**
 * "ค่าแพลตฟอร์มบวก VAT ของมัน" — 385 คือ VAT ของทั้ง 5,500 · ชื่อกับค่าไม่ตรงกันมานานแล้ว
 */

const feeService = require('../../services/fee-service');
const { FEES } = require('../../config/business-rules');

const SERVICE_FEE = Object.freeze({ PHASE_1: 5500, PHASE_2: 27500, RENEWAL: 33000 });
const VAT = Object.freeze({ PHASE_1: 385, PHASE_2: 1925, RENEWAL: 2310 });
const PAYABLE = Object.freeze({ PHASE_1: 5885, PHASE_2: 29425, RENEWAL: 35310 });

describe('ราคาที่ประกาศไว้ คือค่าบริการเอง', () => {
    it('ค่าบริการต่อหนึ่งรูปแบบ ประกาศไว้ตรง ๆ ไม่ต้องบวก 10% เอง', () => {
        expect(FEES.PHASE1_PER_SCOPE).toBe(SERVICE_FEE.PHASE_1);
        expect(FEES.PHASE2_PER_SCOPE).toBe(SERVICE_FEE.PHASE_2);
        expect(FEES.RENEWAL_PER_SCOPE).toBe(SERVICE_FEE.RENEWAL);
    });

    it('ไม่มีอัตราแพลตฟอร์มเหลืออยู่ให้ใครหยิบไปคูณ', () => {
        expect(FEES.PLATFORM_RATE).toBeUndefined();
    });

    it('VAT ยังเป็น 7%', () => {
        expect(FEES.VAT_RATE).toBe(0.07);
    });
});

describe('ผลลัพธ์ของตัวคำนวณ พูดคำเดียว', () => {
    const one = () => feeService.calculateApplicationFees({}, { scopeCount: 1 });

    it.each([['phase1', 'PHASE_1'], ['phase2', 'PHASE_2']])('%s — ค่าบริการ VAT และยอดชำระ ตรงตามมติ', (key, phase) => {
        const p = one()[key];
        expect(p.serviceFeeAmount).toBe(SERVICE_FEE[phase]);
        expect(p.vatAmount).toBe(VAT[phase]);
        expect(p.phaseTotal).toBe(PAYABLE[phase]);
    });

    it('ไม่มีคำว่า stateAmount / platformAmount หลงเหลือในผลลัพธ์', () => {
        const fees = one();
        for (const phase of [fees.phase1, fees.phase2]) {
            expect(phase).not.toHaveProperty('stateAmount');
            expect(phase).not.toHaveProperty('platformAmount');
            for (const line of phase.scopeBreakdown) {
                expect(line).not.toHaveProperty('stateAmount');
                expect(line).not.toHaveProperty('platformAmount');
            }
        }
    });

    it('บรรทัดต่อรูปแบบ รวมกันได้เท่ายอดของงวด — ไม่ใช่ยอดหารกลับ', () => {
        const fees = feeService.calculateApplicationFees({}, { scopeCount: 3 });
        for (const phase of [fees.phase1, fees.phase2]) {
            expect(phase.scopeBreakdown).toHaveLength(3);
            const summed = phase.scopeBreakdown.reduce((s, l) => s + l.serviceFeeAmount, 0);
            expect(summed).toBe(phase.serviceFeeAmount);
        }
    });

    it('การต่ออายุคิดครั้งเดียว เท่ากับสองงวดรวมกันพอดี', () => {
        const renewal = feeService.calculateRenewalFee({ cultivationScopeCount: 1 });
        expect(renewal.serviceFeeAmount).toBe(SERVICE_FEE.RENEWAL);
        expect(renewal.phaseTotal).toBe(PAYABLE.RENEWAL);
        expect(SERVICE_FEE.PHASE_1 + SERVICE_FEE.PHASE_2).toBe(SERVICE_FEE.RENEWAL);
        expect(PAYABLE.PHASE_1 + PAYABLE.PHASE_2).toBe(PAYABLE.RENEWAL);
    });
});

describe('เงินไม่ขยับ — ด่านกันการขึ้นราคาโดยไม่ตั้งใจ', () => {
    it.each([[1, 35310], [2, 70620], [3, 105930]])('%i รูปแบบ = %i บาท', (n, expected) => {
        const f = feeService.calculateApplicationFees({}, { scopeCount: n });
        expect(f.phase1.phaseTotal + f.phase2.phaseTotal).toBe(expected);
    });
});
