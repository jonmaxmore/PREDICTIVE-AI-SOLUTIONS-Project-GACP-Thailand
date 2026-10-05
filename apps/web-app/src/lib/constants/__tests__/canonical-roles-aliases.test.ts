/**
 * P0-E — ตัวปรับค่าบทบาทฝั่งเว็บต้องเข้าถึงได้จริง
 *
 * normalizeRole แปลงค่าเป็นตัวพิมพ์เล็กก่อนค้นตาราง ⇒ คีย์ที่มีตัวพิมพ์ใหญ่จะไม่มีวันถูกใช้
 * เดิมไฟล์นี้ตรึงว่า alias ของคำเก่า (`applicant`, `super_platform_admin`) ยังแปลออก
 *
 * หลัง operator สั่งตัดขาดจากคำเก่า 2026-09-10 ตารางรับเฉพาะคำปัจจุบัน — เทสจึงเปลี่ยน
 * หน้าที่เป็นการตรึงสองข้อ: คำปัจจุบันแปลออกทุกตัวพิมพ์ · คำเก่าแปลไม่ออก
 */

import { normalizeRole, CANONICAL_ROLES } from '../canonical-roles';

describe('P0-E — ตัวปรับค่าบทบาทฝั่งเว็บ', () => {
    const CURRENT = Object.values(CANONICAL_ROLES);

    test('คำปัจจุบันแปลเป็นตัวมันเอง ไม่ว่าตัวพิมพ์ใดหรือมีช่องว่าง', () => {
        for (const role of CURRENT) {
            expect(normalizeRole(role)).toBe(role);
            expect(normalizeRole(role.toUpperCase())).toBe(role);
            expect(normalizeRole(`  ${role}  `)).toBe(role);
        }
    });

    test('คำที่ปลดระวางแล้วแปลไม่ออก — ไม่ใช่ไหลผ่านเป็นคำใกล้เคียง', () => {
        for (const retired of ['applicant', 'Applicant', 'APPLICANT', 'admin', 'super_admin',
            'platform_admin', 'super_platform_admin', 'account', 'account_dtam',
            'account_platform', 'auditor', 'scheduler', 'reviewer']) {
            expect(normalizeRole(retired)).toBeNull();
        }
    });

    test('คำที่ไม่รู้จักคืน null (fail-closed)', () => {
        expect(normalizeRole('superuser')).toBeNull();
        expect(normalizeRole('')).toBeNull();
        expect(normalizeRole(null)).toBeNull();
        expect(normalizeRole(undefined)).toBeNull();
    });

    test('ฝั่งเว็บกับหลังบ้านต้องมีคำชุดเดียวกัน', () => {
        expect(CURRENT.sort()).toEqual([
            'health', 'document_reviewer', 'dispatcher', 'field_inspector',
            'certificate_approver', 'finance_officer_dtam', 'system_admin_dtam',
            'finance_officer_platform', 'system_admin_platform', 'system',
        ].sort());
    });
});
