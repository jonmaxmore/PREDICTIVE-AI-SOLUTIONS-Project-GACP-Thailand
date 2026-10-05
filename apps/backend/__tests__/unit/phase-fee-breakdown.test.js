/**
 * The fee the payment screen shows must be the fee the invoice charges.
 *
 * `POST /api/payments/create` did this:
 *
 *     const result = await createPhase1Payment(applicationId, healthId);
 *     const breakdown = result.breakdown || computeMasterBreakdownByPhase(phase);
 *
 * `computeMasterBreakdownByPhase` returns flat constants from PAYMENT_FEES —
 * one scope, always. And no return path of `createPhase1Payment` sets
 * `breakdown`: the "already paid" path, the "pending invoice" path and the
 * fresh-creation path return `message` / `invoiceId` / `amount` respectively,
 * and none of them a breakdown. So the fallback fired every single time and the
 * response reported the single-scope fee unconditionally.
 *
 * Meanwhile the service computed the real one. fee-service charges
 * `ratePerScope * scopeCount` — a farm registering outdoor *and* greenhouse
 * pays twice the state fee — and `resolveLockedPhaseTotals` prefers the total
 * frozen on an accepted quotation, which is the price of record. That number
 * went onto the invoice.
 *
 * The two then disagree, and payment-slip-service compares
 * `amountVerified === invoice.totalAmount` exactly. The farmer transfers what
 * the screen said, the amount does not match the invoice, and the slip is
 * rejected — for a discrepancy the platform created.
 *
 * เป็นข้อบกพร่องรูปเดียวกับที่เคยบันทึกไว้อีกชั้นหนึ่ง: ช่องทางชำระเงินตัดยอดส่วนรัฐ
 * ขณะที่ใบแจ้งหนี้ออกเต็มยอดของงวด
 *
 * ── 2026-09-11: เหลือค่าบริการก้อนเดียว ──
 * operator สั่งเลิกแยกค่าธรรมเนียมรัฐกับค่าบริการ ⇒ ส่วนประกอบเหลือสองช่อง
 * (ค่าบริการ + VAT) และ `governmentFee` ถูกถอด · สิ่งที่ไฟล์นี้ปกป้องไม่เปลี่ยน:
 * ยอดที่รายงานต้องเป็นยอดที่ถูกเรียกเก็บจริง และเมื่อส่วนประกอบรวมกันไม่ได้ยอดนั้น
 * ให้รายงานยอดอย่างเดียว ดีกว่ารายงานส่วนประกอบที่ดูน่าเชื่อแต่ผิด
 *
 * So: one authority. The breakdown reports what was actually charged, and when
 * the parts cannot be reconciled with that total it reports no parts rather
 * than plausible wrong ones.
 */

const { phaseFeeBreakdown } = require('../../services/payments/phase-breakdown');

/** งวดที่ 1 หนึ่งรูปแบบ: ค่าบริการ 5,500 + VAT 385 = 5,885 */
const ONE_SCOPE = { serviceFeeAmount: 5500, vatAmount: 385, phaseTotal: 5885 };
/** สองรูปแบบการปลูก: ทุกอย่างคูณสอง */
const TWO_SCOPE = { serviceFeeAmount: 11000, vatAmount: 770, phaseTotal: 11770 };

describe('phaseFeeBreakdown', () => {
    describe('it reports what is actually charged', () => {
        it('passes a single-scope fee through', () => {
            expect(phaseFeeBreakdown({ chargedTotal: 5885, calculated: ONE_SCOPE })).toEqual({
                serviceFee: 5500,
                vat: 385,
                total: 5885,
            });
        });

        it('reports the doubled fee for a farm with two cultivation methods', () => {
            // เคสที่ค่าคงที่แบนทำผิด: ใบแจ้งหนี้บอก 11,770 แต่หน้าจอเคยบอก 5,885
            expect(phaseFeeBreakdown({ chargedTotal: 11770, calculated: TWO_SCOPE })).toEqual({
                serviceFee: 11000,
                vat: 770,
                total: 11770,
            });
        });

        it('never reports a total that differs from what was charged', () => {
            for (const charged of [5885, 11770, 17655, 29425]) {
                expect(phaseFeeBreakdown({ chargedTotal: charged, calculated: ONE_SCOPE }).total)
                    .toBe(charged);
            }
        });
    });

    describe('when a locked quotation overrides the computed price', () => {
        it('reports the locked total, not the recomputed one', () => {
            // An accepted quotation is the price of record. If the fee table
            // changed afterwards, the applicant owes what they accepted.
            const result = phaseFeeBreakdown({ chargedTotal: 5000, calculated: ONE_SCOPE });
            expect(result.total).toBe(5000);
        });

        it('withholds the parts when they cannot add up to that total', () => {
            // 5,000 + 500 + 35 is 5,535, not 5,000. Showing those three lines
            // beside a 5,000 total is a breakdown that does not break down.
            // Better to show the total alone than three plausible wrong numbers.
            const result = phaseFeeBreakdown({ chargedTotal: 5000, calculated: ONE_SCOPE });
            expect(result.serviceFee).toBeNull();
            expect(result.vat).toBeNull();
        });

        it('keeps the parts when they do reconcile', () => {
            expect(phaseFeeBreakdown({ chargedTotal: 5885, calculated: ONE_SCOPE }).serviceFee)
                .toBe(5500);
        });

        it('tolerates a satang of rounding, not a baht', () => {
            expect(phaseFeeBreakdown({
                chargedTotal: 5885.01,
                calculated: ONE_SCOPE,
            }).serviceFee).toBe(5500);

            expect(phaseFeeBreakdown({
                chargedTotal: 5886,
                calculated: ONE_SCOPE,
            }).serviceFee).toBeNull();
        });
    });

    describe('when there is nothing to report', () => {
        it('reports nothing at all when no charge is known', () => {
            // The old fallback substituted the standard fee here, which is a
            // statement about what this applicant owes, made without looking.
            expect(phaseFeeBreakdown({ chargedTotal: null, calculated: ONE_SCOPE })).toEqual({
                serviceFee: null, vat: null, total: null,
            });
            expect(phaseFeeBreakdown({ chargedTotal: undefined, calculated: null })).toEqual({
                serviceFee: null, vat: null, total: null,
            });
        });

        it('reports the total alone when the calculation is missing', () => {
            expect(phaseFeeBreakdown({ chargedTotal: 5885, calculated: null })).toEqual({
                serviceFee: null, vat: null, total: 5885,
            });
        });

        it('refuses a negative or unreadable charge', () => {
            expect(phaseFeeBreakdown({ chargedTotal: -1, calculated: ONE_SCOPE }).total).toBeNull();
            expect(phaseFeeBreakdown({ chargedTotal: Number.NaN, calculated: ONE_SCOPE }).total).toBeNull();
            expect(phaseFeeBreakdown({ chargedTotal: 'abc', calculated: ONE_SCOPE }).total).toBeNull();
        });

        it('accepts a zero charge, which is a waiver and not missing data', () => {
            expect(phaseFeeBreakdown({ chargedTotal: 0, calculated: null }).total).toBe(0);
        });
    });
});
