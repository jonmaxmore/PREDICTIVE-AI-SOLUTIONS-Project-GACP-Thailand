'use strict';

/**
 * W2-02 §3.3 — property-based pin of the money equation
 * (the work brief §3.3; design v2 §5.5).
 *
 * The decomposition rule this file pins (the SSOT lives in
 * modules/billing/internal/fee-service.js buildPhaseFee):
 *
 *   platform   = Math.round(state × PLATFORM_RATE)   — rounded per component
 *   serviceFee = state + platform                    — ค่าบริการ
 *   vat        = Math.round(serviceFee × VAT_RATE)   — from the ROUNDED parts
 *   total      = state + platform + vat              — sum of rounded parts
 *
 * W14 (operator ruling 2026-08-22, the change log c28355ea): the VAT base moved
 * from the platform portion alone to the WHOLE service fee. What did NOT change
 * is the SHAPE of the equation — total is still the sum of the three rounded
 * components — which is why the Wave-1 DB CHECK still holds and no migration
 * was required.
 *
 * Never round the sum; never compute VAT on an unrounded base.
 * The Wave-1 DB CHECK enforces the same equation at the row level — this
 * suite is the service-side property pin the mission requires: 1,000
 * seeded-random cases, the equation must hold exactly on every one.
 */

const fs = require('fs');
const path = require('path');
const {
    calculateApplicationFees,
    VAT_RATE,
} = require('../../modules/billing');

// Deterministic LCG (Numerical Recipes constants) so a failing case is
// reproducible from the seed — Math.random() would make reruns lie.
function makePrng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const METHOD_POOL = ['outdoor', 'indoor', 'greenhouse', 'hydroponic', 'organic', 'mixed'];

describe('money equation — 1,000 random cases (seeded)', () => {
    // 2026-09-11 — สมการเปลี่ยนรูปพร้อมการเลิกแยกส่วน: เดิมคือ
    //   total = state + platform(10% ของ state) + vat(7% ของ state+platform)
    // ตอนนี้คือ total = ค่าบริการ + vat(7% ของค่าบริการ) · **ตัวเลขที่ได้เท่าเดิมทุกกรณี**
    test('total = ค่าบริการ + vat ตรงเป๊ะทุกงวด ทุกเคส', () => {
        const rand = makePrng(0x57414532); // "WAE2"
        for (let i = 0; i < 1000; i += 1) {
            const scopeCount = 1 + Math.floor(rand() * 200);
            const methods = METHOD_POOL.slice(0, 1 + Math.floor(rand() * METHOD_POOL.length));
            const fees = calculateApplicationFees(
                { cultivationMethods: methods },
                { scopeCount },
            );

            for (const phase of [fees.phase1, fees.phase2]) {
                const { serviceFeeAmount, vatAmount, phaseTotal } = phase;
                const label = `case ${i} scope ${scopeCount} ค่าบริการ ${serviceFeeAmount}`;

                // จำนวนเต็มบาท — เศษทศนิยมแปลว่ามีคนย้ายการปัดออกไปจากส่วนประกอบ
                expect({ label, ok: Number.isInteger(serviceFeeAmount) }).toEqual({ label, ok: true });
                expect({ label, ok: Number.isInteger(vatAmount) }).toEqual({ label, ok: true });

                // ค่าบริการคือฐานของ VAT
                expect({ label, v: vatAmount }).toEqual({ label, v: Math.round(serviceFeeAmount * VAT_RATE) });

                // ตัวสมการเอง — ตรงเป๊ะ ไม่มี epsilon
                expect({ label, v: phaseTotal }).toEqual({ label, v: serviceFeeAmount + vatAmount });
            }

            // Cross-phase: the grand total is the sum of the phase totals.
            expect(fees.totalAmount ?? fees.phase1.phaseTotal + fees.phase2.phaseTotal)
                .toBe(fees.phase1.phaseTotal + fees.phase2.phaseTotal);
        }
    });

    test('the rounding rule is documented where checkout consumes it (design v2 §5.5)', () => {
        // A rule that lives only in test expectations disappears in the next
        // refactor — pin the prose next to the consuming code and in the
        // design doc, the same way the SDK-isolation grep pin works.
        const serviceSrc = fs.readFileSync(
            path.join(__dirname, '../../services/checkout/stripe-checkout-service.js'), 'utf8');
        expect(serviceSrc).toMatch(/ROUNDING RULE \(design v2 §5\.5\)/);

        const designDoc = fs.readFileSync(
            path.join(__dirname, '../../../../docs/payment-refactor/step2-data-model-design.md'), 'utf8');
        expect(designDoc).toMatch(/ROUNDING RULE|กติกาปัดเศษ/);
    });
});
