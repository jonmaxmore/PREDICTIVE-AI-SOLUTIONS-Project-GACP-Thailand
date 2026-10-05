/**
 * W14 — เส้นแบ่งระหว่างเอกสารของโมเดลเก่ากับของใหม่ · เขียนเส้นแบ่ง ไม่ใช่ลบของเก่า
 *
 * มติ W14 (2026-08-22) ยกเลิกโมเดลผู้ออกสองราย: ตอนนี้มีผู้ออกรายเดียว (บริษัท) และ VAT 7%
 * คิดบนค่าบริการทั้งก้อน · แผนการเงินของผมเองเขียน F1/F3 ไว้ว่า "ถอด issuerSide ออกจากตัวสร้าง
 * PDF" และ "เลิกคืน VAT = 0 สำหรับฝั่ง DTAM"
 *
 * **ตรวจกับข้อมูลจริงแล้ว ข้อเสนอนั้นผิด**: บน staging มีใบเสนอราคาฝั่ง DTAM อยู่ 16 ใบ
 * (สร้าง 2026-06-05 ถึง 2026-07-11 — ก่อนมติ W14 ทั้งหมด) และ ณ เวลานั้น DTAM เป็นผู้ออก
 * คนละรายจริง ค่าธรรมเนียมรัฐได้รับยกเว้น VAT จริง ⇒ VAT = 0 บนเอกสารเหล่านั้น **ถูกต้องตาม
 * ประวัติศาสตร์** การถอดเส้นทางนั้นทิ้งไม่ได้แก้อะไรเลย แต่ทำให้เอกสารภาษี 16 ใบเปิดดูไม่ได้
 * ซึ่งแย่กว่าปัญหาที่ตั้งใจจะแก้
 *
 * ความเสี่ยงจริงคืออีกด้านหนึ่ง: **คำขอหลัง W14 ต้องผลิตเอกสารฝั่ง DTAM ไม่ได้เลย** วันนี้
 * เป็นจริงเพราะการออกใบเสนอราคาสร้างแถวเดียว (issuerType = PLATFORM = บริษัท) และ dtam = null
 * — แต่มันเป็นจริงโดย *บังเอิญจากข้อมูล* ไม่ได้ถูก *ประกาศ* ไว้ที่ไหน สคริปต์ซ่อมข้อมูลหรือ
 * backfill ที่เขียนพลาดวันหนึ่ง จะทำให้ประตูออกใบ VAT = 0 ให้คำขอที่ราคารวม VAT ไปแล้วเงียบ ๆ
 *
 * ไฟล์นี้ทำให้มันเป็นการประกาศ
 */
'use strict';

const {
    W14_RULING_AT, isPreW14Document, assertIssuerSideRenderable, W14_ISSUER_SIDE_RETIRED,
    isStateFeeDocument,
} = require('../../services/billing/w14-boundary');

const at = (iso) => new Date(iso);

describe('เส้นแบ่งอยู่ตรงไหน', () => {
    test('คือวันที่มติ W14 — 2026-08-22 ไม่ใช่วันที่ใครสักคนจำได้', () => {
        expect(W14_RULING_AT.toISOString().slice(0, 10)).toBe('2026-08-22');
    });

    test('เอกสารที่สร้างก่อนมติ คือเอกสารของโมเดลเก่า', () => {
        expect(isPreW14Document({ createdAt: at('2026-07-11T00:00:00Z') })).toBe(true);
        expect(isPreW14Document({ createdAt: at('2026-06-05T00:00:00Z') })).toBe(true);
    });

    test('เอกสารที่สร้างหลังมติ ไม่ใช่', () => {
        expect(isPreW14Document({ createdAt: at('2026-09-05T00:00:00Z') })).toBe(false);
    });

    test('แถวที่ไม่มีวันที่ ไม่ถือว่าเป็นของเก่า — การเดาไปทางที่ผ่อนปรนคือการเปิดช่อง', () => {
        expect(isPreW14Document({})).toBe(false);
        expect(isPreW14Document(null)).toBe(false);
        expect(isPreW14Document({ createdAt: 'ไม่ใช่วันที่' })).toBe(false);
    });
});

describe('ประตูเอกสารฝั่ง DTAM', () => {
    const oldRow = { issuerType: 'DTAM', createdAt: at('2026-07-11T00:00:00Z'), quotationNumber: 'QT-DTAM-0001' };
    const newRow = { issuerType: 'DTAM', createdAt: at('2026-09-05T00:00:00Z'), quotationNumber: 'QT-DTAM-9999' };
    const company = { issuerType: 'PLATFORM', createdAt: at('2026-09-05T00:00:00Z'), quotationNumber: 'QT-PRD-2026-0001' };

    test('แถวเก่ายังเปิดดูได้ — 16 ใบบน staging ต้องไม่หายไปเพราะเราทำความสะอาดโค้ด', () => {
        expect(() => assertIssuerSideRenderable({ issuerSide: 'DTAM', row: oldRow })).not.toThrow();
    });

    test('แถว DTAM ที่เกิดหลังมติ ถูกปฏิเสธ — ไม่มีทางที่มันจะถูกต้อง', () => {
        expect(() => assertIssuerSideRenderable({ issuerSide: 'DTAM', row: newRow }))
            .toThrow(expect.objectContaining({ code: W14_ISSUER_SIDE_RETIRED, statusCode: 409 }));
    });

    test('คำปฏิเสธบอกเป็นภาษาไทยว่าทำไม และไม่โยนรหัสเครื่องใส่หน้าคน', () => {
        try { assertIssuerSideRenderable({ issuerSide: 'DTAM', row: newRow }); }
        catch (e) {
            expect(e.messageTh).toMatch(/[ก-๙]/);
            expect(e.messageTh).toContain('W14');
        }
    });

    test('ฝั่งบริษัทผ่านเสมอ — มันคือผู้ออกรายเดียวที่เหลืออยู่', () => {
        expect(() => assertIssuerSideRenderable({ issuerSide: 'PLATFORM', row: company })).not.toThrow();
    });

    test('ไม่มีแถวก็ไม่ใช่หน้าที่ของด่านนี้ — 404 เป็นเรื่องของผู้เรียก', () => {
        expect(() => assertIssuerSideRenderable({ issuerSide: 'DTAM', row: null })).not.toThrow();
    });
});

describe('ใบเสร็จฝั่งรัฐ (F2) — เส้นแบ่งเดียวกัน ด้วยเหตุผลเดียวกัน', () => {
    // ตรวจข้อมูลจริงแล้วเช่นกัน: staging ถือใบแจ้งหนี้ฝั่งรัฐ 22 ใบ
    // (PHASE_1_STATE_FEE 10 · PHASE_2_STATE_FEE 12) สร้าง 2026-06-05 ถึง 07-16
    // และ **ไม่มีใบไหนเกิดหลังมติ W14 เลย** · การถอดเทมเพลตทิ้งตามที่แผนเขียนไว้
    // จะทำให้ใบเสร็จของ 22 ใบนั้นเรนเดอร์ไม่ได้
    const oldStateInvoice = { serviceType: 'PHASE_1_STATE_FEE', createdAt: at('2026-07-16T00:00:00Z') };
    const newStateInvoice = { serviceType: 'PHASE_2_STATE_FEE', createdAt: at('2026-09-05T00:00:00Z') };

    test('ใบแจ้งหนี้ฝั่งรัฐที่ออกก่อนมติ ยังออกใบเสร็จได้', () => {
        expect(() => assertIssuerSideRenderable({ issuerSide: 'DTAM', row: oldStateInvoice })).not.toThrow();
    });

    test('ใบแจ้งหนี้ฝั่งรัฐที่เกิดหลังมติ ออกใบเสร็จในนามกรมฯ ไม่ได้', () => {
        expect(() => assertIssuerSideRenderable({ issuerSide: 'DTAM', row: newStateInvoice }))
            .toThrow(expect.objectContaining({ code: W14_ISSUER_SIDE_RETIRED }));
    });

    test('ตัวช่วยบอกได้ว่าใบแจ้งหนี้ใบไหนเป็นฝั่งรัฐ — ไม่ต้องให้ผู้เรียกเดาจากชื่อ serviceType เอง', () => {
        expect(isStateFeeDocument({ serviceType: 'PHASE_1_STATE_FEE' })).toBe(true);
        expect(isStateFeeDocument({ serviceType: 'PHASE_2_STATE_FEE' })).toBe(true);
        expect(isStateFeeDocument({ serviceType: 'PHASE_1_PLATFORM_FEE' })).toBe(false);
        expect(isStateFeeDocument({ serviceType: 'CERTIFICATION' })).toBe(false);
        expect(isStateFeeDocument({})).toBe(false);
        expect(isStateFeeDocument(null)).toBe(false);
    });
});
