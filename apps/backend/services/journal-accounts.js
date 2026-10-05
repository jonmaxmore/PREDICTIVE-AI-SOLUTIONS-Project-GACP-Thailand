'use strict';

/**
 * The journal's chart of accounts — a LEAF module (it requires nothing).
 *
 * Moved out of services/journal-entry-service.js (fix round 2 of the
 * bangkok-time port, 2026-09-26) to break a require cycle:
 *
 *   period-close-service → vat-report-service → journal-entry-service
 *     → journal-entry-period-guard → period-close-service
 *
 * vat-report-service needed only ACCOUNTS from journal-entry-service. Through
 * the cycle, whichever module loaded first handed another a half-built module:
 * the period guard failed OPEN (posts into a CLOSED period went through), or,
 * in server start-up order, vat-report-service threw while loading and
 * closePeriod skipped its "no PENDING invoices" precondition. Both were on main.
 * journal-entry-service re-exports this same object, so every existing
 * `require('./journal-entry-service').ACCOUNTS` still reads it.
 */

const ACCOUNTS = Object.freeze({
    // Asset
    CASH_BANK: { code: '1110-001', name: 'เงินสด/เงินฝากธนาคาร · บัญชีหลัก' },
    // Liability
    VAT_PAYABLE_OUTPUT: { code: '2131-001', name: 'ภาษีขายตั้งพัก (Output VAT 7%)' },
    // ไม่มีเจ้าหนี้กรมฯ (2151-001) และไม่มีต้นทุนค่าธรรมเนียมกรมฯ (5110-001) ในผังนี้แล้ว —
    // มติ operator 2026-09-29: บริษัทชำระกับกรมฯ นอกระบบ และลงบัญชีในสมุดบัญชีของบริษัทเอง
    // แพลตฟอร์มลงเฉพาะค่าบริการ (4110-001) กับ VAT ของมัน (2131-001)
    // Revenue — ค่าบริการก้อนเดียวที่เกษตรกรจ่าย (ไม่รวม VAT) · ชื่อบัญชีไม่ได้หมายถึง "ส่วน 10%" อีกแล้ว
    REVENUE_PLATFORM_FEE: { code: '4110-001', name: 'รายได้ค่าบริการ' },
});

module.exports = { ACCOUNTS };
