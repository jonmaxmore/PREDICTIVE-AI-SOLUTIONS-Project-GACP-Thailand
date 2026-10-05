'use strict';

/**
 * W4 review round (2026-08-22) — a seed fixture must not undo an operator's
 * migration.
 *
 * The first cut of the W4 fix put `role` into every upsert `update:` clause so
 * a re-seed would repair rows holding the pre-20260801000000 legacy spellings.
 * An upsert update is UNCONDITIONAL, and the finance officer's fixture names
 * the legacy union role 'finance_officer_platform'. So on any database where
 * `scripts/migrate-account-role.js` had already split ACCOUNT into
 * ACCOUNT_DTAM / ACCOUNT_PLATFORM — one audit-logged decision per account —
 * the next `node prisma/seed-gacp.js` would have silently reverted it, with no
 * audit row and nothing in the seed output to notice.
 *
 * The repair is therefore narrowed to what it honestly is: a SPELLING repair.
 * Same canonical role, canonical spelling. Anything that normalises to a
 * DIFFERENT canonical role is left exactly where the operator put it.
 */

const fs = require('fs');
const path = require('path');

const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');
const { resolveRoleSpellingRepair } = require('../../shared/role-spelling-repair');

describe('resolveRoleSpellingRepair — ซ่อมการสะกด ไม่ตัดสินใจแทนคน', () => {
    test('แถวที่ถือบทบาทคนละตัวกับที่ seed ตั้งใจ ต้องไม่ถูกทับ', () => {
        // เหตุผลที่ไฟล์นี้มีอยู่: การเลือกข้างของฝ่ายบัญชีเป็นการตัดสินใจที่มีบันทึก
        // ไม่ใช่การสะกด · seed ต้องไม่ย้ายข้างให้ใครเงียบ ๆ ตอน re-seed
        const r = resolveRoleSpellingRepair('finance_officer_dtam', 'finance_officer_platform');
        expect(r.write).toBeNull();
        expect(r.reason).toContain('DIFFERENT_ROLE_LEAVE_ALONE');
    });

    test('การสะกดต่างตัวพิมพ์ของบทบาทเดียวกัน ถูกซ่อม', () => {
        expect(resolveRoleSpellingRepair('FINANCE_OFFICER_PLATFORM', CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM).write)
            .toBe(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        expect(resolveRoleSpellingRepair('HEALTH', CANONICAL_ROLES.HEALTH).write)
            .toBe(CANONICAL_ROLES.HEALTH);
        expect(resolveRoleSpellingRepair('  Document_Reviewer  ', CANONICAL_ROLES.DOCUMENT_REVIEWER).write)
            .toBe(CANONICAL_ROLES.DOCUMENT_REVIEWER);
    });

    test('ค่าที่ตอนนี้แปลไม่ออกแล้ว ต้องไม่ถูกทับ — ไม่ใช่ของที่เดาได้', () => {
        // หลังตัดขาดจากคำเก่า 2026-09-10 คำอย่าง 'ACCOUNT' หรือ 'auditor' แปลไม่ออก
        // การเขียนทับมันคือการเดาว่าเจ้าของแถวตั้งใจอะไร ซึ่งเป็นสิ่งที่ไฟล์นี้ห้าม
        for (const stored of ['ACCOUNT', 'auditor', 'platform_admin', 'COORDINATOR']) {
            expect(resolveRoleSpellingRepair(stored, CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM).write).toBeNull();
        }
    });

    test('ค่าที่เป็นคำมาตรฐานอยู่แล้ว ไม่ต้องเขียนซ้ำ', () => {
        const r = resolveRoleSpellingRepair(CANONICAL_ROLES.DISPATCHER, CANONICAL_ROLES.DISPATCHER);
        expect(r.write).toBeNull();
        expect(r.reason).toContain('ALREADY_CANONICAL');
    });
});

describe('seed-gacp.js routes every role repair through the guard', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../..', 'prisma/seed-gacp.js'), 'utf8',
    );

    test('no upsert `update:` clause writes role', () => {
        // The unconditional write is the bug. Every `update: { … }` block in the
        // seed must be free of `role`, whatever else it refreshes.
        const updateClauses = [...source.matchAll(/\n\s*update: \{[\s\S]*?\n\s*\},/g)].map((m) => m[0]);
        expect(updateClauses.length).toBeGreaterThanOrEqual(3); // applicants, admin, officers
        for (const clause of updateClauses) {
            expect(clause).not.toMatch(/\brole\s*:/);
        }
    });

    test('each seeded account is passed through repairSeededUserRow', () => {
        expect(source).toMatch(/repairSeededUserRow\(user, CANONICAL_ROLES\.HEALTH/);
        expect(source).toMatch(/repairSeededUserRow\(admin, CANONICAL_ROLES\.SYSTEM_ADMIN_DTAM/);
        expect(source).toMatch(/repairSeededUserRow\(officer, o\.role/);
    });

    test('a failed personal-entity ensure does not abort the whole seed', () => {
        // One unrepairable applicant must not take the admin, the officers and
        // every fixture down with it.
        const applicantBlock = source.match(/for \(const a of APPLICANTS\)[\s\S]*?\n {4}\}/);
        expect(applicantBlock).not.toBeNull();
        expect(applicantBlock[0]).toMatch(/try \{[\s\S]*ensurePersonalIndividualEntity[\s\S]*\} catch/);
    });

    test('a null organizationId is repaired rather than left to abort the seed', () => {
        expect(source).toMatch(/if \(!user\.organizationId && defaultOrgId\)/);
        expect(source).toMatch(/ORGANIZATION_ID_REPAIRED/);
    });
});
