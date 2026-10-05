/**
 * VIS-ACCT-02 — เหลือแต่ขาเขียน (operator 2026-09-11)
 *
 * เดิมไฟล์นี้ตรึงสองอย่าง: invoiceSideWhere (แคบรายการ/ยอดรวมให้การเงินแต่ละบทบาทเห็นแค่ฝั่ง
 * ของตัวเอง) และ invoiceVisibleSide (ฝั่งที่บทบาทนั้นแตะได้) · คำตัดสิน "finance ต้องเห็นเหมือนกัน
 * ... ตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน" ลบขาอ่านทิ้งทั้งตัว — ความเท่ากันของการอ่านถูกพิสูจน์
 * ที่ประตูจริงใน finance-read-parity.test.js · ที่เหลือที่นี่คือตัวแก้ฝั่งของด่านเขียน
 * (assertInvoiceSideWritable — hold/release) ซึ่งยังไม่เปลี่ยน รอ operator ตัดสิน
 *
 * invoice-helpers transitively requires invoice-service → prisma-database, which
 * process.exit(1)s without DATABASE_URL on a dev box — so mock prisma-database first
 * (the canonical pattern; the helper logic itself touches no DB).
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const invoiceHelpers = require('../../routes/api/finance/invoice-helpers');

const { invoiceVisibleSide } = invoiceHelpers;

describe('VIS-ACCT-02 invoice side helper — write side only', () => {
  describe('invoiceVisibleSide (ฝั่งที่ด่านเขียน hold/release ยอมให้แตะ — ไม่เปลี่ยน)', () => {
    it('ACCOUNT_DTAM → DTAM only', () => {
      expect(invoiceVisibleSide({ canonicalRole: 'finance_officer_dtam' })).toBe('DTAM');
    });
    it('ACCOUNT_PLATFORM → PLATFORM only', () => {
      expect(invoiceVisibleSide({ canonicalRole: 'finance_officer_platform' })).toBe('PLATFORM');
    });
    it('ADMIN / AUDITOR → null (see both)', () => {
      expect(invoiceVisibleSide({ canonicalRole: 'system_admin_dtam' })).toBeNull();
      expect(invoiceVisibleSide({ canonicalRole: 'field_inspector' })).toBeNull();
    });
  });

  describe('ขาอ่าน: ไม่มีตัวแคบตามบทบาทเหลืออยู่', () => {
    // เดิม: invoiceSideWhere(dtam) → STATE_MATCH · invoiceSideWhere(platform) → { NOT: STATE_MATCH }
    // ใหม่: ตัวช่วยนี้ถูกลบ — ไม่มีทางที่ route จะแคบการอ่านตามบทบาทผ่าน invoice-helpers อีก
    it('invoice-helpers ไม่ส่งออก invoiceSideWhere แล้ว', () => {
      expect(invoiceHelpers.invoiceSideWhere).toBeUndefined();
      expect(Object.keys(invoiceHelpers)).not.toContain('invoiceSideWhere');
    });
  });
});
