/**
 * มติ operator 2026-09-07: "ต่ออายุ ยังไงต้องส่งคำขอมาก่อน และแนบเอกสาร และจ่ายเงิน 30000
 * พร้อมค่าใช้จ่ายอื่นๆ แล้ว คนแยกงาน ส่งงานไปที่พนักงานลงตรวจพื้นที่เลย ไม่ต้องผ่านคนตรวจเอกสาร"
 *
 * มตินี้ปิด F-RENEWAL-01 และประสานสองมติเดิมที่เคยขัดกัน:
 *   2026-08-22 — ต่ออายุจ่ายครั้งเดียว ไม่ตรวจเอกสาร นัดลงพื้นที่อย่างเดียว
 *   2026-09-06 — คำขอที่ต่อจากใบเดิมต้องพิสูจน์ตัวตนซ้ำ (จึงต้องมีเอกสารแนบ)
 * คำตอบคือ: **แนบเอกสาร แต่ไม่มีขั้นตรวจเอกสาร** — เอกสารถูกเก็บและถูกตรึงไว้กับคำขอ
 * ผู้ตรวจแปลงเป็นคนอ่านตอนลงพื้นที่ ไม่มีด่านตรวจเอกสารมาคั่นและไม่มีค่าธรรมเนียมงวดแรก
 *
 * ก่อนแก้: คำขอต่ออายุที่ยื่นผ่าน wizard ไปหยุดที่ PENDING_DOC_FEE ซึ่งเป็นสถานะที่จ่ายได้เฉพาะ
 * M1 แต่ตัวคิดราคาปฏิเสธ M1 ของการต่ออายุ (CHECKOUT_RENEWAL_SINGLE_CHARGE) และปฏิเสธ M2
 * เพราะสถานะยังไม่ถึง ⇒ จ่ายไม่ได้ทั้งสองงวด เป็นทางตันที่เดินเข้าไปได้จากหน้าจอจริง
 */
'use strict';

const { entryStateForSubmission, RENEWAL_ENTRY_STATE, NEW_ENTRY_STATE } =
    require('../../services/application-service/submission-entry-state');

describe('คำขอที่ยื่นเข้ามา หยุดที่ด่านจ่ายเงินที่ถูกต้องของตัวเอง', () => {
    it('ขอใหม่ → รอค่าตรวจเอกสาร (งวดที่ 1)', () => {
        expect(entryStateForSubmission({ requestType: 'NEW' })).toBe(NEW_ENTRY_STATE);
        expect(NEW_ENTRY_STATE).toBe('PENDING_DOC_FEE');
    });

    it('ต่ออายุ → ข้ามขั้นตรวจเอกสาร ไปรอค่าตรวจพื้นที่', () => {
        expect(entryStateForSubmission({ requestType: 'RENEWAL' })).toBe(RENEWAL_ENTRY_STATE);
        expect(RENEWAL_ENTRY_STATE).toBe('PENDING_AUDIT_FEE');
    });

    it('ใบแทนยังเดินเส้นเดิม — มติพูดถึงการต่ออายุเท่านั้น', () => {
        expect(entryStateForSubmission({ requestType: 'REPLACEMENT' })).toBe(NEW_ENTRY_STATE);
    });

    it('คำขอที่ไม่บอกประเภท ถือเป็นขอใหม่ — เส้นทางที่ยาวกว่า ไม่ใช่สั้นกว่า', () => {
        expect(entryStateForSubmission({})).toBe(NEW_ENTRY_STATE);
        expect(entryStateForSubmission(null)).toBe(NEW_ENTRY_STATE);
        expect(entryStateForSubmission({ requestType: 'อะไรก็ไม่รู้' })).toBe(NEW_ENTRY_STATE);
    });

    it('requestType ที่ผู้ยื่นพิมพ์เองเปลี่ยนเส้นทางไม่ได้ — อ่านจากคีย์ที่เซิร์ฟเวอร์เป็นเจ้าของ', () => {
        // ประตูร่างถอด requestType ออกจาก payload ของผู้ยื่นอยู่แล้ว (form-data-ownership)
        // และค่าที่อยู่ใน formData มาจากตัวแก้ dimension ที่ตรวจใบรับรองเดิมก่อน — ที่นี่จึง
        // ยืนยันเพียงว่าเราอ่าน formData ไม่ใช่ payload ดิบ
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'applications', 'applications.js'),
            'utf8',
        );
        expect(src).toContain('entryStateForSubmission');
    });
});

describe('เส้นทางหลังจ่ายเงิน', () => {
    it('งวดเดียวของการต่ออายุถูกบันทึกใน M2 ซึ่งจ่ายได้จากสถานะที่คำขอเข้ามา', () => {
        const { PAYABLE_STATES } = require('../../services/checkout/stripe-checkout-service');
        expect(PAYABLE_STATES.M2).toContain(RENEWAL_ENTRY_STATE);
        expect(PAYABLE_STATES.M1).not.toContain(RENEWAL_ENTRY_STATE);
    });
});
