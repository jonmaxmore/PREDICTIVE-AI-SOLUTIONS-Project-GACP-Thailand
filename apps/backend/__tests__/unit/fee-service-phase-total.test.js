/**
 * Tests for the fee-service phase-total semantics fix (P0-5 in the
 * 2026-04-28 system cohesion audit).
 *
 * ก่อนแก้ buildPhaseFee คืน `total` เป็นยอดส่วนรัฐอย่างเดียว ผลคือ:
 * payment-service-phase-flow read `phase1.total = 5000`, the gateway
 * charged 5000, but the invoice was written for 5535 (state + platform +
 * VAT). The 35 baht VAT and 500 baht platform fee were never collected.
 *
 * After the fix, `total` returns the FULL phase amount that matches
 * exactly what the gateway charges and what the invoice/receipt show.
 * Callers that genuinely want the state-only sub-total now read
 * .serviceFeeAmount (2026-09-11 เลิกแยกส่วน — ไม่มียอดส่วนรัฐแล้ว)
 */

const feeService = require('../../services/fee-service');

function phase(scope, scopeCount) {
    if (scope === 1) {
        return feeService.calculatePhase1Fee({}, { scopeCount });
    }
    return feeService.calculatePhase2Fee({}, { scopeCount });
}

describe('fee-service phase total — P0-5 fix', () => {
    describe('งวดที่ 1 (ค่าบริการ 5,500 ต่อรูปแบบ + VAT 7%)', () => {
        test('1 cultivation method → 5,885 THB', () => {
            const fee = phase(1, 1);
            expect(fee.serviceFeeAmount).toBe(5500);
            expect(fee.vatAmount).toBe(385);
            expect(fee.phaseTotal).toBe(5885);
            expect(fee.total).toBe(5885);
        });

        test('2 cultivation methods → 11,770 THB', () => {
            const fee = phase(1, 2);
            expect(fee.serviceFeeAmount).toBe(11000);
            expect(fee.total).toBe(11770);
        });

        test('3 cultivation methods → 17,655 THB', () => {
            const fee = phase(1, 3);
            expect(fee.serviceFeeAmount).toBe(16500);
            expect(fee.total).toBe(17655);
        });
    });

    describe('งวดที่ 2 (ค่าบริการ 27,500 ต่อรูปแบบ + VAT 7%)', () => {
        test('1 cultivation method → 29,425 THB', () => {
            const fee = phase(2, 1);
            expect(fee.serviceFeeAmount).toBe(27500);
            expect(fee.vatAmount).toBe(1925);
            expect(fee.phaseTotal).toBe(29425);
            expect(fee.total).toBe(29425);
        });

        test('2 cultivation methods → 58,850 THB', () => {
            const fee = phase(2, 2);
            expect(fee.total).toBe(58850);
        });

        test('3 cultivation methods → 88,275 THB', () => {
            const fee = phase(2, 3);
            expect(fee.total).toBe(88275);
        });
    });

    test('ผู้เรียกที่ต้องการยอดก่อน VAT อ่าน .serviceFeeAmount ไม่ใช่ .total', () => {
        const fee = phase(1, 1);
        // .serviceFeeAmount คือค่าบริการก่อน VAT
        expect(fee.serviceFeeAmount).toBe(5500);
        // .total now matches what the gateway charges
        expect(fee.total).toBeGreaterThan(fee.serviceFeeAmount);
    });
});
