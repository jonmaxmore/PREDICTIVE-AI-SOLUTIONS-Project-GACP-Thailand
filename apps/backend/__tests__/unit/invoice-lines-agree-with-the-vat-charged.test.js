/**
 * An invoice may not claim a VAT exemption for money it charged VAT on.
 *
 * ── THE CONTRADICTION, INSIDE ONE DOCUMENT ────────────────────────────────────
 * W14 (operator ruling 2026-08-22): ONE company sells one service, and VAT 7% is
 * charged on the WHOLE ค่าบริการ — the state-priced portion AND the platform fee.
 * fee-service.js has computed it that way since; the order carries
 * platformFeeVat = 7% × (state + platform).
 *
 * The invoice minted alongside that order disagreed with itself:
 *
 *   line 1  ค่าธรรมเนียมกรมการแพทย์แผนไทยฯ (ยกเว้นภาษีมูลค่าเพิ่ม ม.77/1(10))
 *           5,000   isTaxable: false          ← claims an exemption
 *   line 2  ค่าบริการแพลตฟอร์ม                  500   isTaxable: true
 *   line 3  ภาษีมูลค่าเพิ่ม 7% (ของค่าบริการรวม: ค่าธรรมเนียมกรม + ค่าแพลตฟอร์ม)
 *             385                             ← says the base was 5,500
 *
 * Line 1 says the 5,000 is exempt under ม.77/1(10); line 3 says VAT was charged
 * on it. Both are printed on the same tax invoice. Taking the isTaxable flags at
 * face value, the taxable base is 500 and the VAT should be 35 — the document
 * charges 385. That is 350 THB per phase-1 invoice and 1,750 per phase-2 that the
 * line flags cannot account for.
 *
 * Line 3's caption was already corrected once (F-G4-54) to name the whole ค่าบริการ
 * as the base. Line 1 was left claiming the opposite.
 *
 * Nothing downstream reads isTaxable for ภ.พ.30, so the filed VAT figures are not
 * affected — the damage is a false statement on a document the customer keeps,
 * which for a VAT-registered seller (ม.86/4) is its own problem.
 *
 * ── WHAT THESE TESTS PIN ──────────────────────────────────────────────────────
 * Not the wording, and not the flags in isolation: the ARITHMETIC AGREEMENT
 * between the lines and the VAT actually charged. Wording may change; an invoice
 * whose taxable base does not produce its own VAT amount may not ship.
 */

'use strict';

const { FEES } = require('../../config/business-rules');

/**
 * The three lines stripe-checkout-service mints, rebuilt from the same figures
 * the service uses, so this reads the SHAPE out of the source rather than
 * duplicating the amounts.
 */
const SOURCE = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../services/checkout/stripe-checkout-service.js'), 'utf8',
);

/**
 * The line-item block with COMMENT-ONLY lines removed.
 *
 * The exemption assertion below greps for 'ม.77/1(10)', and the comment that
 * records why that claim was removed necessarily quotes it. A guard that counts
 * a MENTION rather than a DECLARATION punishes the explanation and teaches the
 * next person to delete it — the mistake ratchet.sh's dup-source counter and
 * fee-single-source.sh were both fixed for. Strip the prose, read the code.
 */
function invoiceLineBlock() {
    const at = SOURCE.indexOf('await tx.invoiceLineItem.createMany');
    expect(at).toBeGreaterThan(-1);
    const raw = SOURCE.slice(at, SOURCE.indexOf('});', SOURCE.indexOf('data: [', at)));
    return raw.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

function lineFlag(block, code) {
    const at = block.indexOf(`code: '${code}'`);
    expect(at).toBeGreaterThan(-1);
    const upTo = block.indexOf('},', at);
    const m = /isTaxable:\s*(true|false)/.exec(block.slice(at, upTo));
    expect(m).not.toBeNull();
    return m[1] === 'true';
}

function amountsFor(servicePerScope) {
    // operator 2026-09-11 — the declared rate IS ค่าบริการ. It used to be a state
    // base with a 10% platform cut added on top; FEES.PLATFORM_RATE is gone, and
    // reading it here would have produced NaN rather than a failure that says so.
    const service = servicePerScope;
    const vat = Math.round(service * FEES.VAT_RATE);
    return { service, vat };
}

describe('the invoice lines and the VAT charged tell the same story', () => {
    const block = invoiceLineBlock();

    test('there is no state-priced line left to mark exempt', () => {
        // It was here, marked taxable, because W14 put the ราคาเต็ม portion inside
        // the VAT base. 2026-09-11 retired the portion itself: the line would now
        // print 0 baht under a caption that names a component of the price that
        // no longer exists, so it is removed rather than zeroed.
        expect(block).not.toContain("code: 'STATE_FEE'");
    });

    test('the service-fee line is taxable — it is the whole VAT base', () => {
        expect(lineFlag(block, 'PLATFORM_FEE')).toBe(true);
    });

    test('the VAT line itself is not taxable — it is the tax, not a supply', () => {
        expect(lineFlag(block, 'PLATFORM_VAT')).toBe(false);
    });

    test.each([
        ['phase 1', () => FEES.PHASE1_PER_SCOPE],
        ['phase 2', () => FEES.PHASE2_PER_SCOPE],
        ['renewal', () => FEES.RENEWAL_PER_SCOPE],
    ])('%s: the taxable lines produce exactly the VAT the invoice charges', (_label, rate) => {
        const { service, vat } = amountsFor(rate());
        // Every line the flags call taxable, summed, times the rate, must be the
        // VAT amount on the document. Under the old flags this was 35 vs 385.
        const taxableBase = lineFlag(block, 'PLATFORM_FEE') ? service : 0;
        expect(Math.round(taxableBase * FEES.VAT_RATE)).toBe(vat);
    });

    test('no line still claims the retired ม.77/1(10) exemption', () => {
        // The exemption was real under the two-channel model, where the state fee
        // was a government receipt the platform never earned. W14 retired that.
        expect(block).not.toContain('ม.77/1(10)');
        expect(block).not.toContain('ยกเว้นภาษีมูลค่าเพิ่ม');
    });

    test('the invoice names the line the way the receipt will', () => {
        // checkout-settlement-service issues the document the farmer keeps, and
        // calls this line 'ค่าบริการดำเนินการรับรองมาตรฐาน GACP (ราคาเต็ม)'. An invoice
        // and a receipt for the same money describing it differently is how a
        // farmer ends up believing they paid a government fee they did not.
        const settlement = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../services/checkout/checkout-settlement-service.js'), 'utf8',
        );
        // fix/fee-line-descriptions (operator 2026-10-03): both name the line from the
        // one catalogue with the same call, rather than two copies of one literal.
        const receiptWording = /description: (serviceFor\([^\n]*\)\.name),/.exec(settlement);
        expect(receiptWording).not.toBeNull();
        expect(block).toMatch(/description: serviceFor\(milestone, \{ isRenewal: [^\n]*\}\)\.name,/);
        expect(receiptWording[1]).toMatch(/^serviceFor\(order\.milestone, \{ isRenewal: [^\n]*\}\)\.name$/);
    });
});
