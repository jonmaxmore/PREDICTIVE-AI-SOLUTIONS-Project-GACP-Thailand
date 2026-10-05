'use strict';

/**
 * Role writers produce the canonical spelling — PR 2e (contract phase).
 *
 * Migration 20260801000000 canonicalised `users.role` to lowercase and set the
 * column default to 'health'. #710 shipped the EXPAND half alongside it:
 * eleven production role filters were widened via `dbRoleValuesFor()` so they
 * match both spellings while rows of each exist.
 *
 * What #710 deliberately did NOT do is change the writers. Four of them still
 * call `canonicalToLegacyRole()` and put the UPPERCASE legacy spelling back
 * into the column the migration had just cleaned:
 *
 *   services/prisma-auth-service.js:218    every self-registration + provider signup
 *   services/provider-user-service.js:142  every provider account created by an admin
 *   services/admin-user-service.js:447     every admin-driven role change
 *   routes/api/admin/users.js:430          the same, through the route
 *
 * Left alone, the migration is a one-off tidy-up that immediately starts
 * re-dirtying: every new officer account lands uppercase again, and the widened
 * filters can never be narrowed because they are still carrying live data.
 *
 * This was the contract phase. The writers moved to canonical here; the
 * filters stayed widened until the production migration was confirmed
 * (UPDATE 23, zero legacy rows), after which they narrowed too — see
 * role-filters-canonical-only.test.js for the final state.
 *
 * The three assertions that matter are DTAM accountants, schedulers and the
 * waiver approver. Each is a fail-closed or fan-out path where a filter miss
 * produces an EMPTY RESULT rather than an error: payment slips silently stop
 * reaching DTAM, notifications silently stop reaching schedulers, and the
 * waiver approval silently rejects the one person allowed to grant it.
 */

const fs = require('fs');
const path = require('path');

const { CANONICAL_ROLES, normalizeRole } = require('../../shared/canonical-rbac');

const BACKEND_ROOT = path.join(__dirname, '../..');

/** The four sites that put a value into `User.role`. */
const WRITE_SITES = [
    'services/prisma-auth-service.js',
    'services/provider-user-service.js',
    'services/admin-user-service.js',
    'routes/api/admin/users.js',
];

/**
 * `shared/user-groups.js` also called canonicalToLegacyRole, to WIDEN a read
 * (`role: { in: roleCandidates }`) — the expand half doing its job while rows
 * of both spellings existed. The production migration confirmed zero legacy
 * rows remain, so the widener narrowed to the canonical value alone.
 *
 * routes/api/system/provider.js still calls the function legitimately: it
 * serves the role picker's option VALUES, which are the WIRE contract the
 * Flutter client speaks — not a DB filter. It doubles here as the sentinel
 * proving the comment stripper is not eating real code.
 */
const WIRE_CONTRACT_CALLER = 'routes/api/system/provider.js';

function read(rel) {
    return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');
}

/**
 * Strip comments before checking for the call. A comment explaining why the
 * conversion was removed is the documentation for this change — flagging it
 * would push the next person to delete the explanation to satisfy the gate.
 */
function readCode(rel) {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('ไม่มีจุดเขียนไหนพูดคำเก่า', () => {
    /**
     * เดิมข้อนี้ตรวจว่าไม่มีใครเรียก `canonicalToLegacyRole()` ซึ่งเป็นฟังก์ชันที่แปลง
     * คำมาตรฐาน**กลับ**เป็นตัวพิมพ์ใหญ่ยุคก่อนก่อนเขียนลงฐาน · ฟังก์ชันนั้นถูกลบทิ้งแล้ว
     * ตอนตัดขาดจากคำเก่า (2026-09-10) ⇒ ข้อเดิมกลายเป็นจริงโดยโครงสร้าง
     *
     * สิ่งที่ยังต้องเฝ้าคือคำเก่าที่ถูกพิมพ์เป็นตัวอักษรตรง ๆ ในจุดเขียน ซึ่งจะทำให้แถวใหม่
     * ถือค่าที่ normalizeRole ปฏิเสธ — บัญชีที่สร้างแล้วล็อกอินไม่ได้ตั้งแต่วันแรก
     */
    const RETIRED_WORDS = [
        'admin', 'super_admin', 'platform_admin', 'account', 'accountant',
        'account_dtam', 'account_platform', 'auditor', 'head_auditor', 'scheduler',
        'reviewer_auditor', 'approver', 'final_approver',
    ];

    test.each(WRITE_SITES)('%s ไม่มีคำที่ปลดระวางแล้วเป็นค่าตัวอักษร', (rel) => {
        const code = readCode(rel);
        const found = RETIRED_WORDS.filter((w) => code.includes(`'${w}'`) || code.includes(`"${w}"`));
        expect({ file: rel, found }).toEqual({ file: rel, found: [] });
    });

    test('ตัวตัดคอมเมนต์ยังทำงาน — ไม่ได้กินโค้ดทิ้งจนข้อข้างบนเป็นจริงเปล่า ๆ', () => {
        expect(readCode('services/prisma-auth-service.js')).toContain('normalizeRole');
        expect(readCode('services/provider-user-service.js')).toContain('isProviderRole');
    });

    test('ฟังก์ชันแปลงกลับเป็นคำเก่าไม่มีอยู่ในระบบแล้ว', () => {
        const rbac = readCode('shared/canonical-rbac.js');
        expect(rbac).not.toMatch(/function\s+canonicalToLegacyRole/);
    });
});

describe('the canonical vocabulary is lowercase', () => {
    // Stated explicitly because the directive that prompted this work asked for
    // UPPERCASE. The migration and the SSOT both say otherwise, and writing
    // uppercase would invert a migration already applied in production.
    test.each(Object.entries(CANONICAL_ROLES))('CANONICAL_ROLES.%s is lowercase', (_key, value) => {
        expect(value).toBe(value.toLowerCase());
    });

    test('normalizeRole returns the canonical lowercase form for legacy input', () => {
        expect(normalizeRole('finance_officer_dtam')).toBe('finance_officer_dtam');
        // รีเนม 2026-09-10: คำเดิมยังรับได้ แต่ผลลัพธ์คือคำใหม่
        expect(normalizeRole('dispatcher')).toBe('dispatcher');
        expect(normalizeRole('system_admin_platform')).toBe('system_admin_platform');
        expect(normalizeRole('  Dispatcher  ')).toBe('dispatcher');
    });
});

describe('the routing-critical roles survive the writer flip', () => {
    /**
     * These three are the silent-drop paths. A filter that misses them returns
     * an empty list, and every caller treats empty as "nobody to notify" or
     * "not authorised" rather than as an error.
     */
    const CRITICAL = [
        { canonical: 'finance_officer_dtam', why: 'สลิปค่าธรรมเนียมรัฐต้องถึงการเงินฝั่งกรม' },
        { canonical: 'dispatcher', why: 'แจ้งเตือนต้องถึงผู้จัดสรรงาน' },
        { canonical: 'system_admin_platform', why: 'ด่านผู้อนุมัติคำผ่อนผัน fail-closed' },
    ];

    /**
     * ก่อน 2026-09-10 ตัวกรองถูก "ขยาย" ด้วย dbRoleValuesFor() ให้รับทั้งคำเก่าและคำใหม่
     * เพราะแถวในฐานมีสองสะกดพร้อมกันระหว่างย้าย · หลัง operator สั่งตัดขาดจากคำเก่า
     * มีสะกดเดียวต่อบทบาท ⇒ ตัวช่วยขยายไม่มีเหตุผลให้มีอยู่ และถูกลบไปพร้อมกัน
     *
     * สิ่งที่ยังต้องจริงคือข้อเดิม: **ผู้เขียนทั้งสี่จุดเขียนคำมาตรฐานเท่านั้น**
     */
    test.each(CRITICAL)('$canonical เป็นคำมาตรฐานที่ตัวกรองใช้ตรง ๆ — $why', ({ canonical }) => {
        expect(normalizeRole(canonical)).toBe(canonical);
    });

    test('ทุกบทบาทเป็นจุดตรึงของตัวเอง — ไม่มีสะกดที่สองให้ตัวกรองต้องเผื่อ', () => {
        const notFixed = [...new Set(Object.values(CANONICAL_ROLES))]
            .filter((role) => normalizeRole(role) !== role);
        expect(notFixed).toEqual([]);
    });

    test('สะกดตัวพิมพ์ใหญ่ของคำเดิมต้องแปลไม่ออกแล้ว', () => {
        for (const role of Object.values(CANONICAL_ROLES)) {
            expect(normalizeRole(role.toUpperCase())).toBe(role);
        }
        for (const retired of ['ADMIN', 'ACCOUNT', 'AUDITOR', 'SCHEDULER', 'PLATFORM_ADMIN']) {
            expect(normalizeRole(retired)).toBeNull();
        }
    });
});
