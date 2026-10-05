'use strict';
/**
 * generateQuotationPdf renders the STORED quotation row (F-G4-64, spec 3.2).
 *
 * Fix round 1 (reviewer F4/F5). Two defects lived here at once:
 *   - F5: the per-scope figure was `isStateSide ? state : platform + vat`,
 *     a pre-W14 rule. Under W14 the single PLATFORM row carries the WHOLE
 *     phase, so the applicant's PDF printed 885 per scope where the row, the
 *     API line items and the card footer all said 5,885. Coordinator ruling
 *     2026-08-28: render the row. Global Constraint 2 governs what is CHARGED
 *     (the fee service still computes that), not how a stored row is printed.
 *   - F4: a renewal quotation prices PHASE_2 only, and ?phase=1 emitted a
 *     numbered money document with a total of 0.00 THB. It now refuses with
 *     the catalogued QUOTATION_PHASE_NOT_PRICED.
 *
 * A pre-W14 row still prints its own per-side money, because that is what
 * `amount` holds on those rows: state for the DTAM document, platform + VAT
 * for the PLATFORM one.
 *
 * The PDF engine is mocked (no Puppeteer); the rendered HTML is captured.
 */

const mockCapture = { html: '' };

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    readTemplateCached: () => 'DOC=[[{{DOC_NUMBER}}]] ITEMS={{ITEMS_ROWS}} TOTAL=[[{{GRAND_TOTAL}}]]',
    replaceTemplateVariables: (tpl, data) =>
        tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(data[k] === undefined ? '' : data[k])),
    generatePDF: async (html) => { mockCapture.html = html; return Buffer.from('PDF'); },
}));

const tpl = require('../../services/pdf/invoice-template-service');
const { getMessage, lookup } = require('../../shared/error-codes');

/** 3 cultivation methods → the LIVE formula prices PHASE_1 state at 15,000. */
const application = {
    id: 'app-1',
    applicationNumber: 'GACP-TH-2569-000123',
    totalAreaTypes: 3,
    formData: { cultivationMethods: ['INDOOR', 'GREENHOUSE', 'OUTDOOR'], farmName: 'ฟาร์มตัวอย่าง' },
};

/** The W14 single-issuer row: ONE document, the whole phase on it. */
const W14_PLATFORM_ROW = {
    quotationNumber: 'QT-PRD-2026-000001',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    totalAmount: '105930.00',
    installments: [
        { phase: 'PHASE_1', amount: 17655, serviceFeeAmount: 16500, vatAmount: 1155, scopeCount: 3 },
        { phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3 },
    ],
    acceptedSnapshot: null,
};

function frozen(row) {
    return {
        ...row,
        status: 'ACCEPTED',
        acceptedSnapshot: {
            quotationNumber: row.quotationNumber,
            issuerType: row.issuerType,
            scopeCount: row.installments[0].scopeCount,
            totalAmount: row.totalAmount,
            // Mirrors buildAcceptanceSnapshot exactly. It froze
            // stateAmount/platformAmount until 2026-09-11; the rows no longer
            // carry them, so this helper was producing NaN money fields — and
            // NaN does not fail loudly here, it makes the renderer decide the
            // row does not price the whole phase and fall back to the legacy
            // per-side caption. A stale fixture silently selecting the wrong
            // branch is worth more comment than the two lines it replaced.
            installments: row.installments.map((it) => ({
                phase: it.phase,
                amount: Number(it.amount).toFixed(2),
                serviceFeeAmount: Number(it.serviceFeeAmount).toFixed(2),
                vatAmount: Number(it.vatAmount).toFixed(2),
                phaseTotal: (it.serviceFeeAmount + it.vatAmount).toFixed(2),
            })),
        },
    };
}

const rowCount = (html) => (html.match(/<tr>/g) || []).length;

beforeEach(() => { mockCapture.html = ''; });

describe('the PLATFORM document under one issuer (F5)', () => {
    it('prints the accepted row: 17,655 for three scopes', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(W14_PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('TOTAL=[[17,655.00]]');
        // The retired per-side split: platform 1,500 + VAT 1,155 = 2,655.
        expect(mockCapture.html).not.toContain('TOTAL=[[2,655.00]]');
    });

    it('prints the row BEFORE acceptance too, from the installments (no snapshot yet)', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: W14_PLATFORM_ROW,
        });
        expect(mockCapture.html).toContain('TOTAL=[[17,655.00]]');
    });

    it('phase 2 of the same row prints the phase-2 figure', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 2, quotationRow: frozen(W14_PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('TOTAL=[[88,275.00]]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// operator 2026-09-07 — the applicant's document splits by SERVICE, not by the
// seller's accounting components:
//
//   *"ไม่ต้อง เราแยกตามบริการ เช่น ค่าบริการตรวจสอบเอกสาร สำหรับขออนุญาต
//     รูปแบบการปลูกแบบกลางแจ้ง … เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง"*
//
// This supersedes the C2/C7/C14 shape asserted here before, which printed
// ค่าธรรมเนียมกรม / ค่าบริการแพลตฟอร์ม / ภาษีมูลค่าเพิ่ม per scope — 9 rows for a
// 3-type filing. That split answered a real problem (a caption claiming 5,885
// was platform fee + VAT when 5,000 of it is the state fee) but answered it by
// showing the applicant the internal ledger. Naming the service answers it
// without: the line no longer claims to be any particular component, because it
// is the whole price of one service for one cultivation type.
//
// The VAT separation that law requires lives on the tax documents, which have
// their own builders and are untouched.
// ─────────────────────────────────────────────────────────────────────────────
describe('a W14 whole-phase row prints one line per service, per type', () => {
    const P1_SERVICE = 'ค่าบริการตรวจสอบเอกสาร';
    const P2_SERVICE = 'ค่าบริการตรวจประเมินแปลงและออกใบรับรอง';

    it('three cultivation types give three lines, not nine', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(W14_PLATFORM_ROW),
        });

        expect(rowCount(mockCapture.html)).toBe(3);
        expect((mockCapture.html.match(new RegExp(P1_SERVICE, 'g')) || []).length).toBe(3);
    });

    it('no line shows the applicant an accounting component any more', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(W14_PLATFORM_ROW),
        });

        expect(mockCapture.html).not.toContain('ค่าธรรมเนียมกรม');
        expect(mockCapture.html).not.toContain('ค่าบริการแพลตฟอร์ม (');
        expect(mockCapture.html).not.toContain('ภาษีมูลค่าเพิ่ม 7%');
        // และคำบรรยายเดิมที่อ้างว่า 5,885 คือค่าแพลตฟอร์ม+VAT ก็ยังต้องไม่กลับมา
        expect(mockCapture.html).not.toContain('ค่าบริการแพลตฟอร์มและภาษีมูลค่าเพิ่ม');
    });

    it('each line carries that type`s whole payable, and they sum to the phase total', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(W14_PLATFORM_ROW),
        });

        // 17,655 ÷ 3 รูปแบบ = 5,885 ต่อบรรทัด
        expect((mockCapture.html.match(/5,885\.00/g) || []).length).toBeGreaterThanOrEqual(3);
        expect(mockCapture.html).toContain('TOTAL=[[17,655.00]]');
    });

    it('a single-scope row prints exactly one line, equal to the phase total', async () => {
        await tpl.generateQuotationPdf({
            application: oneMethodApplication,
            issuerSide: 'PLATFORM',
            phase: 1,
            quotationRow: frozen(ONE_SCOPE_PLATFORM_ROW),
        });

        expect(rowCount(mockCapture.html)).toBe(1);
        expect(mockCapture.html).toContain(P1_SERVICE);
        expect(mockCapture.html).toContain('TOTAL=[[5,885.00]]');
    });

    it('phase 2 names its own service, never phase 1`s', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 2, quotationRow: frozen(W14_PLATFORM_ROW),
        });

        expect(mockCapture.html).toContain(P2_SERVICE);
        expect(mockCapture.html).not.toContain(P1_SERVICE);
        expect(mockCapture.html).toContain('TOTAL=[[88,275.00]]');
    });

    it('every line says what the money is for and which type', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(W14_PLATFORM_ROW),
        });

        expect(mockCapture.html).toContain('สำหรับขออนุญาต');
        expect(mockCapture.html).toContain('รูปแบบการปลูกแบบ');
    });

    it('the row before acceptance prints the same service lines', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: W14_PLATFORM_ROW,
        });

        expect(rowCount(mockCapture.html)).toBe(3);
        expect(mockCapture.html).toContain(P1_SERVICE);
        expect(mockCapture.html).toContain('TOTAL=[[17,655.00]]');
    });
});

describe('a pre-W14 pair keeps its per-side figures', () => {
    const DTAM_ROW = {
        quotationNumber: 'QT-DTAM-2026-000007',
        issuerType: 'DTAM',
        totalAmount: '90000.00',
        installments: [
            { phase: 'PHASE_1', amount: 15000, serviceFeeAmount: 16500, vatAmount: 105, scopeCount: 3 },
            { phase: 'PHASE_2', amount: 75000, serviceFeeAmount: 82500, vatAmount: 525, scopeCount: 3 },
        ],
    };
    const PLATFORM_ROW = {
        ...DTAM_ROW,
        quotationNumber: 'QT-PRD-2026-000007',
        issuerType: 'PLATFORM',
        totalAmount: '9630.00',
        installments: [
            { phase: 'PHASE_1', amount: 1605, serviceFeeAmount: 16500, vatAmount: 105, scopeCount: 3 },
            { phase: 'PHASE_2', amount: 8025, serviceFeeAmount: 82500, vatAmount: 525, scopeCount: 3 },
        ],
    };

    it('the ministry-side document is refused outright, not printed', async () => {
        // It used to render the state fee per scope (15,000). operator
        // 2026-09-11 retired the second issuer, so the renderer refuses any
        // issuerSide but PLATFORM — a STRICTER rule than the W14 time boundary
        // it replaced, which let a pre-ruling row still print. The legacy row
        // keeps its stored figures in the table; what is gone is the document.
        await expect(tpl.generateQuotationPdf({
            application, issuerSide: 'DTAM', phase: 1, quotationRow: frozen(DTAM_ROW),
        })).rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
        expect(mockCapture.html).toBe('');
    });

    it('the platform document prints the platform fee + VAT per scope', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('TOTAL=[[1,605.00]]');
    });

    it('and keeps its per-side captions: one line per scope, naming that side`s money', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: frozen(PLATFORM_ROW),
        });
        // 1,605 is this row's own money — its ค่าบริการ + VAT do not add up to
        // it, so the renderer knows the row does not price the whole phase and
        // keeps the per-side line. The caption dropped the word "แพลตฟอร์ม"
        // on 2026-09-11: with no second side to contrast against, "the platform
        // fee" named a distinction that no longer exists.
        // fix/fee-line-descriptions (operator 2026-10-03): named from the one catalogue
        // like every other line; the amount (1,605) is untouched.
        expect(mockCapture.html).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
        expect(mockCapture.html).not.toContain('ค่าบริการและภาษีมูลค่าเพิ่ม (');
        expect(mockCapture.html).not.toContain('ค่าบริการแพลตฟอร์ม');
        expect(rowCount(mockCapture.html)).toBe(3);
        expect(mockCapture.html).not.toContain('ค่าธรรมเนียมกรม (ตรวจประเมิน)');
    });

    it('and there is no ministry caption left to print', async () => {
        // The ministry line read 'ค่าตรวจสอบและประเมินคำขอการรับรองมาตรฐานเบื้องต้น'.
        // The refusal above means no code path can emit it; this pins that the
        // wording is gone from the builder too, so it cannot return by accident.
        const svc = require('fs').readFileSync(
            require('path').resolve(__dirname, '../../services/pdf/invoice-template-service.js'), 'utf8',
        );
        expect(svc).not.toContain('ค่าตรวจสอบและประเมินคำขอการรับรองมาตรฐานเบื้องต้น');
    });
});

describe('the row is the document, and nothing recomputes', () => {
    /** A row accepted under a RETIRED rate: 4,000/scope where today's is 5,000. */
    const RETIRED_RATE_ROW = frozen({
        quotationNumber: 'QT-PRD-2026-000009',
        issuerType: 'PLATFORM',
        totalAmount: '12000.00',
        installments: [
            { phase: 'PHASE_1', amount: 12000, serviceFeeAmount: 13200, vatAmount: 924, scopeCount: 3 },
        ],
    });

    it('renders the frozen rate, never the live rate table', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: RETIRED_RATE_ROW,
        });
        expect(mockCapture.html).toContain('TOTAL=[[12,000.00]]');
        expect(mockCapture.html).not.toContain('15,000.00');
    });

    it('the docNumber falls back to the snapshot quotationNumber', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: RETIRED_RATE_ROW,
        });
        expect(mockCapture.html).toContain('DOC=[[QT-PRD-2026-000009]]');
    });

    it('with NO quotationRow the document is priced from the live rate table', async () => {
        // The fallback for a legacy caller that hands over no row. It printed
        // 15,000 — the ministry side's state-only slice at 3 scopes. There is
        // no side to slice any more, so it prints the whole phase the applicant
        // would actually be billed: 3 × 5,500 ค่าบริการ + 1,155 VAT.
        await tpl.generateQuotationPdf({ application, issuerSide: 'PLATFORM', phase: 1 });
        expect(mockCapture.html).toContain('TOTAL=[[17,655.00]]');
    });

    it('still rejects a missing/invalid issuerSide (ม.86 guard preserved)', async () => {
        await expect(
            tpl.generateQuotationPdf({ application, issuerSide: undefined, phase: 1 }),
        ).rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
    });
});

describe('a phase the quotation does not price (F4)', () => {
    /** A renewal: PHASE_2 only, because there is no document review to pay for. */
    const RENEWAL = frozen({
        quotationNumber: 'QT-PRD-2026-000042',
        issuerType: 'PLATFORM',
        totalAmount: '88275.00',
        installments: [
            { phase: 'PHASE_2', amount: 88275, serviceFeeAmount: 82500, vatAmount: 5775, scopeCount: 3 },
        ],
    });

    it('REFUSES with the catalogued code instead of printing a numbered 0.00 document', async () => {
        await expect(tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: RENEWAL,
        })).rejects.toMatchObject({
            code: 'QUOTATION_PHASE_NOT_PRICED',
            status: lookup('QUOTATION_PHASE_NOT_PRICED').httpStatus,
            message: getMessage('QUOTATION_PHASE_NOT_PRICED', 'th'),
        });
        expect(mockCapture.html).toBe('');
    });

    it('the phase the renewal DOES price still renders', async () => {
        await tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 2, quotationRow: RENEWAL,
        });
        expect(mockCapture.html).toContain('TOTAL=[[88,275.00]]');
    });

    it('refuses on an unaccepted renewal row as well (the installments price PHASE_2 only)', async () => {
        const unaccepted = { ...RENEWAL, status: 'PENDING', acceptedSnapshot: null };
        await expect(tpl.generateQuotationPdf({
            application, issuerSide: 'PLATFORM', phase: 1, quotationRow: unaccepted,
        })).rejects.toMatchObject({ code: 'QUOTATION_PHASE_NOT_PRICED' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ruling 12 (2026-08-28) — the document has as many lines as the ROW.
//
// Re-review N1: the per-scope divisor came from the row while the printed LIST
// came from the application's CURRENT cultivation methods. A quotation accepted
// at three methods, whose application was later revised to one, rendered a
// phase-1 grand total of 5,885 on a row that says 17,655; the reverse rendered
// three lines totalling 17,655 on a row that says 5,885.
// ─────────────────────────────────────────────────────────────────────────────

/** The same applicant after a revision down to a single cultivation method. */
const oneMethodApplication = {
    ...application,
    totalAreaTypes: 1,
    formData: { cultivationMethods: ['OUTDOOR'], farmName: 'ฟาร์มตัวอย่าง' },
};

/** A row priced for ONE method: 5,885 + 29,425 = 35,310. */
const ONE_SCOPE_PLATFORM_ROW = {
    quotationNumber: 'QT-PRD-2026-000102',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    totalAmount: '35310.00',
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
    acceptedSnapshot: null,
};

describe('the application was revised after the quotation was priced (N1)', () => {
    it('a 3-scope row under a 1-method application still prints three scopes and 17,655', async () => {
        await tpl.generateQuotationPdf({
            application: oneMethodApplication,
            issuerSide: 'PLATFORM',
            phase: 1,
            quotationRow: frozen(W14_PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('TOTAL=[[17,655.00]]');
        // หนึ่งบริการต่อหนึ่งรูปแบบการปลูก (มติ 2026-09-07) — สามรูปแบบ สามบรรทัด
        expect(rowCount(mockCapture.html)).toBe(3);
        // 17,655 / 3 = 5,885 ต่อบรรทัด — ยอดที่ต้องจ่ายจริงของรูปแบบนั้น ไม่ใช่ชิ้นส่วนของมัน
        expect((mockCapture.html.match(/5,885\.00/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    it('names the lines it can no longer attribute generically, and never by a method', async () => {
        await tpl.generateQuotationPdf({
            application: oneMethodApplication,
            issuerSide: 'PLATFORM',
            phase: 1,
            quotationRow: frozen(W14_PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('รูปแบบการปลูกที่ 1');
        expect(mockCapture.html).toContain('รูปแบบการปลูกที่ 3');
        // Pinned against the CURRENT wording. Left as 'ระบบ OUTDOOR' this assertion would
        // have gone on passing forever without being able to fail, because the document
        // stopped using that phrase (operator ruling 2026-09-06).
        expect(mockCapture.html).not.toContain('แบบกลางแจ้ง');
    });

    it('a 1-scope row under a 3-method application prints ONE scope and 5,885', async () => {
        await tpl.generateQuotationPdf({
            application, // three cultivation methods
            issuerSide: 'PLATFORM',
            phase: 1,
            quotationRow: frozen(ONE_SCOPE_PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('TOTAL=[[5,885.00]]');
        expect(rowCount(mockCapture.html)).toBe(1);
        expect(mockCapture.html).not.toContain('TOTAL=[[17,655.00]]');
    });

    it('phase 2 of that row prints its own figure, for one scope', async () => {
        await tpl.generateQuotationPdf({
            application,
            issuerSide: 'PLATFORM',
            phase: 2,
            quotationRow: frozen(ONE_SCOPE_PLATFORM_ROW),
        });
        expect(mockCapture.html).toContain('TOTAL=[[29,425.00]]');
        expect(rowCount(mockCapture.html)).toBe(1);
    });

    it('keeps the per-method wording while the counts agree', async () => {
        await tpl.generateQuotationPdf({
            application,
            issuerSide: 'PLATFORM',
            phase: 1,
            quotationRow: frozen(W14_PLATFORM_ROW),
        });
        // The per-method wording survives the revision; only its LANGUAGE changed
        // (operator ruling 2026-09-06 — the type is printed as the form words it).
        expect(mockCapture.html).toContain('แบบอาคารระบบปิด');
        expect(mockCapture.html).not.toContain('รูปแบบการปลูกที่ 1');
    });
});
