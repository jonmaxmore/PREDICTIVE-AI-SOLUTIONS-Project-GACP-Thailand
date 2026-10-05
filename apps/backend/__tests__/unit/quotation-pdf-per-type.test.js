'use strict';

/**
 * generateQuotationPdf replicates the OFFICIAL DTAM ใบเสนอราคา form, per-phase:
 *   - Phase 1 = ค่าตรวจสอบและประเมินคำขอการรับรองมาตรฐานเบื้องต้น (5,000/type)
 *   - Phase 2 = ค่ารับรองผลการประเมินและจัดทำหนังสือรับรองมาตรฐาน (25,000/type)
 * One row per cultivation type (ระบบ INDOOR/GREENHOUSE/OUTDOOR), same price each.
 * Mocks the PDF engine (no Puppeteer) and captures the rendered HTML.
 */

const mockCapture = { html: '' };

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    readTemplateCached: () => [
        'DOC=[[{{DOC_NUMBER}}]]',
        'NAME=[[{{ISSUER_NAME_TH}}]]',
        'TAXID=[[{{ISSUER_TAX_ID}}]]',
        'CONTACT=[[{{ISSUER_CONTACT}}]]',
        'DIV=[[{{ISSUER_DIVISION}}]]',
        'SIGN=[[{{SIGNATORY_NAME}}]]',
        'BANK=[[{{BANK_LINE}}]]',
        'ITEMS={{ITEMS_ROWS}}',
        'TOTAL=[[{{GRAND_TOTAL}}]]',
        'WORDS=[[{{AMOUNT_WORDS}}]]',
    ].join(' '),
    replaceTemplateVariables: (tpl, data) =>
        tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(data[k] === undefined ? '' : data[k])),
    generatePDF: async (html) => { mockCapture.html = html; return Buffer.from('PDF'); },
}));

const tpl = require('../../services/pdf/invoice-template-service');

const application = {
    id: 'app-1',
    applicationNumber: 'GACP-TH-2569-000123',
    totalAreaTypes: 3,
    formData: { cultivationMethods: ['INDOOR', 'GREENHOUSE', 'OUTDOOR'], farmName: 'ฟาร์มตัวอย่าง' },
};

describe('generateQuotationPdf — หนึ่งบรรทัดต่อรูปแบบการปลูก ในนามบริษัทรายเดียว', () => {
    beforeEach(() => { mockCapture.html = ''; });

    /**
     * ── สามข้อที่เคยตรึงฝั่งกรม ถูกถอด 2026-09-11 ──────────────────────────────
     * operator: *"เราจะไม่มีใบเสนอราคา ใบวางบิล และใบเสร็จของ dtam แล้ว จะมีเฉพาะ
     * ของบริษัทเท่านั้น"*
     *
     * ข้อเดิมตรึงหัวกระดาษของกรม ("กองกัญชาทางการแพทย์" · ผู้ลงนาม "นายพีรชา คูเกษมกิจ" ·
     * เลขบัญชีกรุงไทย 4750134376) และราคาแบบส่วนรัฐล้วน (5,000 / 25,000 ต่อรูปแบบ)
     * ⇒ ไม่มีเอกสารแบบนั้นให้เรนเดอร์อีกแล้ว และประตูปฏิเสธ issuerSide ที่ไม่ใช่ PLATFORM
     *
     * สิ่งที่ยังตรึงเหมือนเดิม และเป็นเหตุผลที่ไฟล์นี้ยังอยู่: **หนึ่งบรรทัดต่อรูปแบบการปลูก
     * พิมพ์ด้วยคำไทยของแบบฟอร์ม ไม่ใช่คำ enum ภายใน** (operator 2026-09-06:
     * "outdoor เราต้องลงในใบเสนอราคาว่ากลางแจ้ง หรือ glasshouse เป็นโรงเรือน")
     */
    it('งวดที่ 1: สามรูปแบบ สามบรรทัด รูปแบบละ 5,885 รวม 17,655 หัวกระดาษของบริษัท', async () => {
        await tpl.generateQuotationPdf(
            { application, issuerSide: 'PLATFORM', phase: 1 },
            { quotationNumber: 'QT-PRD-P1-2569-000123' },
        );
        const html = mockCapture.html;
        expect(html).toContain('DOC=[[QT-PRD-P1-2569-000123]]');
        expect(html).toContain('NAME=[[บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด]]');
        expect(html).toContain('TAXID=[[0105568045932]]');   // เลขของบริษัท ไม่ใช่ของกรม
        // อีเมลของบริษัท — finance@gacpth.com (fix/invoice-pdf-truth, 2026-09-27;
        // เดิมทดสอบพิน 'issuer-contact@example.com' ซึ่งเป็น gmail ส่วนตัวที่ default ผิด ถูกถอด)
        expect(html).toContain('finance@gacpth.com');
        expect(html).not.toMatch(/gmail\.com/i);
        // คำไทยของแบบฟอร์ม ไม่ใช่คำ enum ภายใน
        // fix/fee-line-descriptions: the catalogue name carries the instalment, ahead of the type
        expect(html).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร สำหรับขออนุญาต รูปแบบการปลูกแบบอาคารระบบปิด');
        expect(html).toContain('แบบโรงเรือน');
        expect(html).toContain('แบบกลางแจ้ง');
        expect(html).not.toMatch(/INDOOR|GREENHOUSE|OUTDOOR/);
        expect((html.match(/5,885\.00/g) || []).length).toBeGreaterThanOrEqual(3);
        expect(html).toContain('TOTAL=[[17,655.00]]');
    });

    it('งวดที่ 2: รูปแบบละ 29,425 รวม 88,275', async () => {
        await tpl.generateQuotationPdf(
            { application, issuerSide: 'PLATFORM', phase: 2 },
            { quotationNumber: 'QT-PRD-P2-2569-000123' },
        );
        const html = mockCapture.html;
        expect(html).toContain('งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง สำหรับขออนุญาต รูปแบบการปลูกแบบอาคารระบบปิด');
        expect((html.match(/29,425\.00/g) || []).length).toBeGreaterThanOrEqual(3);
        expect(html).toContain('TOTAL=[[88,275.00]]');
    });

    it('ไม่มีหัวกระดาษ ผู้ลงนาม หรือเลขบัญชีของกรมหลงเหลือบนเอกสาร', async () => {
        await tpl.generateQuotationPdf(
            { application, issuerSide: 'PLATFORM', phase: 1 },
            { quotationNumber: 'QT-PRD-P1-2569-000123' },
        );
        const html = mockCapture.html;
        expect(html).not.toContain('กองกัญชาทางการแพทย์');
        expect(html).not.toContain('นายพีรชา คูเกษมกิจ');
        expect(html).not.toContain('4750134376');          // บัญชีกรุงไทยของกรม
        expect(html).not.toContain('0994000036540');       // เลขผู้เสียภาษีของกรม
        expect(html).not.toContain('QT-DTAM');
    });

    it('ยังปฏิเสธ issuerSide ที่ขาดหรือไม่ถูกต้อง (ด่าน ม.86 คงไว้)', async () => {
        await expect(
            tpl.generateQuotationPdf({ application, issuerSide: undefined, phase: 1 }),
        ).rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
        await expect(
            tpl.generateQuotationPdf({ application, issuerSide: 'DTAM', phase: 1 }),
        ).rejects.toMatchObject({ code: 'INVALID_ISSUER_SIDE' });
    });
});
