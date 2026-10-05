'use strict';
/**
 * เอกสารการค้าต้องขึ้นโลโก้บริษัท ไม่ใช่ตราของกระทรวง
 *
 * `18b94183` เดินสายไว้ครบแล้ว (quotation/invoice/receipt/tax-invoice/credit-note/debit-note
 * ดึงจาก `getCompanyLogoDataUrl()`) แต่ commit นั้นเขียนไว้เองว่า *"company-logo.png is
 * committed as a COPY of the ministry logo as a non-breaking placeholder"* — คือวางรูปตรา
 * กระทรวงไว้ในชื่อไฟล์ของบริษัท เพื่อไม่ให้เอกสารพัง ระหว่างรอรูปจริง
 *
 * ═══ ทำไมต้องมีด่าน ไม่ใช่แค่สลับไฟล์แล้วจบ ═══
 * placeholder แบบนี้ "ผ่าน" ทุกอย่างที่มีอยู่: ไฟล์มีจริง · อ่านได้ · เป็น PNG ที่ถูกต้อง ·
 * `getCompanyLogoDataUrl()` คืน data URI ปกติ · เทส 74 ตัวใน `pdf-assets.test.js` เขียวหมด
 * สิ่งเดียวที่ผิดคือ **ภาพในไฟล์เป็นตราของอีกนิติบุคคลหนึ่ง** ซึ่งไม่มีเครื่องใดในระบบมองเห็น
 * ⇒ ถ้ารูปจริงหายไประหว่าง rebase/merge/แก้ conflict เอกสารจะกลับไปพิมพ์ตรากระทรวงเงียบ ๆ
 * บนใบเสนอราคาที่ออกในนามบริษัท — ซึ่งเป็นการอ้างตราของหน่วยงานรัฐบนเอกสารการค้า
 *
 * และ `getCompanyLogoDataUrl()` มี fallback ไปตรากระทรวงเมื่ออ่านไฟล์ไม่ได้ (กันเอกสารรูปแตก)
 * ⇒ ไฟล์หาย = ไม่มีใครรู้เลย เพราะทางถอยทำให้ทุกอย่างดู "ทำงานอยู่" ด่านนี้คือคนที่รู้
 *
 * ═══ สองหน้าต้องสลับพร้อมกัน ═══
 * กระดาษ (PDF templates/shared) กับจอ (web public/images) เป็นคนละไฟล์ และ commit เดิม
 * บอกไว้ว่าการใส่รูปจริงคือ "two-file swap" ⇒ ด่านนี้ตรึงทั้งสองใบ ไม่ให้สลับครึ่งเดียว
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pdfAssets = require('../../services/pdf/pdf-assets');

const PDF_MINISTRY_LOGO = path.join(pdfAssets.SHARED_DIR, 'gacpthai-logo.png');
const PDF_COMPANY_LOGO = path.join(pdfAssets.SHARED_DIR, 'company-logo.png');
const WEB_IMAGES = path.resolve(__dirname, '../../../web-app/public/images');
const WEB_MINISTRY_LOGO = path.join(WEB_IMAGES, 'gacpthai-logo.png');
const WEB_COMPANY_LOGO = path.join(WEB_IMAGES, 'company-logo.png');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('โลโก้บนเอกสารการค้า คือโลโก้ของบริษัทจริง', () => {
    it.each([
        ['กระดาษ (PDF template)', PDF_COMPANY_LOGO, PDF_MINISTRY_LOGO],
        ['จอ (web preview)', WEB_COMPANY_LOGO, WEB_MINISTRY_LOGO],
    ])('%s — ไฟล์โลโก้บริษัทมีอยู่จริง และไม่ใช่ตรากระทรวงที่ถูกคัดลอกมาวาง', (_label, company, ministry) => {
        expect(fs.existsSync(company)).toBe(true);
        expect(sha256(company)).not.toBe(sha256(ministry));
    });

    it('เป็น PNG จริง ไม่ใช่ไฟล์ว่างหรือไฟล์ที่ยังไม่ได้ดาวน์โหลด', () => {
        for (const file of [PDF_COMPANY_LOGO, WEB_COMPANY_LOGO]) {
            const head = fs.readFileSync(file).subarray(0, 8);
            expect(head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
            expect(fs.statSync(file).size).toBeGreaterThan(1024);
        }
    });

    it('ตัวอ่านคืนไฟล์ของบริษัท — แปลว่าทางถอยไปตรากระทรวงไม่ได้ทำงานอยู่', () => {
        const url = pdfAssets.getCompanyLogoDataUrl();
        expect(url).toBe(`data:image/png;base64,${fs.readFileSync(PDF_COMPANY_LOGO).toString('base64')}`);
        expect(url).not.toBe(pdfAssets.getLogoDataUrl());
    });

    it('ไม่มี template การค้าใบไหนเรียกชื่อโลโก้ว่าตราของรัฐ', () => {
        // สองอย่างในข้อเดียว เพราะมันคือความผิดพลาดเดียวกันคนละชั้น:
        //   alt  — สิ่งที่ screen reader อ่านออกเสียง และสิ่งที่เหลือเมื่อรูปโหลดไม่ขึ้น
        //   ชื่อตัวแปร — สิ่งที่คนแก้โค้ดคนต่อไปเชื่อว่าช่องนี้ใส่อะไร
        // เดิมชื่อ {{GARUDA_DATA_URL}} ซึ่งผิดสองชั้น: ค่าที่ใส่ไม่เคยเป็นครุฑเลย
        // (e76f1f9e เปลี่ยนครุฑเป็นตรากรมฯ แต่ไม่เปลี่ยนชื่อ) และตั้งแต่ 18b94183
        // ใบการค้าใส่โลโก้บริษัท ⇒ ชื่อยิ่งห่างจากของจริงไปอีกขั้น
        const dir = path.join(pdfAssets.SHARED_DIR, '..');
        const commercial = ['quotation.html', 'invoice.html', 'receipt-tax-invoice.html', 'credit-note.html', 'debit-note.html'];
        for (const file of commercial) {
            const src = fs.readFileSync(path.join(dir, file), 'utf8');
            const imgTags = src.match(/<img[^>]*ISSUER_LOGO_DATA_URL[^>]*>/g) || [];
            expect(imgTags.length).toBeGreaterThan(0);
            for (const tag of imgTags) {
                expect(tag).not.toMatch(/กระทรวง|กรมการแพทย์|Ministry|ครุฑ|garuda/i);
            }
            // ตัวหนังสือที่เหลือทั้งไฟล์ต้องไม่พาชื่อเก่ากลับมาด้วย
            expect(src).not.toMatch(/GARUDA/i);
        }
    });

    it('ตัวเรนเดอร์ส่งค่าเข้าช่องที่ template รออยู่จริง — ไม่มีใบไหนเหลือ placeholder ที่ไม่ถูกแทน', () => {
        // การเปลี่ยนชื่อช่องพังแบบเงียบได้: ถ้าฝั่งเรนเดอร์ยังส่งคีย์เก่า template จะพิมพ์
        // ตัวอักษร "{{ISSUER_LOGO_DATA_URL}}" ออกมาแทนรูป (หรือ src ว่าง) โดยไม่มี error
        const service = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'pdf', 'invoice-template-service.js'), 'utf8',
        );
        const keys = service.match(/ISSUER_LOGO_DATA_URL: getCompanyLogoDataUrl\(\)/g) || [];
        expect(keys.length).toBe(4); // quotation · invoice · receipt/tax invoice (one paper since 2026-09-29) · credit/debit note
        expect(service).not.toMatch(/GARUDA/i);
    });
});
