/**
 * shared/user-groups unit tests — ADR-016 Phase 1C.
 *
 *  - getUserGroups: returns canonical codes for memberships, falls back
 *    to User.role when no memberships exist
 *  - userInGroup: O(1) check, admin shortcut works
 *  - listGroupMemberUserIds: union of M2M members + legacy User.role users
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const userGroups = require('../../shared/user-groups');

beforeEach(() => {
    userGroups.clearCache();
});

function makePrisma(seed = {}) {
    return {
        roleGroup: {
            findMany: jest.fn(async () => seed.groups || []),
            // ทะเบียนถูกถามตรง ๆ เมื่อ cache ไม่มี code นั้น — stub ต้องตอบตาม seed
            // ปัจจุบัน ไม่ใช่ตาม snapshot ตอน warm cache ไม่งั้นเทสจะพิสูจน์ไม่ได้ว่า
            // การอ่านซ้ำเกิดขึ้นจริง
            findFirst: jest.fn(async ({ where }) => {
                const hit = (seed.groups || []).find((g) => g.code === where.code
                    && (where.isActive === undefined || (g.isActive ?? true) === where.isActive));
                return hit ? { id: hit.id } : null;
            }),
        },
        userGroupMembership: {
            findMany: jest.fn(async ({ where }) => {
                return (seed.memberships || []).filter((m) => {
                    if (where.userId && m.userId !== where.userId) {return false;}
                    if (where.groupId && m.groupId !== where.groupId) {return false;}
                    if (where.organizationId && m.organizationId !== where.organizationId) {return false;}
                    // Default isActive to true on the seed so individual test
                    // bodies don't have to thread it through every membership.
                    const seedActive = m.isActive ?? true;
                    if (where.isActive !== undefined && seedActive !== where.isActive) {return false;}
                    if (where.user?.isDeleted === false && m.userIsDeleted) {return false;}
                    if (where.user?.isLocked === false && m.userIsLocked) {return false;}
                    return true;
                }).map((m) => ({
                    userId: m.userId,
                    group: m.group || { code: m.groupCode, isActive: m.groupActive ?? true },
                }));
            }),
        },
        user: {
            findUnique: jest.fn(async ({ where }) => {
                return (seed.users || []).find((u) => u.id === where.id) || null;
            }),
            findMany: jest.fn(async ({ where }) => {
                return (seed.users || []).filter((u) => {
                    if (where.organizationId && u.organizationId !== where.organizationId) {return false;}
                    // Model both Prisma role-filter shapes (`role: 'x'` and
                    // `role: { in: [...] }`) with real case-sensitive
                    // semantics, so the tests below can prove which spellings
                    // the production filter actually matches.
                    if (where.role && typeof where.role === 'object' && Array.isArray(where.role.in)) {
                        if (!where.role.in.includes(u.role)) {return false;}
                    } else if (where.role && u.role !== where.role) {return false;}
                    if (where.isDeleted === false && u.isDeleted) {return false;}
                    if (where.isLocked === false && u.isLocked) {return false;}
                    return true;
                }).map((u) => ({ id: u.id }));
            }),
        },
    };
}

describe('getUserGroups', () => {
    test('returns codes from active memberships', async () => {
        const prisma = makePrisma({
            memberships: [
                { userId: 'u-1', group: { code: 'field_inspector', isActive: true } },
                { userId: 'u-1', group: { code: 'document_reviewer', isActive: true } },
            ],
        });
        const groups = await userGroups.getUserGroups(prisma, 'u-1');
        expect(groups).toEqual(expect.arrayContaining(['field_inspector', 'document_reviewer']));
    });

    test('skips inactive group memberships', async () => {
        const prisma = makePrisma({
            memberships: [
                { userId: 'u-1', group: { code: 'field_inspector', isActive: false } },
                { userId: 'u-1', group: { code: 'document_reviewer', isActive: true } },
            ],
        });
        const groups = await userGroups.getUserGroups(prisma, 'u-1');
        expect(groups).toEqual(['document_reviewer']);
    });

    test('falls back to User.role when no memberships exist', async () => {
        const prisma = makePrisma({
            memberships: [],
            users: [{ id: 'u-1', role: 'field_inspector' }],
        });
        const groups = await userGroups.getUserGroups(prisma, 'u-1');
        expect(groups).toEqual(['field_inspector']);
    });

    test('returns [] for unknown user', async () => {
        const prisma = makePrisma({ memberships: [], users: [] });
        const groups = await userGroups.getUserGroups(prisma, 'unknown');
        expect(groups).toEqual([]);
    });

    test('returns [] when userId is falsy', async () => {
        const prisma = makePrisma();
        const groups = await userGroups.getUserGroups(prisma, null);
        expect(groups).toEqual([]);
    });
});

describe('userInGroup', () => {
    test('returns true when user is in the group via M2M', async () => {
        const prisma = makePrisma({
            memberships: [
                { userId: 'u-1', group: { code: 'field_inspector', isActive: true } },
            ],
        });
        await expect(userGroups.userInGroup(prisma, 'u-1', 'field_inspector')).resolves.toBe(true);
    });

    test('returns false when user has memberships but not the requested group', async () => {
        const prisma = makePrisma({
            memberships: [
                { userId: 'u-1', group: { code: 'field_inspector', isActive: true } },
            ],
        });
        await expect(userGroups.userInGroup(prisma, 'u-1', 'finance_officer_platform')).resolves.toBe(false);
    });

    test('admin shortcut: admin user can claim any group', async () => {
        const prisma = makePrisma({
            memberships: [
                { userId: 'u-admin', group: { code: 'system_admin_dtam', isActive: true } },
            ],
        });
        await expect(userGroups.userInGroup(prisma, 'u-admin', 'field_inspector')).resolves.toBe(true);
        await expect(userGroups.userInGroup(prisma, 'u-admin', 'finance_officer_platform')).resolves.toBe(true);
    });

    test('falls back to User.role when no memberships exist', async () => {
        const prisma = makePrisma({
            memberships: [],
            users: [{ id: 'u-fresh', role: 'field_inspector' }],
        });
        await expect(userGroups.userInGroup(prisma, 'u-fresh', 'field_inspector')).resolves.toBe(true);
        await expect(userGroups.userInGroup(prisma, 'u-fresh', 'finance_officer_platform')).resolves.toBe(false);
    });

    test('returns false when userId or groupCode is falsy', async () => {
        const prisma = makePrisma();
        await expect(userGroups.userInGroup(prisma, null, 'field_inspector')).resolves.toBe(false);
        await expect(userGroups.userInGroup(prisma, 'u-1', null)).resolves.toBe(false);
    });
});

describe('listGroupMemberUserIds', () => {
    test('returns members from M2M memberships scoped to organization', async () => {
        const prisma = makePrisma({
            groups: [{ id: 'g-aud', code: 'field_inspector' }],
            memberships: [
                { userId: 'u-1', groupId: 'g-aud', organizationId: 'org-1', isActive: true },
                { userId: 'u-2', groupId: 'g-aud', organizationId: 'org-1', isActive: true },
                { userId: 'u-other', groupId: 'g-aud', organizationId: 'org-2', isActive: true },
            ],
        });
        const ids = await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'field_inspector');
        expect(ids.sort()).toEqual(['u-1', 'u-2'].sort());
    });

    // Migration 20260801000000_canonicalize_user_role rewrote User.role to the
    // canonical lowercase value, and the production run confirmed zero legacy
    // rows remain. The fallback branch therefore matches the canonical
    // spelling ALONE — the widened `{ in: [canonical, legacy] }` interim (which
    // existed so the deploy and the migration could land in either order) is
    // gone with the data that justified it.
    test('union with canonical User.role users in the same org', async () => {
        const prisma = makePrisma({
            groups: [{ id: 'g-aud', code: 'field_inspector' }],
            memberships: [
                { userId: 'u-multi', groupId: 'g-aud', organizationId: 'org-1', isActive: true },
            ],
            users: [
                { id: 'u-canonical', role: 'field_inspector', organizationId: 'org-1' },
            ],
        });
        const ids = await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'field_inspector');
        expect(ids.sort()).toEqual(['u-canonical', 'u-multi'].sort());
    });

    test('a legacy-spelled row no longer resolves — such rows cannot exist post-migration', async () => {
        // Documents the narrowing rather than hiding it: if a legacy row DID
        // somehow reappear (a restored backup, a rogue manual INSERT), the
        // filter would miss it silently. The migration is idempotent — re-run
        // it on any restored data before pointing the app at it.
        const prisma = makePrisma({
            groups: [{ id: 'g-dr', code: 'document_reviewer' }],
            users: [
                { id: 'u-new', role: 'document_reviewer', organizationId: 'org-1' },
                // สะกดแบบเก่าโดยเจตนา — หลังตัดขาด 2026-09-10 มันแปลไม่ออกอีกแล้ว
                { id: 'u-old', role: 'REVIEWER_AUDITOR', organizationId: 'org-1' },
            ],
        });
        const ids = await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'document_reviewer');
        expect(ids).toEqual(['u-new']);
    });

    test('dedupes when a user is in BOTH M2M and the User.role fallback', async () => {
        // Canonical seed — with the legacy spelling the fallback would not
        // match and this test would pass without exercising the dedupe at all.
        const prisma = makePrisma({
            groups: [{ id: 'g-aud', code: 'field_inspector' }],
            memberships: [
                { userId: 'u-1', groupId: 'g-aud', organizationId: 'org-1', isActive: true },
            ],
            users: [
                { id: 'u-1', role: 'field_inspector', organizationId: 'org-1' },
            ],
        });
        const ids = await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'field_inspector');
        expect(ids).toEqual(['u-1']);
    });

    test('returns [] when both sources are empty', async () => {
        const prisma = makePrisma({
            groups: [{ id: 'g-aud', code: 'field_inspector' }],
            memberships: [],
            users: [],
        });
        const ids = await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'field_inspector');
        expect(ids).toEqual([]);
    });
});

/**
 * วัดจากของจริงก่อนเขียนเทสนี้ (evidence/role-vocabulary-rehearsal-2026-09-10/cache-probe.txt):
 * process ที่ warm cache ไว้ตอนฐานยังเป็นคำเก่า แล้วไม่ได้รีสตาร์ตหลัง migration
 * คืนรายชื่อสั้นกว่า process ที่รีสตาร์ต 1 คน — คนที่อยู่ในกลุ่มด้วยการเป็นสมาชิก
 * แต่บทบาทหลักเป็นอย่างอื่น (fallback ด้วย users.role จึงหาไม่เจอ) และไม่มี error ใด ๆ
 *
 * ต้นเหตุคือคอมเมนต์ของ cache เองที่เขียนว่า role_groups "never edited at runtime"
 * ซึ่งเลิกจริงตั้งแต่ใบ 20260910120000 เปลี่ยนคำในแถวเดิม
 */
describe('listGroupMemberUserIds — cache ที่ค้างข้ามการเปลี่ยนคำของ role_groups', () => {
    test('หา code ที่ยังไม่เคยเห็นไม่เจอ ต้องอ่านทะเบียนใหม่ ไม่ใช่คืนลิสต์สั้นเงียบ ๆ', async () => {
        const seed = {
            // ก่อน migration: กลุ่มยังชื่อคำเก่า (คำเก่าโดยเจตนา)
            groups: [{ id: 'rg_auditor', code: 'auditor' }],
            memberships: [
                { userId: 'u-reviewer-also-inspector', groupId: 'rg_auditor', organizationId: 'org-1', isActive: true },
            ],
            // บทบาทหลักคนละคำ ⇒ fallback ด้วย users.role หาไม่เจอแน่นอน
            users: [{ id: 'u-reviewer-also-inspector', role: 'document_reviewer', organizationId: 'org-1' }],
        };
        const prisma = makePrisma(seed);

        // 1. process ถามด้วยคำใหม่ตั้งแต่ก่อน migration — ยังไม่มีใครในกลุ่มนั้นจริง
        expect(await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'field_inspector')).toEqual([]);

        // 2. migration รัน: แถวเดิมเปลี่ยนคำ (id เท่าเดิม สมาชิกไม่ขยับ)
        seed.groups = [{ id: 'rg_auditor', code: 'field_inspector' }];

        // 3. process เดิมถามอีกครั้ง — ต้องได้สมาชิกครบเท่ากับ process ที่รีสตาร์ตใหม่
        expect(await userGroups.listGroupMemberUserIds(prisma, 'org-1', 'field_inspector'))
            .toEqual(['u-reviewer-also-inspector']);
    });
});
