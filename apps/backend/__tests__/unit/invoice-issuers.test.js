/**
 * ผู้ออกเอกสารทางการเงิน — **มีรายเดียว**
 *
 * operator 2026-09-11: *"ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการ
 * ทั้งหมด"* และ *"ต้องเคลียร์ให้ชัดว่ามีแค่แพลตฟอร์มอย่างเดียว"*
 *
 * ── ไฟล์นี้เคยตรึงอะไร และทำไมมันเปลี่ยน ──
 * เดิม 284 บรรทัด ตรึงการแยกผู้ออกเอกสารสองราย: DTAM ออกใบเสร็จเงินรายได้แผ่นดิน
 * (ไม่มี VAT ตาม ม.77/1(10)) · บริษัทออกใบกำกับภาษีเต็มรูป · `getInvoiceIssuer` วิ่ง
 * STATE → DTAM และ PLATFORM → บริษัท · `shouldChargeVat` คืน false ให้ฝั่งกรม
 *
 * ทั้งหมดนั้นถูกถอดออกจากโค้ด · สิ่งที่ยังมีค่าและถูกยกมาไว้ที่นี่คือสามข้อ:
 * ตัวตนทางกฎหมายของบริษัทที่พิมพ์ลงเอกสาร · การตรวจความพร้อมก่อนขึ้นระบบจริง
 * (ค่าที่ยังเป็น PENDING) · และการยืนยันว่า **ไม่มีช่องหักภาษี ณ ที่จ่าย** โดยตั้งใจ
 * (operator: "ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย หรือเราไม่ได้นำส่ง เอาออกก็ได้")
 */

'use strict';

const path = require('path');
const CONFIG = path.join(__dirname, '..', '..', 'config', 'invoice-issuers');

const issuers = require(CONFIG);
const {
    SERVICE_TYPES, ISSUER_TYPES, PLATFORM_ISSUER, PLATFORM_BANK_ACCOUNT,
    getInvoiceIssuer, getBankAccountForIssuer, PENDING,
} = issuers;

describe('ทะเบียนผู้ออกเอกสารมีรายเดียว', () => {
    it('ISSUER_TYPES มีแค่ PLATFORM', () => {
        expect(Object.keys(ISSUER_TYPES)).toEqual(['PLATFORM']);
    });

    it('ตัวตนและบัญชีของกรมถูกถอดออกหมด', () => {
        expect(issuers.DTAM_ISSUER).toBeUndefined();
        expect(issuers.DTAM_BANK_ACCOUNT).toBeUndefined();
        // เดิมมี shouldChargeVat() ที่ตอบว่าฝั่งไหนคิด VAT — ไม่มีสองฝั่งให้ถามแล้ว
        expect(issuers.shouldChargeVat).toBeUndefined();
    });

    it('ขอบัญชีของฝั่งที่ไม่มีอยู่ = โยนข้อผิดพลาด ไม่ใช่คืนค่าเงียบ ๆ', () => {
        expect(() => getBankAccountForIssuer('DTAM')).toThrow(/Unknown issuerType/);
        expect(getBankAccountForIssuer(ISSUER_TYPES.PLATFORM)).toBe(PLATFORM_BANK_ACCOUNT);
    });
});

describe('ตัวตนทางกฎหมายที่พิมพ์ลงเอกสารทุกใบ', () => {
    it('เป็นบริษัท ไม่ใช่กรม', () => {
        expect(PLATFORM_ISSUER.type).toBe(ISSUER_TYPES.PLATFORM);
        expect(PLATFORM_ISSUER.legalNameTH).toContain('พรีดิกทีฟ เอไอ โซลูชัน');
        expect(PLATFORM_ISSUER.taxId).toBe('0105568045932');
        expect(PLATFORM_ISSUER.chargesVat).toBe(true);
    });

    it('ไม่มีช่องหักภาษี ณ ที่จ่าย โดยตั้งใจ', () => {
        const keys = Object.keys(PLATFORM_ISSUER).join(' ').toLowerCase();
        expect(keys).not.toContain('withhold');
        expect(keys).not.toContain('wht');
    });
});

describe('ทุกประเภทบริการออกโดยบริษัทรายเดียวกัน', () => {
    it.each(Object.values(SERVICE_TYPES))('%s → บริษัท พร้อมบัญชีของบริษัท', (serviceType) => {
        const issuer = getInvoiceIssuer(serviceType);
        expect(issuer.type).toBe(ISSUER_TYPES.PLATFORM);
        expect(issuer.taxId).toBe(PLATFORM_ISSUER.taxId);
        expect(issuer.bankAccount.issuer).toBe(ISSUER_TYPES.PLATFORM);
    });

    it('ประเภทบริการที่ไม่รู้จักยังเป็นข้อผิดพลาด — การยุบสาขาต้องไม่ทำให้คำที่พิมพ์ผิดกลายเป็นเอกสารที่ถูกต้อง', () => {
        expect(() => getInvoiceIssuer('NOT_A_SERVICE_TYPE')).toThrow(/Unknown serviceType/);
        expect(() => getInvoiceIssuer('')).toThrow(/Unknown serviceType/);
    });
});

describe('การตรวจความพร้อมก่อนขึ้นระบบจริง', () => {
    const ENV_KEYS = [
        'PLATFORM_TAX_ID', 'PLATFORM_ADDRESS_LINE1', 'PLATFORM_REGISTRATION_NO',
        'PLATFORM_BANK_NAME', 'PLATFORM_BANK_ACCOUNT_NO',
    ];

    const withEnv = (patch, fn) => {
        const backup = {};
        for (const k of ENV_KEYS) { backup[k] = process.env[k]; delete process.env[k]; }
        Object.assign(process.env, patch);
        jest.resetModules();
        try { fn(require(CONFIG)); } finally {
            for (const k of ENV_KEYS) {
                delete process.env[k];
                if (backup[k] !== undefined) { process.env[k] = backup[k]; }
            }
            jest.resetModules();
        }
    };

    it('ชี้ช่องบัญชีธนาคารที่ยังไม่ได้ตั้ง — ฝ่ายการเงินต้องเห็นก่อนลูกค้าเห็น', () => {
        withEnv({}, (fresh) => {
            const pending = fresh.listPendingIssuerFields();
            const bank = pending.filter(([, t]) => t === 'PLATFORM_BANK_ACCOUNT');
            expect(bank.map(([k]) => k).sort()).toEqual(['accountNo', 'bankName']);
            // ไม่มีแถวของฝั่งกรมให้รายงานอีกแล้ว
            expect(pending.filter(([, t]) => String(t).includes('DTAM'))).toEqual([]);
        });
    });

    it('ค่าที่ถูกตั้งเป็น PENDING ตรง ๆ ก็ถูกจับได้', () => {
        withEnv({ PLATFORM_TAX_ID: PENDING }, (fresh) => {
            const pending = fresh.listPendingIssuerFields();
            expect(pending.some(([k]) => k === 'taxId')).toBe(true);
        });
    });
});
