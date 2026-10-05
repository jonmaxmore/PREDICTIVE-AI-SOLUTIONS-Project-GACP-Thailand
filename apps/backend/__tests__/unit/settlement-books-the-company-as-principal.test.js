/**
 * The company is the PRINCIPAL: it earns the whole ค่าบริการ and owes DTAM a cost.
 *
 * ── THE RULING ────────────────────────────────────────────────────────────────
 * Operator, 2026-09-05: "ไม่มียกเว้นภาษีแล้ว เก็บเต็ม · เรื่องรับเงิน บริษัทรับแทนเป็นรายได้
 * ทั้งหมด เพราะเรื่องจ่ายเงิน บริษัทเป็นผู้จ่ายกรม ภายหลัง."
 *
 * Two statements about two different sides of one transaction:
 *   RECEIVING — the whole amount is the company's REVENUE. Not a split where
 *     part of the cash belongs to someone else.
 *   PAYING    — what goes to DTAM is the company's own payment, made later. That
 *     makes it a COST of earning the revenue, and a payable until it is paid.
 *
 * This is the principal presentation under TFRS for NPAEs / TAS 18 (agent-vs-
 * principal), and it follows from W14: one issuer, one supply, VAT on all of it.
 * An agent does not charge VAT on money it merely holds; this company does, so
 * it is not holding it.
 *
 * ── WHAT WAS BOOKED BEFORE, AND WHY IT UNDERSTATED THE BUSINESS ───────────────
 *   Dr Cash 5,885 · Cr Payable-to-DTAM 5,000 · Cr Revenue 500 · Cr VAT 385
 *
 * Revenue of 500 on a 5,885 sale. The income statement showed a company with a
 * tenth of its actual turnover and no cost of sales, and the 5,000 appeared as
 * money held for someone else from the instant it arrived — which is the agent
 * treatment the same platform charges VAT against.
 *
 *   Dr Cash 5,885 · Cr Revenue 5,500 · Cr VAT 385
 *   Dr Cost — DTAM fee 5,000 · Cr Payable-to-DTAM 5,000
 *
 * Gross profit is identical (500). Turnover, cost of sales and the reason the
 * payable exists are all now what actually happened.
 *
 * ── 2026-09-29: THE COST HALF LEAVES THIS LEDGER ─────────────────────────────
 * Operator: the company settles with DTAM OFFLINE and books it in its own
 * accounts. The platform keeps no DTAM payable, no remittance pipeline and no
 * DTAM fee split. Since 2026-09-11 there is also no state portion in the price:
 * the whole ค่าบริการ sits in platform_fee_net. So the entry is now
 *
 *   Dr Cash 5,885 · Cr Revenue 5,500 · Cr VAT 385
 *
 * and the Dr Cost-DTAM / Cr Payable-DTAM pair that stood beside it (2026-09-05
 * → 2026-09-29) is gone, with both accounts. The RECEIVING half of the ruling
 * above still holds exactly: the whole amount is the company's revenue.
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({ prisma: null }));

const { buildPaymentEntryLines, ACCOUNTS } = require('../../services/journal-entry-service');

/** Phase 1, one scope: 5,500 + 385 = 5,885 — as settlement passes it. */
const COMPONENTS = { platformFee: 5500, vat: 385 };
const CASH = 5885;

function entry(components = COMPONENTS, totalAmount = CASH) {
    return buildPaymentEntryLines({
        invoiceId: 'inv-1',
        invoiceNumber: 'TAX-PRD-2569-0001',
        serviceType: 'PHASE_1_FEE',
        totalAmount,
        components,
    });
}

const creditOn = (e, code) => e.lines.filter((l) => l.accountCode === code)
    .reduce((sum, l) => sum + l.credit, 0);

const DTAM_CODES = ['2151-001', '5110-001'];

describe('receiving: the whole ค่าบริการ is the company\'s revenue', () => {
    test('revenue is the whole service fee', () => {
        expect(creditOn(entry(), ACCOUNTS.REVENUE_PLATFORM_FEE.code)).toBe(5500);
    });

    test('no part of the cash is credited to a payable — revenue + VAT account for all of it', () => {
        const e = entry();
        const cashLine = e.lines.find((l) => l.accountCode === ACCOUNTS.CASH_BANK.code);
        expect(cashLine.debit).toBe(CASH);
        const creditsAgainstCash = creditOn(e, ACCOUNTS.REVENUE_PLATFORM_FEE.code)
            + creditOn(e, ACCOUNTS.VAT_PAYABLE_OUTPUT.code);
        expect(creditsAgainstCash).toBe(CASH);
    });

    test('output VAT is 7% of the whole service', () => {
        expect(creditOn(entry(), ACCOUNTS.VAT_PAYABLE_OUTPUT.code)).toBe(385);
    });
});

describe('paying DTAM is not on this ledger (operator 2026-09-29)', () => {
    test('no DTAM cost and no DTAM payable line', () => {
        const codes = entry().lines.map((l) => l.accountCode);
        for (const code of DTAM_CODES) {
            expect(codes).not.toContain(code);
        }
        expect(ACCOUNTS.COST_DTAM_FEE).toBeUndefined();
        expect(ACCOUNTS.PAYABLE_TO_DTAM).toBeUndefined();
    });
});

describe('the entry balances on cash alone, at every price', () => {
    test.each([
        ['phase 1, 1 scope', { platformFee: 5500, vat: 385 }, 5885],
        ['phase 2, 1 scope', { platformFee: 27500, vat: 1925 }, 29425],
        ['phase 1, 3 scopes', { platformFee: 16500, vat: 1155 }, 17655],
        ['renewal, 1 scope', { platformFee: 33000, vat: 2310 }, 35310],
    ])('%s', (_label, components, cash) => {
        const e = entry(components, cash);
        expect(e.balanced).toBe(true);
        expect(e.totalDebit).toBe(cash);
        expect(e.totalCredit).toBe(cash);
        expect(e.lines).toHaveLength(3);
    });
});
