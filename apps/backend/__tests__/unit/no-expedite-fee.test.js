/**
 * M4 — there is no expedite fee. Anywhere.
 *
 * Operator ruling 2026-08-23 (verbatim): "ไม่มีค่าสมาชิก ไม่มีค่าเร่งด่วน
 * ไม่มีเคสยกเว้น vat". This suite is the machine that keeps the second clause
 * true: no constant, no published field, no frontend fallback, no wizard offer.
 *
 * Before this change the fee existed at TWO contradictory prices at once —
 *   apps/backend/config/payment-fees.js:37       URGENT_PROCESSING_FEE: 3000
 *   apps/backend/routes/api/finance/pricing.js   expediteFee: 10000  (the one served live)
 * — which is itself the reason a "carried unchanged" number is not safe to keep.
 *
 * Money-invariant note: this suite reads QUOTED numbers only. Nothing here
 * settles, mutates a ledger, or writes an invoice. Rows already issued keep
 * their numbers — none of them ever carried an expedite line (probe in the
 * report: zero invoice_line_items matching expedite/urgent, zero at 3,000 or
 * 10,000, on the live database, read-only).
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

/** Any spelling of the thing the operator abolished. */
const EXPEDITE_RE = /exped|urgent|เร่งด่วน|rush[_ ]?fee/i;

const FE_FEES_FILE = path.resolve(__dirname, '../../../web-app/src/constants/fees.ts');
const FE_PRICING_HOOK = path.resolve(__dirname, '../../../web-app/src/hooks/use-pricing.ts');
const FE_PUBLIC_FEES = path.resolve(__dirname, '../../../web-app/src/lib/pricing/public-fees.ts');
const BE_PAYMENT_FEES = path.resolve(__dirname, '../../config/payment-fees.js');
const BE_PRICING_ROUTE = path.resolve(__dirname, '../../routes/api/finance/pricing.js');
const OPENAPI_PRICING = path.resolve(__dirname, '../../../../openapi/pricing-service.yaml');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

/**
 * Identifier-level scan. Comments are stripped first so a file may still
 * EXPLAIN that the fee was removed — only live code is judged.
 */
function codeOf(file) {
    return fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .replace(/^\s*(\/\/|#).*$/gm, '')   // line comments (js/ts and yaml)
        .replace(/\s(\/\/|#).*$/gm, '');    // trailing comments
}

describe('M4-1 — the public price list offers no expedite', () => {
    test('A. GET /api/pricing/fees publishes no expedite field', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.status).toBe(200);
        const offending = Object.keys(res.body.data).filter((k) => EXPEDITE_RE.test(k));
        expect(offending).toEqual([]);
    });

    test('B. GET /api/pricing (root alias) publishes no expedite field', async () => {
        const res = await request(buildApp()).get('/api/pricing');
        expect(res.status).toBe(200);
        const offending = Object.keys(res.body.data).filter((k) => EXPEDITE_RE.test(k));
        expect(offending).toEqual([]);
    });

    test('C. no expedite price hides in a nested value either', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(EXPEDITE_RE);
    });
});

describe('M4-2 — no constant left to resurrect it', () => {
    test('D. PAYMENT_FEES has no expedite/urgent-processing entry', () => {
        const { PAYMENT_FEES } = require('../../config/payment-fees');
        const offending = Object.keys(PAYMENT_FEES).filter((k) => EXPEDITE_RE.test(k));
        expect(offending).toEqual([]);
    });

    test.each([
        ['backend  config/payment-fees.js', BE_PAYMENT_FEES],
        ['backend  routes/api/finance/pricing.js', BE_PRICING_ROUTE],
        ['frontend src/constants/fees.ts', FE_FEES_FILE],
        ['frontend src/hooks/use-pricing.ts', FE_PRICING_HOOK],
        ['frontend src/lib/pricing/public-fees.ts', FE_PUBLIC_FEES],
        ['openapi  pricing-service.yaml', OPENAPI_PRICING],
    ])('E. %s carries no expedite identifier in live code', (_label, file) => {
        const hits = codeOf(file)
            .split(/\r?\n/)
            .filter((l) => EXPEDITE_RE.test(l));
        expect(hits).toEqual([]);
    });
});

describe('M4-3 — removing it moved no other number', () => {
    test('F. the binding per-scope totals are untouched', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        const d = res.body.data;
        // 2026-09-11 — ช่องเหล่านี้เปลี่ยนความหมายจาก "ฐานค่าธรรมเนียมรัฐ" เป็น
        // "ค่าบริการก่อน VAT" ยอดที่ผู้ยื่นจ่ายจริงข้างล่างไม่ขยับ ซึ่งคือสิ่งที่เทสนี้ปกป้อง
        expect(d.applicationFee).toBe(5500);
        expect(d.inspectionFee).toBe(27500);
        expect(d.renewalFee).toBe(33000);
        expect(d.renewalTotalPerScope).toBe(35310);
        expect(d.renewalChargeCount).toBe(1);
        expect(d.phase1TotalPerScope).toBe(5885);
        expect(d.phase2TotalPerScope).toBe(29425);
        expect(d.platformRate).toBeUndefined();
        expect(d.vatRate).toBe(0.07);
        expect(d.currency).toBe('THB');
    });

    test('G. the phase breakdown config still totals 5,885 / 29,425', () => {
        const { computePhaseBreakdown } = require('../../config/payment-fees');
        expect(computePhaseBreakdown(1).total).toBe(5885);
        expect(computePhaseBreakdown(2).total).toBe(29425);
    });
});
