/**
 * รายการบทบาทของดรอปดาวน์ใน /admin/*
 *
 * เขียนใหม่ 2026-09-10 หลัง operator สั่งตัดขาดจากคำเก่า — ไฟล์เดิมตรึงสามอย่างที่
 * ไม่มีอยู่แล้ว: แถว `ACCOUNT` (คำเปล่า) พร้อมธง `isLegacy`, ค่าตัวพิมพ์ใหญ่ยุคก่อนใน
 * ช่อง `value`, และการนับ "10 บทบาท" ที่รวมคำเปล่าเข้าไปด้วย
 *
 * สิ่งที่ยังต้องตรึง และเป็นเหตุผลที่ไฟล์นี้มีอยู่ตั้งแต่แรก: ทุกบทบาทที่แต่งตั้งได้ต้อง
 * ปรากฏในดรอปดาวน์ — บทบาทที่ตกหล่นแปลว่าผู้ดูแลแต่งตั้งคนไปทำงานนั้นไม่ได้เลย
 * (อาการเดิม: Tier 16 แยกฝ่ายบัญชีแล้วสามหน้าจอไม่มีตัวเลือกใหม่)
 */

import {
    ADMIN_ROLE_OPTIONS,
    ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX,
    ADMIN_ROLE_OPTIONS_FOR_NEW_USER,
} from '../admin-role-options';
import { CANONICAL_ROLES } from '../canonical-roles';

describe('admin-role-options — รายการบทบาทของดรอปดาวน์', () => {
    it('ทุกบทบาทที่แต่งตั้งได้อยู่ในรายการ', () => {
        const values = ADMIN_ROLE_OPTIONS.map((o) => o.value).sort();
        expect(values).toEqual([
            CANONICAL_ROLES.CERTIFICATE_APPROVER,
            CANONICAL_ROLES.DISPATCHER,
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            CANONICAL_ROLES.HEALTH,
            CANONICAL_ROLES.SYSTEM,
            CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
        ].sort());
    });

    it('ผู้ดูแลของบริษัทไม่อยู่ในรายการโดยเจตนา — ต้องตั้งนอกประตูนี้', () => {
        const values = ADMIN_ROLE_OPTIONS.map((o) => o.value);
        expect(values).not.toContain(CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM);
    });

    it('`value` กับ `canonical` เป็นคำเดียวกันทุกแถว', () => {
        const mismatched = ADMIN_ROLE_OPTIONS
            .filter((o) => o.value !== o.canonical)
            .map((o) => o.value);
        expect(mismatched).toEqual([]);
    });

    it('ทุกแถวมีป้ายภาษาไทย', () => {
        const noLabel = ADMIN_ROLE_OPTIONS.filter((o) => !o.label || !/[ก-๙]/.test(o.label));
        expect(noLabel).toEqual([]);
    });

    it('ไม่มีค่าซ้ำ', () => {
        const values = ADMIN_ROLE_OPTIONS.map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
    });

    it('ไม่มีคำที่ปลดระวางแล้วหลงเหลือ', () => {
        const retired = ['admin', 'account', 'account_dtam', 'account_platform',
            'platform_admin', 'auditor', 'scheduler', 'ADMIN', 'ACCOUNT'];
        const found = ADMIN_ROLE_OPTIONS
            .map((o) => o.value)
            .filter((v) => retired.includes(v));
        expect(found).toEqual([]);
    });

    it('บทบาทที่ไม่ใช่คนถูกซ่อน และมีตัวเดียว', () => {
        const hidden = ADMIN_ROLE_OPTIONS.filter((o) => o.hidden);
        expect(hidden.map((o) => o.value)).toEqual([CANONICAL_ROLES.SYSTEM]);
    });
});

describe('ตัวแปรของแต่ละหน้าจอ', () => {
    it('ตัวกรองมี "ทุกบทบาท" เป็นแถวแรก และไม่มีแถวที่ซ่อนไว้', () => {
        expect(ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX[0].value).toBe('ALL');
        expect(ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX.some((o) => o.hidden)).toBe(false);
        expect(ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX).toHaveLength(
            ADMIN_ROLE_OPTIONS.filter((o) => !o.hidden).length + 1,
        );
    });

    it('หน้าสร้างผู้ใช้ไม่มีบทบาทที่ไม่ใช่คน', () => {
        expect(ADMIN_ROLE_OPTIONS_FOR_NEW_USER.some((o) => o.hidden)).toBe(false);
        expect(ADMIN_ROLE_OPTIONS_FOR_NEW_USER.map((o) => o.value))
            .not.toContain(CANONICAL_ROLES.SYSTEM);
    });

    it('การเงินทั้งสองฝั่งเลือกได้ตอนสร้างผู้ใช้ — ถ้าตกหล่นจะแต่งตั้งคนฝั่งนั้นไม่ได้', () => {
        const values = ADMIN_ROLE_OPTIONS_FOR_NEW_USER.map((o) => o.value);
        expect(values).toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(values).toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
    });

    it('ผู้อนุมัติใบรับรองเลือกได้ — ถ้าตกหล่นจะไม่มีใครอนุมัติคำขอได้เลย', () => {
        expect(ADMIN_ROLE_OPTIONS_FOR_NEW_USER.map((o) => o.value))
            .toContain(CANONICAL_ROLES.CERTIFICATE_APPROVER);
    });
});
