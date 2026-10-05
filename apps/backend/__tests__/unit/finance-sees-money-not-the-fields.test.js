/**
 * มติ operator 2026-09-07 (ปิด F-SCOPE-01): ฝ่ายการเงิน "อ่านไม่ได้ จะเห็นแค่ billing หรือ
 * transaction และข้อมูลที่เอาไปทำบัญชีเท่านั้น"
 *
 * ที่มา: วัดจากประตูจริงทุกตำแหน่ง — บัญชีทั้งสองฝั่งอ่าน `/api/provider/planting-cycles`
 * ซึ่งเป็นรอบปลูกของฟาร์มทุกแห่งทั่วประเทศ ได้ 200 เท่ากับผู้ตรวจแปลง
 *
 * ต้นเหตุ: ประตูนั้นเฝ้าด้วย `APPLICATION_VIEW_ALL` ซึ่งฝ่ายการเงินถือไว้โดยชอบ (ต้องเห็นคำขอ
 * ทุกใบเพื่อออกใบแจ้งหนี้) — สิทธิ์มีอยู่จริง แต่มัน **ไม่ได้พูดเรื่องเดียวกับข้อมูลที่มันเฝ้า**:
 * "ดูใบสมัครทั้งหมด" ไม่เท่ากับ "ดูไทม์ไลน์การเพาะปลูก ตำแหน่งแปลง และรหัสแปลงของทุกฟาร์ม"
 * เป็นคลาสเดียวกับ guards-match-shape-not-declaration
 *
 * แก้โดยแยกสิทธิ์ของประตูตามสอบย้อนกลับออกมาเอง แทนที่จะถอด APPLICATION_VIEW_ALL ออกจาก
 * ฝ่ายการเงิน — ถอดแบบนั้นจะทำให้ออกใบแจ้งหนี้ไม่ได้ ซึ่งเป็นงานของเขาจริง ๆ
 */
'use strict';

const { PERMISSIONS, CANONICAL_ROLES, hasPermission } = require('../../shared/canonical-rbac');

/** ถามผ่านประตูจริงที่ middleware ใช้ ไม่ใช่อ่านตารางข้างใน */
const holders = (permission) => Object.values(CANONICAL_ROLES)
    .filter((role) => hasPermission(role, permission))
    .sort();

describe('ขอบเขตของฝ่ายการเงิน — เห็นเงิน ไม่เห็นแปลง', () => {
    it('มีสิทธิ์เฉพาะของประตูตามสอบย้อนกลับ แยกจากสิทธิ์ดูคำขอ', () => {
        expect(PERMISSIONS.TRACKING_VIEW_ALL).toBeDefined();
        expect(PERMISSIONS.TRACKING_VIEW_ALL).not.toBe(PERMISSIONS.APPLICATION_VIEW_ALL);
    });

    it('ฝ่ายการเงินทั้งสองฝั่งไม่ถือสิทธิ์ตามสอบย้อนกลับ', () => {
        const who = holders(PERMISSIONS.TRACKING_VIEW_ALL);
        expect(who).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(who).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
    });

    it('คนที่ทำงานติดตามยังถือสิทธิ์นั้นอยู่', () => {
        const who = holders(PERMISSIONS.TRACKING_VIEW_ALL);
        expect(who).toContain(CANONICAL_ROLES.FIELD_INSPECTOR);
        expect(who).toContain(CANONICAL_ROLES.DOCUMENT_REVIEWER);
        expect(who).toContain(CANONICAL_ROLES.DISPATCHER);
        expect(who).toContain(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
    });

    it('ฝ่ายการเงินยังเห็นคำขอทุกใบ — เพราะออกใบแจ้งหนี้ต้องใช้', () => {
        const who = holders(PERMISSIONS.APPLICATION_VIEW_ALL);
        expect(who).toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(who).toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
    });

    it('ฝ่ายการเงินยังเห็นแดชบอร์ดบัญชีและใบแจ้งหนี้เหมือนเดิม', () => {
        for (const role of [CANONICAL_ROLES.FINANCE_OFFICER_DTAM, CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]) {
            expect(hasPermission(role, PERMISSIONS.ACCOUNTING_DASHBOARD_READ)).toBe(true);
            expect(hasPermission(role, PERMISSIONS.INVOICE_VIEW_ALL)).toBe(true);
        }
        // operator 2026-09-27 "กรมฯ ดูอย่างเดียว": ออกใบเสร็จ/ระงับใบแจ้งหนี้เป็นของการเงินบริษัทเท่านั้น
        // (เดิม: ทั้งสองบทบาท RECEIPT_ISSUE = true)
        expect(hasPermission(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM, PERMISSIONS.RECEIPT_ISSUE)).toBe(true);
        expect(hasPermission(CANONICAL_ROLES.FINANCE_OFFICER_DTAM, PERMISSIONS.RECEIPT_ISSUE)).toBe(false);
    });

    it('ประตูตามสอบย้อนกลับเฝ้าด้วยสิทธิ์ใหม่ ไม่ใช่สิทธิ์ดูคำขอ', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'provider', 'handlers', 'planting.js'),
            'utf8',
        );
        expect(src).toContain('PERMISSIONS.TRACKING_VIEW_ALL');
        expect(src).not.toContain('PERMISSIONS.APPLICATION_VIEW_ALL');
    });
});
