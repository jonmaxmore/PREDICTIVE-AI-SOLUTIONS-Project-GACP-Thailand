/**
 * ใบเสนอราคาแยกบรรทัดตาม "บริการ" ไม่ใช่ตาม "องค์ประกอบบัญชี"
 *
 * มติ operator 2026-09-07 — ตอบคำถามที่ค้างอยู่ว่าหน้าสรุปยอดควรกางองค์ประกอบ
 * (ค่ารัฐ 90,000 · แพลตฟอร์ม 9,000 · VAT 6,930) ให้ลูกค้าเห็นไหม:
 *
 *   *"ไม่ต้อง เราแยกตามบริการ เช่น ค่าบริการตรวจสอบเอกสาร สำหรับขออนุญาต
 *     รูปแบบการปลูกแบบกลางแจ้ง … เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง"*
 *
 * ที่เอกสารพิมพ์อยู่ก่อนมตินี้ (วัดจริงด้วย buildQuotationItemLines, 3 รูปแบบการปลูก):
 *
 *   1. ค่าธรรมเนียมกรม (ตรวจประเมิน) แบบกลางแจ้ง งวดที่ 1                        10,000
 *   2. ค่าบริการแพลตฟอร์ม (ตรวจประเมิน) แบบกลางแจ้ง งวดที่ 1                       1,000
 *   3. ภาษีมูลค่าเพิ่ม 7% (ของค่าธรรมเนียมกรม + ค่าบริการแพลตฟอร์ม) แบบกลางแจ้ง …      770
 *   … × 3 รูปแบบ = 9 บรรทัด
 *
 * นั่นคือการกาง **บัญชีภายใน** ให้ผู้ยื่นดู — เขาไม่ได้ซื้อ "ค่าธรรมเนียมกรม" กับ "VAT"
 * แยกกัน เขาซื้อบริการหนึ่งอย่างต่อหนึ่งรูปแบบการปลูก · และ W14 ตัดสินไว้แล้วว่าผู้ขายคือ
 * บริษัทรายเดียว ⇒ การแยกว่าเงินไปกรมเท่าไรเป็นเรื่องหลังบ้าน ไม่ใช่ของบนใบเสนอราคา
 *
 * เอกสารภาษี (ใบกำกับภาษี/ใบเสร็จ) ไม่ถูกแตะ — มันมีตัวสร้างของตัวเอง
 * (generateReceiptTaxInvoicePdf / buildTotalsRowsHtml) และ VAT ต้องแยกบรรทัดตามกฎหมาย
 * ที่นี่คือ **ใบเสนอราคา** ซึ่งเสนอราคาที่ต้องจ่ายจริงต่อบริการได้
 */
'use strict';

const {
    buildQuotationItemLines,
    buildQuotationComponents,
} = require('../../services/pdf/invoice-template-service');

const THREE_SCOPES = [
    { method: 'OUTDOOR' },
    { method: 'INDOOR' },
    { method: 'GREENHOUSE' },
];

/** ยอดจริงของงวดที่ 1 สามรูปแบบ: รัฐ 15,000 · แพลตฟอร์ม 1,500 · VAT 1,155 = 17,655 */
const WHOLE_PHASE = { state: 15000, platform: 1500, vat: 1155 };
const PHASE_TOTAL = 17655;
const BREAKDOWN = THREE_SCOPES.map((s) => ({
    method: s.method,
    serviceFeeAmount: 5500,
    vatAmount: 385,
    phaseTotal: 5885,
}));

const linesFor = (phase, opts = {}) => buildQuotationItemLines({
    scopes: THREE_SCOPES,
    components: buildQuotationComponents({
        phase,
        wholePhaseLine: WHOLE_PHASE,
        isStateSide: false,
        phaseTotal: PHASE_TOTAL,
        ...opts,
    }),
    phase,
    scopeBreakdown: BREAKDOWN,
    ...opts,
});

describe('หนึ่งบรรทัด = หนึ่งบริการ × หนึ่งรูปแบบการปลูก', () => {
    it('ปลูก 3 รูปแบบ ได้ 3 บรรทัด ไม่ใช่ 9', () => {
        expect(linesFor(1)).toHaveLength(3);
    });

    it('ทุกบรรทัดบอกชื่อบริการที่ซื้อ', () => {
        for (const line of linesFor(1)) {
            expect(line.description).toContain('ค่าบริการตรวจสอบเอกสาร');
        }
        for (const line of linesFor(2)) {
            expect(line.description).toContain('ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
        }
    });

    it('ทุกบรรทัดบอกว่าจ่ายเพื่ออะไร และรูปแบบการปลูกไหน — ตามถ้อยคำในมติ', () => {
        const first = linesFor(1)[0];
        expect(first.description).toContain('สำหรับขออนุญาต');
        expect(first.description).toContain('รูปแบบการปลูกแบบกลางแจ้ง');
    });

    it('ไม่กางองค์ประกอบบัญชีให้ผู้ยื่นดูอีก', () => {
        const all = linesFor(1).map((l) => l.description).join(' | ');
        expect(all).not.toContain('ค่าธรรมเนียมกรม');
        expect(all).not.toContain('ค่าบริการแพลตฟอร์ม');
        expect(all).not.toContain('ภาษีมูลค่าเพิ่ม');
    });

    it('ยอดต่อบรรทัดคือยอดที่ต้องจ่ายจริงของรูปแบบนั้น และรวมกันได้เท่ายอดงวด', () => {
        const lines = linesFor(1);
        expect(lines.map((l) => l.amount)).toEqual([5885, 5885, 5885]);
        expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(PHASE_TOTAL);
    });

    it('คำขอต่ออายุพูดว่าต่ออายุ และไม่เรียกตัวเองว่างวดที่ 2', () => {
        const line = linesFor(2, { isRenewal: true })[0];
        expect(line.description).toContain('ค่าบริการต่ออายุใบรับรอง');
        expect(line.description).toContain('สำหรับต่ออายุ');
        expect(line.description).not.toContain('งวดที่');
    });

    it('ยังบอกงวดสำหรับคำขอปกติ — มติ 2026-09-06 ยังอยู่', () => {
        expect(linesFor(1)[0].description).toContain('งวดที่ 1');
        expect(linesFor(2)[0].description).toContain('งวดที่ 2');
    });
});
