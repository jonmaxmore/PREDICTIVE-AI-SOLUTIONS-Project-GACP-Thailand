/**
 * GOALS.md G1 item 1 — the tariff has ONE home, and `config/payment-fees.js` is not it.
 *
 * A duplicated constant is usually a tidiness problem. A duplicated FEE is not: the two
 * copies agree until the day one of them is edited, and from then on the amount an
 * applicant is shown, the amount the invoice charges and the amount remitted to the
 * department are three different numbers with no way to tell which is right. GOALS.md
 * records the consequence as the "บั๊ก 30k/15k".
 *
 * Equality today proves nothing — two literals that happen to match are exactly the
 * state before a divergence. So these tests change the SOURCE and assert the derived
 * table follows. A copy cannot pass them.
 */
'use strict';

const REAL_RULES = jest.requireActual('../../config/business-rules');

/** Load payment-fees with a business-rules whose tariff we control. */
function loadWithFees(overrides) {
    let table;
    jest.isolateModules(() => {
        jest.doMock('../../config/business-rules', () => ({
            ...REAL_RULES,
            FEES: { ...REAL_RULES.FEES, ...overrides },
        }));
        // eslint-disable-next-line global-require
        // The module exports { PAYMENT_FEES, computePhaseBreakdown, … }.
        table = require('../../config/payment-fees').PAYMENT_FEES;
    });
    return table;
}

afterEach(() => { jest.dontMock('../../config/business-rules'); });

describe('payment-fees is a VIEW of the tariff, never a second copy of it', () => {
    test('ค่าบริการงวดที่ 1 ตามที่ config/business-rules ประกาศ', () => {
        const raised = loadWithFees({ PHASE1_PER_SCOPE: 7000 });
        expect(raised.PHASE_1_SERVICE_FEE).toBe(7000);
        // …and is not merely equal to the old literal by coincidence.
        expect(raised.PHASE_1_SERVICE_FEE).not.toBe(5500);
    });

    test('ค่าบริการงวดที่ 2 ก็ตามเช่นกัน', () => {
        const raised = loadWithFees({ PHASE2_PER_SCOPE: 40000 });
        expect(raised.PHASE_2_SERVICE_FEE).toBe(40000);
    });

    test('ไม่มีค่าแพลตฟอร์มแยกให้ derive อีกแล้ว — อัตราที่ประกาศคือค่าบริการเอง', () => {
        const raised = loadWithFees({ PHASE1_PER_SCOPE: 7000 });
        // 10% of the state fee (W14 ruling, 2026-08-22).
        expect(raised.PHASE_1_SERVICE_FEE).toBe(7000);
        expect(REAL_RULES.FEES.PLATFORM_RATE).toBeUndefined();
    });

    test('VAT คิดจากค่าบริการทั้งก้อน', () => {
        const raised = loadWithFees({ PHASE1_PER_SCOPE: 7000 });
        expect(raised.PHASE_1_VAT).toBeCloseTo(7000 * REAL_RULES.FEES.VAT_RATE, 6);
    });

    test('the total is the sum of its own parts, on every phase', () => {
        const t = loadWithFees({ PHASE1_PER_SCOPE: 7000, PHASE2_PER_SCOPE: 40000 });
        expect(t.PHASE_1_TOTAL).toBeCloseTo(t.PHASE_1_SERVICE_FEE + t.PHASE_1_VAT, 6);
        expect(t.PHASE_2_TOTAL).toBeCloseTo(t.PHASE_2_SERVICE_FEE + t.PHASE_2_VAT, 6);
        expect(t.TOTAL_STANDARD_FEE).toBeCloseTo(t.PHASE_1_TOTAL + t.PHASE_2_TOTAL, 6);
    });

    test('the rates themselves are not re-declared here either', () => {
        const raised = loadWithFees({ VAT_RATE: 0.11 });
        expect(raised.VAT_RATE).toBe(0.11);
    });
});

describe('todays published tariff is unchanged by making it derived', () => {
    // The regression guard for this very refactor: deriving the numbers must
    // reproduce the ones the platform already invoices, to the satang.
    const live = jest.requireActual('../../config/payment-fees').PAYMENT_FEES;

    test('งวดที่ 1 ยังเป็น ค่าบริการ 5,500 + VAT 385 = 5,885', () => {
        expect(live.PHASE_1_SERVICE_FEE).toBe(5500);
        expect(live.PHASE_1_VAT).toBe(385);
        expect(live.PHASE_1_TOTAL).toBe(5885);
        // ช่องยอดส่วนรัฐถูกถอด 2026-09-11
        expect(live.PHASE_1_GOV_FEE).toBeUndefined();
    });

    test('งวดที่ 2 ยังเป็น ค่าบริการ 27,500 + VAT 1,925 = 29,425', () => {
        expect(live.PHASE_2_SERVICE_FEE).toBe(27500);
        expect(live.PHASE_2_VAT).toBe(1925);
        expect(live.PHASE_2_TOTAL).toBe(29425);
        expect(live.PHASE_2_GOV_FEE).toBeUndefined();
    });

    test('ยอดมาตรฐานยังเป็น 35,310', () => {
        expect(live.TOTAL_STANDARD_FEE).toBe(35310);
    });
});
