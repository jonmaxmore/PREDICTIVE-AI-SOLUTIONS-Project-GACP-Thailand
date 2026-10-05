'use strict';
/**
 * Guard — the old names of the one service fee may not come back as a label.
 *
 * มติ operator 2026-10-03: ค่าบริการก้อนเดียว ทุกเอกสาร/หน้าจอเรียกบรรทัดด้วยชื่อในแค็ตตาล็อก
 * (apps/backend/shared/instalment-service-names.js) เท่านั้น · ก่อนงานนี้มีราว 7 ชื่อสำหรับเงิน
 * ก้อนเดียวกัน และหน้าราคาเคยอ้างว่างวดที่ 2 รวมค่าตอบแทน ค่าเดินทาง ค่าที่พักของผู้ตรวจ
 * ซึ่งไม่จริง
 *
 * สแกนซอร์สที่ส่งถึงผู้ใช้ (apps/backend, apps/web-app/src) ไม่รวมเทสต์ · บรรทัดคอมเมนต์
 * ถูกตัดทิ้งก่อนนับ: คำอธิบายว่าทำไมชื่อเก่าถูกถอดต้องอ้างชื่อเก่าได้ (ประตูที่นับการ "พูดถึง"
 * แทนการ "ประกาศ" จะสอนให้คนลบคำอธิบาย — บทเรียนเดียวกับ ratchet dup-source)
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../../..');
// round 5: the mobile app is a user-facing surface too.
const ROOTS = ['apps/backend', 'apps/web-app/src', 'apps/mobile-app/lib'];
const SKIP_DIR = /(^|\/)(node_modules|\.next|coverage|__tests__|__mocks__|test|tests|dist|build|scripts|prisma|docs|keys|uploads|logs|generated|\.dart_tool)(\/|$)/;
const EXT = /\.(js|cjs|mjs|ts|tsx|html|dart)$/;
const SKIP_FILE = /\.(test|spec)\.(js|ts|tsx)$/;

/** The names this change retires. Each is a label some surface printed for the same charge. */
const RETIRED_VARIANTS = [
    'ค่าบริการ GACP',
    'ค่าบริการตรวจประเมินและรับรองมาตรฐาน',
    'งวดที่ 1 · ค่าตรวจเอกสาร',
    'งวดที่ 2 · ค่าตรวจประเมินพื้นที่',
    'งวดที่ 1 ค่าตรวจเอกสาร',
    'งวดที่ 2 ค่าตรวจประเมินภาคสนาม',
    'ค่าบริการตรวจสอบภาคสนาม',
    'ค่าบริการตรวจประเมินภาคสนาม',
    'ค่าตรวจเอกสาร + ค่าตรวจประเมินภาคสนาม',
    'งวดที่ 2 ค่าตรวจประเมินฟาร์ม',
    'งวดที่ 2 ค่าตรวจประเมินหน้างาน',
    'ค่าบริการตรวจสอบและประเมินคำขอเบื้องต้น',
    'ค่าบริการและภาษีมูลค่าเพิ่ม (',
    'ภาษีมูลค่าเพิ่ม 7% (ของค่าบริการ)',
    'ภาษีมูลค่าเพิ่ม 7% ของค่าบริการ',
    'การต่ออายุใบรับรอง (ชำระครั้งเดียว)',
    'ค่าตรวจเอกสาร (งวด 1)',
    'งวดที่ 1: ค่าบริการการตรวจสอบเอกสาร',
    'Document Review Service Fee',
    'Field Audit Service Fee',
    'Phase 1 — Document Review',
    'Phase 2 — Field Audit',
    // Round 2 (operator 2026-10-03, "one name per charge"): status, button and badge copy.
    // A short form may only drop the "งวดที่ N" prefix of the catalogue name, or say
    // "ชำระงวดที่ N" with no noun — never a new noun.
    'ชำระค่าตรวจ',
    'ชำระค่าประเมิน',
    'ค่าประเมินหน้างาน',
    'ค่าตรวจเอกสาร',
    'ค่าตรวจสอบเอกสาร',
    'ค่าตรวจพื้นที่',
    'ค่าตรวจประเมิน',
    'ค่าตรวจแปลง',
    'ค่าตรวจฟาร์ม',
    'ค่าตรวจสถานที่',
    'ค่าบริการตรวจเอกสาร',
    'ค่าบริการการตรวจ',
    'ค่าบริการงวดที่',
    'ค่าต่ออายุ',
    'ค่าคำขอ',
    'ค่าดำเนินการ (10%)',
    'ค่าธรรมเนียมงวดที่',
    'Document Review Fee Due',
    'Field Audit Fee Due',
    'รอชำระงวดที่ 1 (',
    'รอชำระงวดที่ 2 (',
    'งวดที่ 1 (รัฐ)',
    'งวดที่ 1 (แพลตฟอร์ม)',
    'งวดที่ 2 (รัฐ)',
    'งวดที่ 2 (แพลตฟอร์ม)',
    'รวมค่าธรรมเนียมภาครัฐ',
    'รวมค่าบริการแพลตฟอร์ม',
    'ค่าบริการแพลตฟอร์ม (',
    // round 5: the checkout invoice card's title — not a catalogue name
    'ค่าบริการรับรอง\'',
    // round 5: mobile — the retired two-quotation screen's words
    'ค่าธรรมเนียมรัฐ (DTAM)',
    'ค่าบริการแพลตฟอร์ม ·',
    '(รัฐ + แพลตฟอร์ม)',
    'ชำระค่าธรรมเนียมงวดที่',
];

/** The fee covers none of these (Phase 2 ruling, 2026-10-03). */
const NOT_COVERED = /ค่าเดินทาง|ค่าที่พัก|ค่าตอบแทนคณะผู้ตรวจ|ค่าพาหนะ|Travel Expense/;
// payment-terms v1.2 §2.6 (operator 2026-10-03) states the OPPOSITE claim, verbatim:
// "... และไม่รวมค่าเดินทาง ค่าที่พัก หรือค่าตอบแทนของผู้ตรวจ". That one sentence, read
// from the published document so nothing else can borrow the exemption, is removed
// from a line before the scan; any other mention of these costs still fails.
const TERMS_V12_ONE_FEE = (() => {
    const doc = fs.readFileSync(path.join(REPO, 'docs/legal/payment-terms-th-v1.2.md'), 'utf8');
    const m = doc.match(/^2\.6 (.+)$/m);
    if (!m || !NOT_COVERED.test(m[1]) || !/ไม่รวม/.test(m[1])) {
        throw new Error('payment-terms v1.2 §2.6 no longer reads as the "not included" sentence; update this exemption');
    }
    return m[1].trim();
})();

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO, full);
        if (entry.isDirectory()) {
            if (!SKIP_DIR.test(rel)) { walk(full, out); }
        } else if (EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Source with comments removed: `// …` lines and trailing `// …`, and block comments
 * that open at the start of a line (`/*`, `{/*`) through their `*\/`. Also skips
 * `oldSystemRef:` rows (status-mapping.ts) — the retired system's step names, which no
 * screen renders (grep: no reader outside the file).
 */
function codeLines(text) {
    const out = [];
    let inBlock = false;
    text.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (inBlock) {
            if (t.includes('*/')) { inBlock = false; }
            return;
        }
        if (t.startsWith('/*') || t.startsWith('{/*')) {
            if (!t.includes('*/')) { inBlock = true; }
            return;
        }
        if (t.startsWith('//') || t.startsWith('*') || /^oldSystemRef:/.test(t)) { return; }
        out.push({ n: i + 1, line: line.replace(/(^|\s)\/\/(?!\/).*$/, '') });
    });
    return out;
}

const FILES = ROOTS.flatMap((r) => walk(path.join(REPO, r), []));

describe('retired fee-line names', () => {
    test('the scan sees the surfaces it guards', () => {
        const rels = FILES.map((f) => path.relative(REPO, f));
        expect(rels).toContain('apps/backend/services/pdf/invoice-template-service.js');
        expect(rels).toContain('apps/web-app/src/app/(marketing)/pricing/page.tsx');
        expect(rels).toContain('apps/web-app/src/components/payments/QuotationReviewSection.tsx');
        expect(rels).toContain('apps/mobile-app/lib/presentation/features/application/screens/payment_screen.dart');
    });

    test('no user-facing source uses a retired variant as a label', () => {
        const hits = [];
        for (const file of FILES) {
            const rel = path.relative(REPO, file);
            for (const { n, line } of codeLines(fs.readFileSync(file, 'utf8'))) {
                for (const v of RETIRED_VARIANTS) {
                    if (line.includes(v)) { hits.push(`${rel}:${n}  «${v}»`); }
                }
            }
        }
        expect(hits).toEqual([]);
    });

    test('no user-facing source says the fee covers inspector travel, lodging or honoraria', () => {
        const hits = [];
        for (const file of FILES) {
            const rel = path.relative(REPO, file);
            for (const { n, line } of codeLines(fs.readFileSync(file, 'utf8'))) {
                if (NOT_COVERED.test(line.split(TERMS_V12_ONE_FEE).join(''))) { hits.push(`${rel}:${n}`); }
            }
        }
        expect(hits).toEqual([]);
    });
});
