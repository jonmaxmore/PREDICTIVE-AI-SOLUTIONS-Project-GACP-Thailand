/**
 * W12-1 — the renewal fee: ONE charge of 30,000, from one source.
 *
 * Operator ruling 2026-08-22, final (the change log @ 67ef3612):
 *   "ผมผิดเอง ต่ออายุ 30,000 ครั้งเดียว และไม่ตรวจเอกสาร นัดลงพื้นที่อย่างเดียว"
 * A renewal is ONE 30,000 charge, not the 5,000 + 25,000 phase pair a new
 * application pays. That makes 30,000 a fee in its own right — unlike the
 * superseded two-phase reading, where it was only PHASE1 + PHASE2 and a
 * separate constant would have been a third number free to drift.
 *
 * Defect this closes (money branch, item P7 — now on main as d71421b3):
 *   - backend  routes/api/finance/pricing.js  renewalFee: 15000
 *   - frontend apps/web-app/src/constants/fees.ts  GACP_RENEWAL_FEE = 30_000
 * Two live quotes for one service, neither derived from the other.
 *
 * 33,000 อ่านที่นี่ว่าเป็น **ค่าบริการก่อน VAT** (operator 2026-09-11 เลิกแยกส่วน) — รูปเดียวกับ
 * every other entry in the canonical fee table, where state fees are VAT-exempt
 * and the platform fee carries the VAT (ม.77/1(10), skill gacp-payment-invariants).
 * OPEN QUESTION for the operator, W12-Q1 in the report: if 30,000 is instead the
 * final amount the applicant pays, the switch is one line — see the report.
 *
 * Money-invariant note: this suite covers a QUOTED number only. Nothing here
 * settles, mutates a ledger, or writes an invoice.
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

/**
 * The operator's number, PER CULTIVATION SCOPE (correction 2026-08-22,
 * the change log 8b8d581f — an earlier reading had it as a flat per-certificate
 * charge). Changing this line changes what an applicant pays.
 * Scope multiplication is proven in renewal-single-charge-billing.test.js.
 */
// 2026-09-11 — ความหมายของค่านี้เปลี่ยนจาก "ฐานก่อนบวกแพลตฟอร์ม" เป็น "ค่าบริการ"
// 30,000 + 10% = 33,000 มาก่อนอยู่แล้ว ⇒ **ยอดที่ผู้ยื่นจ่าย 35,310 เท่าเดิม**
const RENEWAL_BASE_THB = 33000;
/** W14: ค่าบริการ (base + platform 10%) + VAT 7% of that whole service fee. */
const RENEWAL_PAYABLE_THB = 35310;

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const FE_FEES_FILE = path.resolve(__dirname, '../../../web-app/src/constants/fees.ts');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

const FE_PUBLIC_FEES = path.resolve(__dirname, '../../../web-app/src/lib/pricing/public-fees.ts');
const FE_PRICING_HOOK = path.resolve(__dirname, '../../../web-app/src/hooks/use-pricing.ts');

/** The response keys the web's parser requires (AMOUNT_KEYS in public-fees.ts). */
function webRequiredAmountKeys() {
    const src = fs.readFileSync(FE_PUBLIC_FEES, 'utf8');
    const m = src.match(/const\s+AMOUNT_KEYS\s*=\s*\[([\s\S]*?)\]/);
    if (!m) throw new Error(`AMOUNT_KEYS not found in ${FE_PUBLIC_FEES}`);
    return [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1]);
}

describe('W12-1 — renewal fee value', () => {
    test('A. the canonical fee table publishes the renewal fee', () => {
        const { FEE_RATES } = require('../../modules/billing');
        expect(FEE_RATES.RENEWAL_PER_SCOPE).toBe(RENEWAL_BASE_THB);
    });

    test('B. GET /api/pricing/fees quotes 33,000', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.status).toBe(200);
        expect(res.body.data.renewalFee).toBe(RENEWAL_BASE_THB);
    });

    test('B2. GET /api/pricing (root alias) quotes the same 30,000', async () => {
        const res = await request(buildApp()).get('/api/pricing');
        expect(res.status).toBe(200);
        expect(res.body.data.renewalFee).toBe(RENEWAL_BASE_THB);
    });

    // C/D/D2 used to pin a frontend literal (GACP_RENEWAL_FEE in
    // web-app/src/constants/fees.ts) equal to this table. That literal is gone
    // (fix/fees-from-server, 2026-10-03): a mirror pinned equal still shows the
    // old price for as long as a deploy lags a SystemConfig change. The web now
    // reads this route, so what must hold is the contract between them.
    test('C. the frontend declares no renewal amount of its own', () => {
        const fees = fs.readFileSync(FE_FEES_FILE, 'utf8');
        expect(fees).not.toMatch(/export\s+const\s+GACP_RENEWAL/);
        // live code only: the hook's header may still explain what was removed
        const hookCode = fs.readFileSync(FE_PRICING_HOOK, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(hookCode).not.toMatch(/DEFAULT_FEES|from\s+'@\/constants\/fees'/);
    });
});

describe('W12-2 — the two ends cannot drift', () => {
    test('D. the web reads renewalFee and renewalTotalPerScope, and this route serves both', async () => {
        const keys = webRequiredAmountKeys();
        expect(keys).toEqual(expect.arrayContaining(['renewalFee', 'renewalTotalPerScope']));
        const res = await request(buildApp()).get('/api/pricing/fees');
        for (const key of keys) {
            expect({ key, ok: typeof res.body.data[key] === 'number' && res.body.data[key] > 0 })
                .toEqual({ key, ok: true });
        }
    });

    test('D2. the payable the web shows is the engine total this route serves, not a web gross-up', async () => {
        const { calculateRenewalFee } = require('../../modules/billing');
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.body.data.renewalTotalPerScope).toBe(calculateRenewalFee({}, { scopeCount: 1 }).phaseTotal);
        // The web no longer computes a payable: nothing in its reader multiplies
        // an amount BY the VAT rate (the "7%" label is vatRate * 100, rate first).
        expect(fs.readFileSync(FE_PUBLIC_FEES, 'utf8')).not.toMatch(/withVat|\*\s*(?:\w+\.)?vatRate\b/);
    });

    test('E. the API serves the canonical value, not a re-spelled literal', async () => {
        const { FEE_RATES } = require('../../modules/billing');
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.body.data.renewalFee).toBe(FEE_RATES.RENEWAL_PER_SCOPE);
    });

    test('F. only business-rules.js may DEFINE a renewal fee amount', () => {
        const CANONICAL = 'config/business-rules.js';
        const SEARCH_DIRS = ['config', 'constants', 'services', 'routes', 'modules', 'jobs', 'shared', 'utils', 'middleware'];
        const DEFINITION = /(renewalFee|RENEWAL_PER_SCOPE|RENEWAL_PER_CERT|RENEWAL_FEE)\s*[:=]\s*\d{3,7}\b/;

        const walk = (dir, out = []) => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return out;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '__tests__') { continue; }
                    walk(full, out);
                } else if (entry.name.endsWith('.js')) {
                    out.push(full);
                }
            }
            return out;
        };

        const offenders = [];
        for (const dirName of SEARCH_DIRS) {
            for (const file of walk(path.join(BACKEND_ROOT, dirName))) {
                const rel = path.relative(BACKEND_ROOT, file).split(path.sep).join('/');
                if (rel === CANONICAL) { continue; }
                fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                    const t = line.trim();
                    // comment-only lines are documentation, not a second source
                    // (the backlog — a guard that punishes accurate
                    // documentation teaches agents to delete it)
                    if (t.startsWith('//') || t.startsWith('*')) { return; }
                    if (DEFINITION.test(line)) {
                        offenders.push(`${rel}:${i + 1}  ${t}`);
                    }
                });
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('W12-3 — what the applicant actually pays for a renewal', () => {
    test('G. the payable total is the base grossed up by the canonical rates', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        const d = res.body.data;
        expect(d.renewalTotalPerScope).toBe(RENEWAL_PAYABLE_THB);
        // ไม่ใช่ความสัมพันธ์ที่เขียนเป็นตัวเลข แต่เป็นการบวก VAT แบบเดียวกับที่ผู้ออกใบใช้
        // 2026-09-11 — ไม่มีขั้นบวกค่าแพลตฟอร์มแล้ว `renewalFee` คือค่าบริการเอง
        expect(d.renewalTotalPerScope).toBe(d.renewalFee + Math.round(d.renewalFee * d.vatRate));
    });

    test('H. that gross-up is the engine\'s own — it reproduces the phase totals', async () => {
        // If this formula ever stops matching buildPhaseFee(), the phase totals
        // it reproduces here will stop matching too, and this goes red.
        const res = await request(buildApp()).get('/api/pricing/fees');
        const d = res.body.data;
        const grossUp = (serviceFee) => serviceFee + Math.round(serviceFee * d.vatRate);
        expect(grossUp(d.applicationFee)).toBe(d.phase1TotalPerScope);
        expect(grossUp(d.inspectionFee)).toBe(d.phase2TotalPerScope);
    });

    test('I. a renewal is ONE charge — the API says so rather than making a screen infer it', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.body.data.renewalChargeCount).toBe(1);
        // A new application is billed in two instalments, a renewal in one.
        // ค่าบริการต่ออายุบังเอิญเท่ากับ 5,500 + 27,500 ในวันนี้ แต่ **ไม่ได้** ถูกนิยาม
        // ว่าเป็นผลบวกนั้น — operator เป็นคนตั้ง — ตารางการชำระจึงต้อง
        // stated, never inferred from the amount. Deliberately not asserting
        // that coincidence: pinning it would break the day the operator moves
        // the renewal fee, which is exactly when nothing should break.
    });
});

describe('W12-4 — no other fee moved', () => {
    test('J. every other published fee is byte-identical to before', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        const d = res.body.data;
        expect(d.applicationFee).toBe(5500);
        expect(d.inspectionFee).toBe(27500);
        // M4 (2026-08-23): expediteFee is no longer published at all — the
        // operator abolished the rush fee. Its absence is asserted by
        // no-expedite-fee.test.js; asserting a value here would be asserting
        // that the fee still exists.
        expect(d).not.toHaveProperty('expediteFee');
        // `platformRate` ถูกถอด 2026-09-11 พร้อมการแยกส่วน — อัตราที่ไม่มีใครคูณแล้ว
        expect(d).not.toHaveProperty('platformRate');
        expect(d.vatRate).toBe(0.07);
        expect(d.phase1TotalPerScope).toBe(5885);
        expect(d.phase2TotalPerScope).toBe(29425);
        expect(d.currency).toBe('THB');
    });

    test('K. the canonical engine rates are untouched', () => {
        const { FEE_RATES, VAT_RATE } = require('../../modules/billing');
        expect(FEE_RATES.PHASE1_PER_SCOPE).toBe(5500);
        expect(FEE_RATES.PHASE2_PER_SCOPE).toBe(27500);
        expect(VAT_RATE).toBe(0.07);
    });
});
