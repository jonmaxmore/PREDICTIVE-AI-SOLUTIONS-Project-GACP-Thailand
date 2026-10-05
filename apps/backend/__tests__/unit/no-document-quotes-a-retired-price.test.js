/**
 * No document may quote a retired price without saying that it is retired.
 *
 * Operator, 2026-09-05: "รายงานเก่าที่ผิดพลาดให้เคลียร์ และคลีน ให้ไม่กระทบต่อการทำงาน
 * ปัจจุบันและอนาคต."
 *
 * ── WHAT WAS FOUND ────────────────────────────────────────────────────────────
 * 5,535 / 27,675 / 33,210 are the W11 figures — VAT charged on the platform fee
 * alone. W14 (operator 2026-08-22) put VAT on the whole ค่าบริการ and the platform
 * has charged 5,885 / 29,425 / 35,310 ever since. Four months later those old
 * numbers were still printed in 28 files, including:
 *
 *   docs/contract/farmer-manual/…      the manual a FARMER reads — so they
 *                                       budgeted 33,210 and were invoiced 35,310
 *   docs/contract/manual/…             the deliverable for contract C05F680149
 *   docs/qa/smoke-test-runbook…        the steps a tester follows, which would
 *                                       have them report the SYSTEM as wrong
 *   docs/customer-success/…            what support tells a caller
 *
 *   (docs/contract, docs/customer-success were removed from the tree 2026-10-05; see git history)
 * ── THE RULE THIS PINS ────────────────────────────────────────────────────────
 * A dated record may keep its old numbers — rewriting history is worse than
 * stale history — but it must carry a banner saying so. Anything else must quote
 * the price the platform charges. Both halves are checked here, so the next
 * price change cannot leave the same trail behind it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { FEES } = require('../../config/business-rules');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const DOCS = path.join(REPO, 'docs');

/** Marks a file as a historical record rather than current guidance. */
const SUPERSEDED = ['เลิกใช้แล้ว', 'ต่ำกว่ายอดที่เรียกเก็บจริง', 'superseded'];

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, out); } else if (entry.name.endsWith('.md')) { out.push(full); }
    }
    return out;
}

// ค่าที่อัตราประกาศไว้ **คือค่าบริการ** ตั้งแต่ 2026-09-11 — ไม่มีขั้นบวกค่าแพลตฟอร์ม
function phaseTotal(serviceFeePerScope) {
    return serviceFeePerScope + Math.round(serviceFeePerScope * FEES.VAT_RATE);
}

describe('every document either quotes the real price or says it is out of date', () => {
    const RETIRED = ['5,535', '27,675', '33,210'];
    const files = walk(DOCS);

    test('the corpus is actually being read — a passing test over zero files proves nothing', () => {
        expect(files.length).toBeGreaterThan(50);
    });

    test('no file quotes a retired total without either a banner or the real one beside it', () => {
        const current = [
            phaseTotal(FEES.PHASE1_PER_SCOPE),
            phaseTotal(FEES.PHASE2_PER_SCOPE),
            phaseTotal(FEES.PHASE1_PER_SCOPE) + phaseTotal(FEES.PHASE2_PER_SCOPE),
        ].map((n) => n.toLocaleString('en-US'));

        const offenders = files.filter((f) => {
            const src = fs.readFileSync(f, 'utf8');
            if (!RETIRED.some((n) => src.includes(n))) { return false; }

            // (a) A dated record carries a banner near the top, where a reader
            //     meets it before the numbers. A note buried at the end is not a
            //     warning.
            if (SUPERSEDED.some((mark) => src.slice(0, 1500).includes(mark))) { return false; }

            // (b) Or, for every retired figure it prints, it prints the figure
            //     that replaced it. That is what a document explaining a change
            //     necessarily does, and it is checked PAIRWISE — a runbook that
            //     lists the two phase totals should not have to mention the grand
            //     total to satisfy this. The rule is not "never write the old
            //     number"; it is "never leave a reader holding only the old one".
            const unpaired = RETIRED
                .map((retired, i) => ({ retired, replacement: current[i] }))
                .filter(({ retired, replacement }) => src.includes(retired) && !src.includes(replacement));
            if (unpaired.length === 0) { return false; }

            return true;
        }).map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });

    test('the documents a customer or a tester acts on quote the CURRENT total', () => {
        const p1 = phaseTotal(FEES.PHASE1_PER_SCOPE);
        const p2 = phaseTotal(FEES.PHASE2_PER_SCOPE);
        const live = [
            'qa/smoke-test-runbook-2026-05-16.md',
        ];
        for (const rel of live) {
            const src = fs.readFileSync(path.join(DOCS, rel), 'utf8');
            expect({ rel, hasP1: src.includes(p1.toLocaleString('en-US')) })
                .toEqual({ rel, hasP1: true });
            expect({ rel, hasP2: src.includes(p2.toLocaleString('en-US')) })
                .toEqual({ rel, hasP2: true });
        }
    });

    test('no LIVE document still claims the state fee is VAT-exempt', () => {
        // The exemption was real under the two-money-flow model and is not the
        // current position. A dated record may say it happened; a manual may not
        // say it is so.
        const live = files.filter((f) => {
            const rel = path.relative(DOCS, f);
            return rel.startsWith('legal/');
        });
        const offenders = live.filter((f) => {
            const src = fs.readFileSync(f, 'utf8');
            return src.includes('ยกเว้นภาษีมูลค่าเพิ่ม')
                && !SUPERSEDED.some((mark) => src.slice(0, 1500).includes(mark));
        }).map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });
});
