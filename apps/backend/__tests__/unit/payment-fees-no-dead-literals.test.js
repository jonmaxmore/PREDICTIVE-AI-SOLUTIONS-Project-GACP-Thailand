/**
 * payment-fees.js retired-literal cleanup (side-fixes 2026-09-26).
 *
 * The module's own header says every amount is DERIVED from
 * config/business-rules.js, but PAYMENT_PHASES.PHASE_1/PHASE_2.amount and
 * RE_PAYMENT_RULES.RE_PAYMENT_TRIGGERS[0].amount were hand-written literals
 * (5000 / 25000 / 5885) — the retired per-scope prices from before the
 * 2026-09-11 one-service-fee ruling (5,500 / 27,500 / 35,310 total).
 * grep across apps/, scripts/, packages/ found no reader of either field
 * (nested key or dynamic/bracket access) — dead exports, so GREEN deletes
 * them rather than re-deriving ("superseded designs leave no trace").
 *
 * A. No bare retired-or-current fee literal survives in the source text —
 *    CODE OR COMMENTS. The brief's own wording ("the file source contains no
 *    bare fee literal") makes no comment exception, and a comment is exactly
 *    where a retired number quietly survives a code fix — a rationale line
 *    can restate "used to be 5000" forever without any test ever noticing.
 *    Every amount must be a reference to business-rules, not a number typed
 *    by hand anywhere in this file, prose included.
 * B. The dead fields are gone from the export (not just re-derived), since
 *    no caller reads them.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../../config/payment-fees.js');

function fullSource() {
    return fs.readFileSync(FILE, 'utf8');
}

describe('payment-fees.js — no dead/retired fee literals', () => {
    test('A. source has no bare numeric fee literal (retired or current), including comments', () => {
        const code = fullSource();
        // 5000/25000 = retired per-scope prices; 5500/27500/5885/29425/35310 =
        // current derived totals — none of these may appear as typed-in digits,
        // in code OR in a comment; every one must come from FEES.* in
        // config/business-rules.js, or be described in prose without the digits.
        const RETIRED_OR_CURRENT_LITERAL = /\b(5000|25000|5500|27500|5885|29425|35310)\b/;
        const offendingLines = code
            .split(/\r?\n/)
            .filter((l) => RETIRED_OR_CURRENT_LITERAL.test(l));
        expect(offendingLines).toEqual([]);
    });

    test('B. PAYMENT_PHASES / RE_PAYMENT_RULES have no reader anywhere, and are gone', () => {
        const { PAYMENT_FEES } = require(FILE);
        expect(PAYMENT_FEES.PAYMENT_PHASES).toBeUndefined();
        expect(PAYMENT_FEES.RE_PAYMENT_RULES).toBeUndefined();
    });
});
