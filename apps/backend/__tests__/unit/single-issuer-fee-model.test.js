'use strict';

/**
 * W14 — single-issuer fee model (operator ruling 2026-08-22,
 * the change log @ c28355ea, figures confirmed @ d1c33ea0).
 *
 * THE RULING
 *   ค่าบริการ (service fee) = ราคาเต็ม (state) + ค่าแพลตฟอร์ม (10% of state)
 *   ยอดชำระ (payable)      = ค่าบริการ + VAT 7% OF THE WHOLE SERVICE FEE
 *
 * The retired formula charged VAT on the platform portion ONLY
 * (เดิม: `vatAmount = round(platformAmount * VAT_RATE)`)
 *
 * ── 2026-09-11: การแยกส่วนถูกถอดทั้งหมด ──
 * operator สั่งว่ามีแต่ค่าบริการ ไม่มีค่าธรรมเนียมรัฐแยก ⇒ ตารางข้างล่างเหลือสามช่อง
 * (ค่าบริการ · VAT · ยอดชำระ) · **ยอดชำระทุกตัวเลขเท่าเดิม**
 * That understated VAT by 7% of the state fee — 2,100 THB per scope on a full
 * application — and is removed outright, not left behind a flag.
 *
 * WHY THE NUMBERS ARE WRITTEN OUT AND NOT COMPUTED
 * Every expectation below is the operator's own confirmed arithmetic, spelled
 * as a literal. A test that recomputed the expectation from the same rates the
 * implementation reads would agree with any formula, including a wrong one —
 * it would pin nothing. These literals are the contract; if the implementation
 * moves, the literals must be re-confirmed by the operator, not edited to match.
 *
 * ROUNDING
 * There is none to speak of, and that is a property worth pinning rather than a
 * coincidence to lean on. state is a multiple of 5,000, so platform = 10% of it
 * is exact, service fee = 11/10 × state is exact, and VAT = 7% of a multiple of
 * 5,500 is exact (5,500 × 0.07 = 385 exactly). Math.round therefore never
 * actually rounds anything at the configured rates, at any scope count, and
 * phase1 + phase2 == the single charge falls out of plain arithmetic:
 * 385n + 1,925n == 2,310n. No residue-absorption rule is needed, and if one
 * ever appears to be needed the derivation is wrong — see the report.
 */

const feeService = require('../../services/fee-service');

// ── The operator's confirmed fixture table ──────────────────────────────────
// Per cultivation-scope count. Confirmed the change log @ d1c33ea0 and restated
// by the operator as a worked example ("5000 + 500 + VAT7% = 5,885").
const TABLE = Object.freeze({
    1: {
        phase1: { service: 5500, vat: 385, payable: 5885 },
        phase2: { service: 27500, vat: 1925, payable: 29425 },
        single: { service: 33000, vat: 2310, payable: 35310 },
    },
    2: {
        phase1: { service: 11000, vat: 770, payable: 11770 },
        phase2: { service: 55000, vat: 3850, payable: 58850 },
        single: { service: 66000, vat: 4620, payable: 70620 },
    },
    3: {
        phase1: { service: 16500, vat: 1155, payable: 17655 },
        phase2: { service: 82500, vat: 5775, payable: 88275 },
        single: { service: 99000, vat: 6930, payable: 105930 },
    },
});

const SCOPES = [1, 2, 3];

/** Assert one fee object against one row of the operator's table. */
function expectFee(fee, row) {
    expect(fee.serviceFeeAmount).toBe(row.service);
    expect(fee.vatAmount).toBe(row.vat);
    expect(fee.phaseTotal).toBe(row.payable);
    expect(fee.total).toBe(row.payable);
}

describe('W14 — new formula: VAT on the whole service fee', () => {
    describe.each(SCOPES)('%i cultivation scope(s)', (scopeCount) => {
        const row = TABLE[scopeCount];

        test('phase 1 matches the confirmed figures', () => {
            expectFee(feeService.calculatePhase1Fee({}, { scopeCount }), row.phase1);
        });

        test('phase 2 matches the confirmed figures', () => {
            expectFee(feeService.calculatePhase2Fee({}, { scopeCount }), row.phase2);
        });

        test('renewal single charge matches the confirmed figures', () => {
            expectFee(feeService.calculateRenewalFee({}, { scopeCount }), row.single);
        });

        test('VAT คิดจากค่าบริการทั้งก้อน และไม่มีช่องแยกส่วนหลงเหลือ', () => {
            const fee = feeService.calculateRenewalFee({}, { scopeCount });
            expect(fee.vatAmount).toBe(Math.round(fee.serviceFeeAmount * 0.07));
            // 2026-09-11 — การแยก "ส่วนรัฐ / ส่วนแพลตฟอร์ม" ถูกถอดทั้งระบบ
            expect(fee.stateAmount).toBeUndefined();
            expect(fee.platformAmount).toBeUndefined();
        });
    });
});

describe('W14 — a new application splits into two phases that sum to the single charge', () => {
    // The identity the operator called out: phase1 payable + phase2 payable
    // must equal the renewal's single charge EXACTLY, at every scope count.
    test.each(SCOPES)('%i scope(s): phase1 + phase2 == single charge, to the satang', (scopeCount) => {
        const row = TABLE[scopeCount];
        const phase1 = feeService.calculatePhase1Fee({}, { scopeCount });
        const phase2 = feeService.calculatePhase2Fee({}, { scopeCount });
        const single = feeService.calculateRenewalFee({}, { scopeCount });

        expect(phase1.phaseTotal + phase2.phaseTotal).toBe(single.phaseTotal);
        expect(phase1.phaseTotal + phase2.phaseTotal).toBe(row.single.payable);

        // Component-wise too — a total that balances while its parts do not
        // would still produce a wrong invoice line.
        expect(phase1.serviceFeeAmount + phase2.serviceFeeAmount).toBe(single.serviceFeeAmount);
        expect(phase1.vatAmount + phase2.vatAmount).toBe(single.vatAmount);
    });

    // Beyond the three confirmed scope counts: the identity is arithmetic, not
    // a coincidence of the fixture table, so it must hold for any scope count.
    test('the identity holds for scope counts 1..24 with no rounding residue', () => {
        for (let scopeCount = 1; scopeCount <= 24; scopeCount += 1) {
            const phase1 = feeService.calculatePhase1Fee({}, { scopeCount });
            const phase2 = feeService.calculatePhase2Fee({}, { scopeCount });
            const single = feeService.calculateRenewalFee({}, { scopeCount });
            expect(phase1.phaseTotal + phase2.phaseTotal).toBe(single.phaseTotal);
            expect(phase1.vatAmount + phase2.vatAmount).toBe(single.vatAmount);
        }
    });

    test('calculateApplicationFees aggregates to the same payable', () => {
        for (const scopeCount of SCOPES) {
            const fees = feeService.calculateApplicationFees({}, { scopeCount });
            expect(fees.total).toBe(TABLE[scopeCount].single.payable);
            expect(fees.grandTotal).toBe(TABLE[scopeCount].single.payable);
            expect(fees.vatTotal).toBe(TABLE[scopeCount].single.vat);
            expect(fees.serviceFeeTotal).toBe(TABLE[scopeCount].single.service);
        }
    });
});

describe('W14 — the DB money equation still holds under the new formula', () => {
    // checkout_orders CHECK (migration 20260929155037, which dropped dtam_fee_amount):
    //   total_payable_amount = platform_fee_gross (= platform_fee_net + platform_fee_vat)
    // The new formula changes what platform_fee_vat is computed FROM, not the
    // relation between the columns — so no migration is required. Pinned here
    // because a future "simplification" that folds VAT into the net column
    // would silently break the DB CHECK on the first real settlement.
    test.each(SCOPES)('%i รูปแบบ: total == ค่าบริการ + vat ทุกงวด', (scopeCount) => {
        const fees = [
            feeService.calculatePhase1Fee({}, { scopeCount }),
            feeService.calculatePhase2Fee({}, { scopeCount }),
            feeService.calculateRenewalFee({}, { scopeCount }),
        ];
        for (const fee of fees) {
            expect(fee.phaseTotal).toBe(fee.serviceFeeAmount + fee.vatAmount);
        }
    });
});
