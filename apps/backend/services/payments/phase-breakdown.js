/**
 * The fee the payment screen shows must be the fee the invoice charges.
 *
 * `POST /api/payments/create` read `result.breakdown || computeMasterBreakdownByPhase(phase)`,
 * and no return path of `createPhase1Payment` ever set `breakdown` — the
 * already-paid path returns a message, the pending path an invoice id, the
 * fresh path an `amount`. So the fallback fired every time, and it returns flat
 * constants from PAYMENT_FEES: one scope, always.
 *
 * The service meanwhile charged the real figure. fee-service bills
 * `ratePerScope * scopeCount`, so a farm registering outdoor *and* greenhouse
 * pays twice the state fee, and `resolveLockedPhaseTotals` prefers the total
 * frozen on an accepted quotation — the price of record. That is what went onto
 * the invoice.
 *
 * The two disagreeing is not cosmetic. payment-slip-service compares
 * `amountVerified === invoice.totalAmount` exactly: the farmer transfers what
 * the screen said, it does not match the invoice, and their slip is rejected
 * over a discrepancy the platform created.
 *
 * One authority, then. This reports what was actually charged, and when the
 * component amounts cannot be reconciled with that total it reports no
 * components rather than three plausible wrong ones.
 */

/** A satang of rounding is arithmetic. A baht is a different price. */
const RECONCILE_TOLERANCE = 0.02;

function money(value) {
    // `Number(null)` and `Number('')` are both 0, which would make "we do not
    // know what was charged" indistinguishable from "the fee was waived". Those
    // are different things to tell an applicant.
    if (value === null || value === undefined || value === '') {return null;}

    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {return null;}
    return Math.round(number * 100) / 100;
}

/**
 * @param {object} args
 * @param {number|null} args.chargedTotal what the invoice says — the only figure
 *   the applicant's bank transfer will be checked against
 * @param {object|null} args.calculated   ผลของตัวคำนวณค่าธรรมเนียม (`serviceFeeAmount` / `vatAmount`)
 * @returns {{serviceFee: number|null, vat: number|null, total: number|null}}
 *
 * ── ถอด governmentFee ออก 2026-09-11 ──
 * เดิมคืนสามส่วน: governmentFee (ค่าธรรมเนียมรัฐ) · serviceFee (ค่าแพลตฟอร์ม) · vat
 * operator สั่งเลิกแยก ⇒ เหลือ **ค่าบริการก้อนเดียว** กับ VAT ของมัน · ยอดรวมเท่าเดิม
 */
function phaseFeeBreakdown({ chargedTotal, calculated }) {
    const total = money(chargedTotal);
    const withoutParts = { serviceFee: null, vat: null, total };

    if (total === null || !calculated) {return withoutParts;}

    const serviceFee = money(calculated.serviceFeeAmount);
    const vat = money(calculated.vatAmount);
    if (serviceFee === null || vat === null) {return withoutParts;}

    // A breakdown whose parts do not sum to its total is not a breakdown. This
    // happens legitimately — an accepted quotation freezes a price the current
    // fee table no longer produces — and the honest answer is the total alone.
    if (Math.abs(serviceFee + vat - total) > RECONCILE_TOLERANCE) {
        return withoutParts;
    }

    return { serviceFee, vat, total };
}

module.exports = { phaseFeeBreakdown, RECONCILE_TOLERANCE };
