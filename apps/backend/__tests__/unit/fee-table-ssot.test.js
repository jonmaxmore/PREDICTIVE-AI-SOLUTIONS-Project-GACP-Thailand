/**
 * W11-3 (backlog 05-BACKLOG.md §2 B-MONEY-SMALL, top-5 item 4) — one fee table.
 *
 * Skill gacp-payment-invariants, "กับดัก" row 2: the repo already has THREE
 * fee-definition sites (`config/payment-fees.js`, `config/business-rules.js`,
 * `modules/billing/internal/fee-service.js`) and the probe domain `fee-table`
 * (`scripts/probes/ssot-domains.txt:20`) exists so nobody adds a fourth.
 *
 * Two guards, both value-preserving:
 *
 *  A. NO FOURTH TABLE — no file outside the canonical set may define a
 *     GACP service-fee table. On main @94ac46ac this is RED:
 *     `constants/service-type-enum.js:24-36` defines FIXED_FEES with
 *     fieldInspection 30000 / total 35000 — numbers that CONTRADICT the
 *     canonical 25,000 / 33,210 — and no file in the repo imports it.
 *
 *  B. VALUES PINNED — the exact numbers the public pricing route serves.
 *     This test is GREEN before and after the de-duplication refactor; that
 *     is the proof the refactor changed no money number. It must never be
 *     "updated to match" — a diff here means the quote to the applicant moved.
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '../..');

// The only files allowed to hold a GACP fee table, per ssot-domains.txt.
const CANONICAL_FEE_SOURCES = [
    'config/payment-fees.js',
    'config/business-rules.js',
    'modules/billing/internal/fee-service.js',
];

const SEARCH_DIRS = ['config', 'constants', 'services', 'routes', 'modules', 'jobs', 'shared', 'utils', 'middleware'];

function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') {continue;}
            walk(full, out);
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

// A "fee table" = an object literal that assigns a GACP fee amount to a
// fee-shaped key. Deliberately narrow so prose/comments and unrelated 5000s
// (string-length caps, timeouts) do not trip it.
const FEE_TABLE_PATTERN =
    /(docReview|fieldInspection|applicationFee|inspectionFee|DOCUMENT_REVIEW_FEE|FIELD_AUDIT_FEE|PHASE1_PER_SCOPE|PHASE2_PER_SCOPE)\s*[:=]\s*\d{4,6}\b/;

describe('W11-3A — no fourth GACP fee table', () => {
    test('every fee-table definition lives in a canonical source file', () => {
        const offenders = [];
        for (const dirName of SEARCH_DIRS) {
            for (const file of walk(path.join(BACKEND_ROOT, dirName))) {
                const rel = path.relative(BACKEND_ROOT, file).split(path.sep).join('/');
                if (CANONICAL_FEE_SOURCES.includes(rel)) {continue;}
                const lines = fs.readFileSync(file, 'utf8').split('\n');
                lines.forEach((line, i) => {
                    if (line.trim().startsWith('//') || line.trim().startsWith('*')) {return;}
                    if (FEE_TABLE_PATTERN.test(line)) {
                        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
                    }
                });
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('W11-3B — ตัวเลขที่ตรึงไว้ (ต้องเท่าเดิมก่อนและหลังการรวมแหล่ง)', () => {
    const { FEE_RATES, VAT_RATE } = require('../../modules/billing');
    const pricing = require('../../routes/api/finance/pricing');

    /**
     * ── 2026-09-11: ความหมายของช่องเปลี่ยน ยอดที่เก็บไม่เปลี่ยน ──
     * operator สั่งเลิกแยกค่าธรรมเนียมรัฐกับค่าบริการ ⇒ อัตราที่ประกาศ **คือค่าบริการเอง**
     * 5,000 → 5,500 และ 25,000 → 27,500 ไม่ใช่การขึ้นราคา: เดิมบวกแพลตฟอร์ม 10%
     * ต่อท้ายเพื่อให้ได้ตัวเลขเดียวกัน · **ยอดที่ผู้ยื่นจ่ายคือ 35,310 เท่าเดิมทุกบาท**
     * ซึ่งเป็นบรรทัดที่ไฟล์นี้มีไว้ปกป้องจริง ๆ และมันไม่ขยับ
     */
    test('อัตราของตัวคำนวณกลาง — ค่าบริการต่อหนึ่งรูปแบบ', () => {
        expect(FEE_RATES.PHASE1_PER_SCOPE).toBe(5500);
        expect(FEE_RATES.PHASE2_PER_SCOPE).toBe(27500);
        expect(VAT_RATE).toBe(0.07);
    });

    test('ไม่มีอัตราแพลตฟอร์มเหลือให้ใครหยิบไปคูณ', () => {
        expect(require('../../modules/billing').PLATFORM_RATE).toBeUndefined();
        expect(FEE_RATES.PLATFORM_RATE).toBeUndefined();
    });

    test('ตัวช่วยยอดก่อน VAT ของ /pricing', () => {
        expect(pricing.computePricing({ areaCount: 1 })).toEqual({
            phase1Total: 5500, phase2Total: 27500, total: 33000,
        });
        expect(pricing.computePricing({ areaCount: 3 })).toEqual({
            phase1Total: 16500, phase2Total: 82500, total: 99000,
        });
        expect(pricing.computePricing({ areaCount: 2, includeInspection: false })).toEqual({
            phase1Total: 11000, phase2Total: 0, total: 11000,
        });
    });

    test('ยอดเต็มของ /pricing — หนึ่งค่าบริการต่องวด', () => {
        const e = pricing.buildEstimateBreakdown({ areaCount: 1, includeInspection: true });
        expect(e.breakdown.phase1).toEqual({
            serviceFeeAmount: 5500, vatAmount: 385, phaseTotal: 5885,
        });
        expect(e.breakdown.phase2).toEqual({
            serviceFeeAmount: 27500, vatAmount: 1925, phaseTotal: 29425,
        });
        // บรรทัดที่ห้ามขยับ
        expect(e.total).toBe(35310);
    });
});
