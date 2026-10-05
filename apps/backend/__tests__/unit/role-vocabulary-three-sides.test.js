'use strict';
/**
 * คำศัพท์บทบาทตามโมเดลสามฝั่ง — operator 2026-09-10 (รอบที่สองของวัน)
 *
 * ตารางที่ operator ให้ไว้:
 *
 *   ผู้รับบริการ  ผู้ขอรับรอง 3 นิติฐานะ            health (คำของหมอพร้อม — ห้ามเปลี่ยน)
 *   กรม           บุคลากรในสังกัดที่กรมอนุญาต        DOCUMENT_REVIEWER · DISPATCHER ·
 *                                                  FIELD_INSPECTOR · CERTIFICATE_APPROVER
 *   บริษัท        พนักงานบริษัท                     FINANCE_OFFICER · SYSTEM_ADMIN
 *
 * แก้เพิ่มระหว่างสนทนา: **FINANCE และ ADMIN มีทั้งของกรมและของบริษัท** ⇒ ทั้งสองตระกูล
 * เป็นคู่สมมาตร `_dtam` / `_platform` เหมือนที่ `account_dtam`/`account_platform`
 * เป็นอยู่แล้ว · ไม่มีตัวชื่อเปล่า เพราะโค้ดเดิมบันทึกไว้เองว่าตัวเปล่า `account`
 * เป็นปัญหา — `ROLE_AFFILIATION_BY_ROLE` ตอบ null ให้มันเพราะ "สังกัดตัดสินไม่ได้"
 *
 * ── ทำไมต้องเป็นเทส ไม่ใช่การไล่แก้ให้ครบแล้วหวังว่าถูก ──
 *
 * ตารางในไฟล์บทบาทถูก **key ด้วยค่า** ไม่ใช่ด้วยคีย์ (`[CANONICAL_ROLES.X]: ...`)
 * พอสองคีย์ชี้ค่าเดียวกันหลังยุบคำ มันกลายเป็น duplicate key ที่ตัวหลังทับตัวหน้า
 * **เงียบ ๆ ไม่มี error** · จุดที่อันตรายที่สุดคือ `[ACCOUNT]: null` ซึ่งจะทับสังกัดของ
 * `account_platform` ให้กลายเป็น null ถ้าปล่อยไว้ ⇒ ทุก assertion ข้างล่างมีไว้จับเรื่องนี้
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const {
    CANONICAL_ROLES,
    ROLE_PERMISSIONS,
    ROLE_AFFILIATIONS,
    PROVIDER_CANONICAL_ROLES,
    normalizeRole,
    roleAffiliation,
} = require('../../shared/canonical-rbac');

/** คำที่ระบบเขียนลงฐานข้อมูลได้ตั้งแต่นี้ไป — ไม่มีคำอื่น */
const TARGET_VOCABULARY = Object.freeze([
    'health',
    'document_reviewer',
    'dispatcher',
    'field_inspector',
    'certificate_approver',
    'finance_officer_dtam',
    'system_admin_dtam',
    'finance_officer_platform',
    'system_admin_platform',
    'system',
]);

/** ฝั่งของแต่ละบทบาท — ตารางของ operator */
const SIDE_OF = Object.freeze({
    health: 'public',
    document_reviewer: 'certification_body',
    dispatcher: 'certification_body',
    field_inspector: 'certification_body',
    certificate_approver: 'certification_body',
    finance_officer_dtam: 'certification_body',
    system_admin_dtam: 'certification_body',
    finance_officer_platform: 'platform_operator',
    system_admin_platform: 'platform_operator',
    system: 'system',
});

describe('คำศัพท์บทบาทสามฝั่ง — ค่าที่เขียนลงฐาน', () => {
    test('ทุกค่าใน CANONICAL_ROLES อยู่ในคำศัพท์เป้าหมาย ไม่มีคำนอกรายการหลงเหลือ', () => {
        const stray = [...new Set(Object.values(CANONICAL_ROLES))]
            .filter((v) => !TARGET_VOCABULARY.includes(v));
        expect(stray).toEqual([]);
    });

    test('คำเป้าหมายทุกคำมีคนอ้างถึงจริง — ไม่ประกาศคำที่ไม่มีใครใช้', () => {
        const values = new Set(Object.values(CANONICAL_ROLES));
        const missing = TARGET_VOCABULARY.filter((w) => !values.has(w));
        expect(missing).toEqual([]);
    });

    test('คีย์ที่ตารางของ operator ระบุ ต้องมีอยู่และชี้คำที่ถูก', () => {
        expect(CANONICAL_ROLES.HEALTH).toBe('health');
        expect(CANONICAL_ROLES.FINANCE_OFFICER_DTAM).toBe('finance_officer_dtam');
        expect(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM).toBe('finance_officer_platform');
        expect(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM).toBe('system_admin_dtam');
        expect(CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM).toBe('system_admin_platform');
    });
});

describe('normalizeRole — ตัดขาดจากคำเก่า (operator 2026-09-10: "เลิกใช้ของเก่า รวมถึงการพูดถึงของเก่า")', () => {
    /**
     * ไม่มี alias ของคำเก่าอีกต่อไป · ทำได้เพราะทั้งสามฐานถูกล้างและ seed ใหม่ในวันเดียวกัน
     * ⇒ ไม่มีแถวเก่าให้ต้องแปล และ token ที่ค้างอยู่เป็นของบัญชี seed เท่านั้น
     *
     * เทสนี้เป็นด่านกันของเก่าไหลกลับ: ถ้าใครเติม alias กลับเข้าไป มันจะแดงทันที
     */
    const RETIRED = [
        'farmer',
        'auditor', 'head_auditor', 'inspector', 'audit',
        'scheduler', 'reviewer', 'reviewer_auditor',
        'approver', 'final_approver',
        'account', 'accountant', 'finance',
        'account_dtam', 'accountant_dtam', 'dtam_account', 'finance_dtam',
        'account_platform', 'accountant_platform', 'platform_account', 'finance_platform',
        'admin', 'super_admin',
        'platform_admin', 'platform_owner',
    ];

    test.each(RETIRED)('คำที่ปลดระวางแล้วต้องแปลไม่ออก: %s', (raw) => {
        expect(normalizeRole(raw)).toBeNull();
    });

    const CURRENT = [
        'health', 'document_reviewer', 'dispatcher', 'field_inspector',
        'certificate_approver', 'finance_officer_dtam', 'finance_officer_platform',
        'system_admin_dtam', 'system_admin_platform', 'system',
    ];

    test.each(CURRENT)('คำปัจจุบันแปลเป็นตัวมันเอง (แผนที่ปิด): %s', (raw) => {
        expect(normalizeRole(raw)).toBe(raw);
    });

    test('ตัวพิมพ์ใหญ่และช่องว่างหน้าหลังยังต้องแปลออก', () => {
        expect(normalizeRole('  Finance_Officer_Platform  ')).toBe('finance_officer_platform');
        expect(normalizeRole('SYSTEM_ADMIN_DTAM')).toBe('system_admin_dtam');
    });

    test('webhook/cron ยังเป็น system — ไม่ใช่คำเก่า แต่เป็นชื่อเรียกผู้กระทำที่ไม่ใช่คน', () => {
        expect(normalizeRole('webhook')).toBe('system');
        expect(normalizeRole('cron')).toBe('system');
    });
});

describe('ไม่มีคีย์ของเก่าเหลือใน CANONICAL_ROLES', () => {
    const RETIRED_KEYS = [
        'AUDITOR', 'HEAD_AUDITOR', 'AUDIT', 'SCHEDULER',
        'ACCOUNT', 'ACCOUNT_DTAM', 'ACCOUNT_PLATFORM', 'ADMIN', 'PLATFORM_ADMIN',
    ];

    test.each(RETIRED_KEYS)('CANONICAL_ROLES.%s ต้องไม่มีแล้ว', (key) => {
        expect(CANONICAL_ROLES[key]).toBeUndefined();
    });
});

describe('สังกัด — ตารางสามฝั่งของ operator ต้องตอบได้ทุกบทบาท ไม่มี null', () => {
    test('ROLE_AFFILIATIONS มีสามฝั่งของคน + system', () => {
        expect(ROLE_AFFILIATIONS.PUBLIC).toBe('public');
        expect(ROLE_AFFILIATIONS.CERTIFICATION_BODY).toBe('certification_body');
        expect(ROLE_AFFILIATIONS.PLATFORM_OPERATOR).toBe('platform_operator');
    });

    test.each(Object.entries(SIDE_OF))('roleAffiliation(%s) -> %s', (role, side) => {
        expect(roleAffiliation(role)).toBe(side);
    });

    test('ไม่มีบทบาทใดตอบ null — null คืออาการของ duplicate key ที่ทับกันเงียบ ๆ', () => {
        const nulls = TARGET_VOCABULARY.filter((r) => roleAffiliation(r) === null);
        expect(nulls).toEqual([]);
    });

    test('การเงินสองฝั่งอยู่คนละสังกัด — ด่านแยกหน้าที่ VIS-ACCT-02 พึ่งข้อนี้', () => {
        expect(roleAffiliation('finance_officer_dtam'))
            .not.toBe(roleAffiliation('finance_officer_platform'));
    });

    test('ผู้ดูแลสองฝั่งอยู่คนละสังกัด — ขอบเขตข้ามองค์กรพึ่งข้อนี้', () => {
        expect(roleAffiliation('system_admin_dtam'))
            .not.toBe(roleAffiliation('system_admin_platform'));
    });
});

describe('ตารางที่ key ด้วยค่า — ต้องไม่มีช่องหายหลังยุบคำ', () => {
    test('ROLE_PERMISSIONS มีรายการให้ทุกบทบาทที่เป็นคน', () => {
        const humans = TARGET_VOCABULARY.filter((r) => r !== 'system');
        const missing = humans.filter((r) => !ROLE_PERMISSIONS[r]);
        expect(missing).toEqual([]);
    });

    test('บทบาทเจ้าหน้าที่ทั้งหกอยู่ใน PROVIDER_CANONICAL_ROLES', () => {
        const staff = [
            'document_reviewer', 'dispatcher', 'field_inspector', 'certificate_approver',
            'finance_officer_dtam', 'finance_officer_platform',
            'system_admin_dtam', 'system_admin_platform',
        ];
        const missing = staff.filter((r) => !PROVIDER_CANONICAL_ROLES.has(r));
        expect(missing).toEqual([]);
    });

    test('ผู้ขอรับรองไม่ใช่เจ้าหน้าที่', () => {
        expect(PROVIDER_CANONICAL_ROLES.has('health')).toBe(false);
    });
});

describe('ฝั่งเว็บต้องพูดคำเดียวกับหลังบ้าน', () => {
    test('canonical-roles.ts มีค่าตรงกับ CANONICAL_ROLES ทุกคำเป้าหมาย', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../web-app/src/lib/constants/canonical-roles.ts'),
            'utf8',
        );
        const missing = TARGET_VOCABULARY.filter((w) => !src.includes(`'${w}'`));
        expect(missing).toEqual([]);
    });

    test('ไม่มีคำที่ปลดระวางแล้วเหลือเป็นค่าในไฟล์ฝั่งเว็บ', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../web-app/src/lib/constants/canonical-roles.ts'),
            'utf8',
        );
        const retired = ["'account'", "'account_dtam'", "'account_platform'",
            "'admin'", "'platform_admin'"];
        const stillThere = retired.filter((w) => src.includes(w));
        expect(stillThere).toEqual([]);
    });
});
