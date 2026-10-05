/**
 * มติ operator 2026-09-07 (F-SCOPE-01): ฝ่ายการเงิน "อ่านไม่ได้ จะเห็นแค่ billing หรือ
 * transaction และข้อมูลที่เอาไปทำบัญชีเท่านั้น"
 *
 * มตินั้นถูกบังคับแล้วบน /api/provider/planting-cycles (403 ยืนยันจริงทั้ง demo และ staging)
 * แต่กวาดประตู GET ของพนักงานทั้ง 28 ประตู × 6 บทบาทบน staging เมื่อ 2026-09-07 พบว่า
 * ฝ่ายการเงินยังเปิดตารางนัดตรวจได้ และได้ข้อมูลจริงกลับมา:
 *
 *   GET /api/provider/scheduler/audits/schedules   → 200 · 2 แถว
 *      [{applicationNumber:"APP-2569-MTPZQ1HZ-582D1F", status:"AUDIT_CONFIRMED", …}]
 *
 * นั่นคือ "ผู้ตรวจคนไหนไปฟาร์มไหนวันไหน" — ข้อมูลชนิดเดียวกับที่มติกันการเงินออกจาก
 * planting-cycles ไปแล้ว ไม่ใช่ billing ไม่ใช่ transaction และไม่ใช่ข้อมูลทำบัญชี
 *
 * ต้นเหตุไม่ใช่การลืมใส่การ์ด แต่เป็นการ์ดที่กว้างกว่าที่ชื่อบอก:
 * `PROVIDERRoles` (handlers/shared.js:13) คือ `ROLE_GROUPS.FULL_STAFF` ซึ่ง **รวม
 * account_dtam / account_platform / account ไว้โดยนิยาม** — ประตูจึงอ่านว่า "พนักงานคนไหนก็ได้"
 * คลาสเดียวกับ guards-match-shape-not-declaration
 *
 * และประตูข้างเคียงหนักกว่านั้น: GET /reviewer-assignments/reassignable มีแค่
 * `authenticateProvider` ไม่มีการ์ดบทบาทเลย ทั้งที่ POST ที่ใช้ผลของมันจำกัดไว้ที่
 * scheduler/admin (REASSIGN_ROLES) ⇒ รายชื่อคำขอที่สับเปลี่ยนผู้ตรวจได้ ใครที่ล็อกอิน
 * ฝั่งพนักงานก็อ่านได้หมด
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROLE_GROUPS, CANONICAL_ROLES } = require('../../shared/canonical-rbac');

const FINANCE = [
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    'account',
];
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('กลุ่มบทบาทพูดสิ่งที่ชื่อมันบอก', () => {
    it('AUDIT_STAFF ไม่มีฝ่ายการเงิน', () => {
        const members = ROLE_GROUPS.AUDIT_STAFF.map((r) => String(r).toLowerCase());
        for (const role of FINANCE) { expect(members).not.toContain(String(role).toLowerCase()); }
    });

    it('AUDIT_STAFF ยังมีคนที่ทำงานตรวจครบ — ผู้จัดตาราง ผู้ตรวจแปลง ผู้ตรวจเอกสาร แอดมิน', () => {
        const members = ROLE_GROUPS.AUDIT_STAFF.map((r) => String(r).toLowerCase());
        for (const role of [CANONICAL_ROLES.DISPATCHER, CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]) {
            expect(members).toContain(String(role).toLowerCase());
        }
    });

    it('FULL_STAFF ยังรวมการเงิน — จึงห้ามใช้เฝ้าประตูที่ไม่ใช่เรื่องเงิน', () => {
        const members = ROLE_GROUPS.FULL_STAFF.map((r) => String(r).toLowerCase());
        expect(members).toContain(String(CANONICAL_ROLES.FINANCE_OFFICER_DTAM).toLowerCase());
    });
});

describe('ตารางนัดตรวจไม่ใช่ข้อมูลทำบัญชี', () => {
    it('ประตูอ่านตารางนัดตรวจไม่ได้เฝ้าด้วยกลุ่ม "พนักงานคนไหนก็ได้"', () => {
        const src = read('routes/api/provider/handlers/scheduler-audit-schedules-get-handler.js');
        // ดูเฉพาะรายการ middleware จริง — คอมเมนต์เหนือมันยังเอ่ยชื่อการ์ดเดิมได้
        // และควรเอ่ย เพราะนั่นคือสิ่งที่อธิบายว่าทำไมถึงเปลี่ยน
        const guards = src.slice(
            src.indexOf('const schedulerAuditSchedulesGet'),
            src.indexOf('async (req, res)'),
        ).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
        expect(guards).toContain('ROLE_GROUPS.AUDIT_STAFF');
        expect(guards).not.toMatch(/requireRole\(\s*PROVIDERRoles\s*\)/);
    });
});

describe('รายชื่อคำขอที่สับเปลี่ยนผู้ตรวจได้ ต้องเฝ้าเท่ากับปุ่มที่ใช้มัน', () => {
    const src = read('routes/api/provider/handlers/scheduler-reviewer-reassign-handler.js');

    it('ประตูอ่านมีการ์ดบทบาท ไม่ใช่แค่ยืนยันตัวตน', () => {
        const getBlock = src.slice(src.indexOf('const schedulerReassignableReviewers'),
            src.indexOf('const schedulerReviewerReassign'));
        expect(getBlock).toMatch(/requireRole\(/);
    });

    it('เฝ้าด้วยรายชื่อเดียวกับการกระทำ — scheduler/admin', () => {
        const getBlock = src.slice(src.indexOf('const schedulerReassignableReviewers'),
            src.indexOf('const schedulerReviewerReassign'));
        expect(getBlock).toContain('REASSIGN_ROLES');
    });
});
