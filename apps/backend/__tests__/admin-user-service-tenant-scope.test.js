/**
 * S2(c) + S6 — provider-user-service tenant-scope pins (REAL service, mocked
 * prisma). Named under the admin-user-service pattern because these two
 * behaviours back admin-user-service's last-admin guard:
 *
 *   S2(c): ADMIN_USER_GUARD_SELECT must include organizationId — otherwise
 *   assertNotLastActiveAdmin's `existing.organizationId` fallback is ALWAYS
 *   undefined for admin-surface callers and the last-admin count silently
 *   goes global (wrong org / cross-org noise).
 *
 *   S6: countOtherActiveAdmins does its OWN explicit org filtering (counting
 *   in the TARGET's org — which differs from the caller's ctx org on
 *   cross-tenant PLATFORM_ADMIN edits). Under TENANT_READ_ORG_SCOPE (ON on
 *   staging+prod) the tenant-prisma-extension spreads the CALLER-ctx
 *   organizationId over every user.count WHERE — clobbering the target-org
 *   count. The query must therefore run inside withoutTenantScope.
 */

'use strict';

const mockUserFindFirst = jest.fn();
const mockUserCount = jest.fn();
const mockUserFindMany = jest.fn();

jest.mock('../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: (...args) => mockUserFindFirst(...args),
            count: (...args) => mockUserCount(...args),
            findMany: (...args) => mockUserFindMany(...args),
            create: jest.fn(),
            update: jest.fn(),
            findUnique: jest.fn(),
        },
    },
}));

const mockWithoutTenantScope = jest.fn((fn) => fn());
jest.mock('../services/tenant-context', () => ({
    withoutTenantScope: (...args) => mockWithoutTenantScope(...args),
    runWithTenantContext: (_ctx, fn) => fn(),
    getTenantContext: jest.fn(() => null),
}));

const providerUserService = require('../services/provider-user-service');
// canonical-rbac is NOT mocked in this file — normalizeRole/CANONICAL_ROLES
// are the real SSOT, so the fixture below proves the actual alias contract.
const { CANONICAL_ROLES, normalizeRole } = require('../shared/canonical-rbac');

describe('S2(c) — ADMIN_USER_GUARD_SELECT carries organizationId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserFindFirst.mockResolvedValue(null);
    });

    test('getActiveAdminUserGuard selects organizationId for the last-admin fallback', async () => {
        await providerUserService.getActiveAdminUserGuard('u-1');
        expect(mockUserFindFirst).toHaveBeenCalledWith(expect.objectContaining({
            select: expect.objectContaining({ organizationId: true }),
        }));
    });
});

describe('S6 — countOtherActiveAdmins escapes the tenant read-scope extension', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserCount.mockResolvedValue(2);
    });

    test('runs inside withoutTenantScope with its OWN explicit org filter', async () => {
        const result = await providerUserService.countOtherActiveAdmins({
            organizationId: 'org-target',
            excludeUserId: 'u-1',
        });
        expect(result).toBe(2);
        expect(mockWithoutTenantScope).toHaveBeenCalledTimes(1);
        expect(mockUserCount).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                organizationId: 'org-target',
                status: 'ACTIVE',
                isDeleted: false,
                id: { not: 'u-1' },
            }),
        }));

        // The role filter completed expand-migrate-contract: migration
        // 20260801000000 ran in production (zero legacy rows remain, and
        // SUPER_ADMIN rows collapsed into 'system_admin_dtam'), so the filter matches the
        // canonical spelling alone.
        //
        // Still asserted as an invariant rather than a pinned list: what the
        // last-admin guard needs is that canonical admins are counted and that
        // no non-canonical spelling (which can only match nothing) creeps back.
        const { role } = mockUserCount.mock.calls[0][0].where;
        expect(role.in).toContain('system_admin_dtam');
        for (const value of role.in) {
            expect(value).toBe(value.toLowerCase());
        }
    });

    test('org-less call (legacy data) still runs unscoped, not ctx-clobbered', async () => {
        await providerUserService.countOtherActiveAdmins({ excludeUserId: 'u-1' });
        expect(mockWithoutTenantScope).toHaveBeenCalledTimes(1);
        const { where } = mockUserCount.mock.calls[0][0];
        expect(where).not.toHaveProperty('organizationId');
    });
});

/**
 * F-REVIEWER-DROPDOWN-EMPTY — a real-DB walk found the scheduler's "จ่ายงาน
 * ตรวจเอกสาร" reviewer dropdown EMPTY. listReviewerCandidates() filtered with
 * `role: { in: reviewerRoles } }` where reviewerRoles is canonical-lowercase
 * only — Prisma's `in` on Postgres is case-sensitive, so a live row still
 * holding a legacy spelling (REVIEWER_AUDITOR / Auditor / AUDITOR — the
 * migration comment's claim that all legacy rows collapsed was wrong) matched
 * zero rows and silently vanished from the dropdown.
 *
 * The fixture's mockUserFindMany emulates real Postgres `in` semantics
 * (case-sensitive exact match on `where.role.in`, no filtering when the
 * query carries no role clause) so this test is RED against the old
 * canonical-only-filter implementation and GREEN once the service reads
 * every ACTIVE PROVIDER row and matches case-insensitively via the
 * ROLE_ALIASES SSOT (normalizeRole), not a hand-written spelling list.
 */
describe('F-REVIEWER-DROPDOWN-EMPTY — listReviewerCandidates เทียบแบบไม่สนตัวพิมพ์', () => {
    const LEGACY_UPPERCASE_REVIEWER = Object.freeze({
        id: 'user-legacy-reviewer',
        providerId: '1111111111111',
        firstName: 'Legacy',
        lastName: 'Reviewer',
        role: 'DOCUMENT_REVIEWER', // ตัวพิมพ์ใหญ่ของคำปัจจุบัน — Prisma `in` จับไม่ได้ แต่ normalizeRole จับได้
    });
    const MIXED_CASE_AUDITOR = Object.freeze({
        id: 'user-mixed-auditor',
        providerId: '2222222222222',
        firstName: 'Mixed',
        lastName: 'ตัวพิมพ์ผสม',
        role: 'Field_Inspector',
    });
    const CANONICAL_REVIEWER = Object.freeze({
        id: 'user-canonical-reviewer',
        providerId: '3333333333333',
        firstName: 'Canon',
        lastName: 'Reviewer',
        role: 'document_reviewer',
    });
    const NON_REVIEWER_SCHEDULER = Object.freeze({
        id: 'user-scheduler',
        providerId: '4444444444444',
        firstName: 'Sched',
        lastName: 'User',
        role: 'dispatcher',
    });
    const NON_REVIEWER_LEGACY_ACCOUNT = Object.freeze({
        id: 'user-legacy-account',
        providerId: '5555555555555',
        firstName: 'Acct',
        lastName: 'User',
        role: 'finance_officer_platform',
    });
    const ALL_FIXTURE_ROWS = [
        LEGACY_UPPERCASE_REVIEWER,
        MIXED_CASE_AUDITOR,
        CANONICAL_REVIEWER,
        NON_REVIEWER_SCHEDULER,
        NON_REVIEWER_LEGACY_ACCOUNT,
    ];
    const REVIEWER_ROLES = [CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR];

    beforeEach(() => {
        jest.clearAllMocks();
        // Honest fake: emulates Postgres case-sensitive `in` filtering when the
        // query carries a `where.role.in` clause; returns the full roster when
        // it does not (the defensive-read shape queries no role at all and
        // filters in JS instead). This is what makes the test load-bearing —
        // a query that still narrows in SQL by canonical-only values stays RED.
        mockUserFindMany.mockImplementation(async ({ where } = {}) => {
            if (where?.role?.in) {
                const wanted = new Set(where.role.in);
                return ALL_FIXTURE_ROWS.filter((r) => wanted.has(r.role));
            }
            return ALL_FIXTURE_ROWS;
        });
    });

    test('คืนแถวที่สะกดด้วยตัวพิมพ์ใหญ่ พร้อม canonicalRole ที่ถูก', async () => {
        const rows = await providerUserService.listReviewerCandidates(REVIEWER_ROLES);
        const found = rows.find((r) => r.id === LEGACY_UPPERCASE_REVIEWER.id);
        expect(found).toBeDefined();
        expect(normalizeRole(found.role)).toBe(CANONICAL_ROLES.DOCUMENT_REVIEWER);
    });

    test('คืนแถวที่สะกดตัวพิมพ์ผสม พร้อม canonicalRole ที่ถูก', async () => {
        const rows = await providerUserService.listReviewerCandidates(REVIEWER_ROLES);
        const found = rows.find((r) => r.id === MIXED_CASE_AUDITOR.id);
        expect(found).toBeDefined();
        expect(normalizeRole(found.role)).toBe(CANONICAL_ROLES.FIELD_INSPECTOR);
    });

    test('still returns the canonical-lowercase reviewer (no regression)', async () => {
        const rows = await providerUserService.listReviewerCandidates(REVIEWER_ROLES);
        expect(rows.some((r) => r.id === CANONICAL_REVIEWER.id)).toBe(true);
    });

    test('does NOT over-match — scheduler and legacy ACCOUNT rows are excluded', async () => {
        const rows = await providerUserService.listReviewerCandidates(REVIEWER_ROLES);
        const ids = rows.map((r) => r.id);
        expect(ids).not.toContain(NON_REVIEWER_SCHEDULER.id);
        expect(ids).not.toContain(NON_REVIEWER_LEGACY_ACCOUNT.id);
    });

    test('returns exactly the 3 reviewer/auditor rows out of the 5-row fixture', async () => {
        const rows = await providerUserService.listReviewerCandidates(REVIEWER_ROLES);
        expect(rows.map((r) => r.id).sort()).toEqual(
            [CANONICAL_REVIEWER.id, LEGACY_UPPERCASE_REVIEWER.id, MIXED_CASE_AUDITOR.id].sort(),
        );
    });
});

/**
 * F-AUDITOR-DROPDOWN-EMPTY — the sibling of F-REVIEWER-DROPDOWN-EMPTY the
 * 2026-08-18 fix missed. The 2026-08-19 real-DB walk (Phase 0 C11) found the
 * scheduler's AssignAuditorModal dropdown EMPTY: listAuditorsForScheduler()
 * still narrows in SQL with `role: { in: [CANONICAL_ROLES.FIELD_INSPECTOR] } }`
 * (canonical-lowercase only), Prisma's `in` on Postgres is case-sensitive,
 * and the live seed auditor 2222222222222 holds legacy `AUDITOR` — zero rows,
 * dropdown empty, confirm button dead. Evidence:
 * evidence/phase0/s05/C11-auditor-options.txt.
 *
 * Same honest fake as the reviewer block above: mockUserFindMany emulates
 * Postgres case-sensitive `in`. RED against the old SQL-narrowed
 * implementation, GREEN once the service reads the ACTIVE PROVIDER roster
 * and matches via normalizeRole() (ROLE_ALIASES SSOT).
 *
 * NOTE the deliberate difference from the reviewer block:
 * REVIEWER_AUDITOR normalizes to document_reviewer (canonical-rbac.js:69),
 * so it must NOT appear in the AUDITOR dropdown — asserted below.
 */
describe('F-AUDITOR-DROPDOWN-EMPTY — listAuditorsForScheduler เทียบแบบไม่สนตัวพิมพ์', () => {
    const LEGACY_UPPERCASE_AUDITOR = Object.freeze({
        id: 'user-legacy-auditor',
        providerId: '2222222222222',
        firstName: 'Legacy',
        lastName: 'ตัวพิมพ์ผสม',
        role: 'FIELD_INSPECTOR', // ตัวพิมพ์ใหญ่ของคำปัจจุบัน — เหตุเดียวกับข้างบน
    });
    const MIXED_CASE_AUDITOR_ROW = Object.freeze({
        id: 'user-mixed-case-auditor',
        providerId: '2222222222223',
        firstName: 'Mixed',
        lastName: 'ตัวพิมพ์ผสม',
        role: 'Field_Inspector',
    });
    const CANONICAL_AUDITOR = Object.freeze({
        id: 'user-canonical-auditor',
        providerId: '2222222222224',
        firstName: 'Canon',
        lastName: 'ตัวพิมพ์ผสม',
        role: 'field_inspector',
    });
    const REVIEWER_AUDITOR_ROW = Object.freeze({
        id: 'user-reviewer-auditor',
        providerId: '1111111111111',
        firstName: 'Legacy',
        lastName: 'Reviewer',
        role: 'document_reviewer', // → document_reviewer, NOT an auditor
    });
    const SCHEDULER_ROW = Object.freeze({
        id: 'user-scheduler-2',
        providerId: '3333333333333',
        firstName: 'Sched',
        lastName: 'User',
        role: 'dispatcher',
    });
    const AUDITOR_FIXTURE_ROWS = [
        LEGACY_UPPERCASE_AUDITOR,
        MIXED_CASE_AUDITOR_ROW,
        CANONICAL_AUDITOR,
        REVIEWER_AUDITOR_ROW,
        SCHEDULER_ROW,
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        mockUserFindMany.mockImplementation(async ({ where } = {}) => {
            if (where?.role?.in) {
                const wanted = new Set(where.role.in);
                return AUDITOR_FIXTURE_ROWS.filter((r) => wanted.has(r.role));
            }
            return AUDITOR_FIXTURE_ROWS;
        });
    });

    test('returns the legacy-uppercase AUDITOR row (the live seed auditor shape)', async () => {
        const rows = await providerUserService.listAuditorsForScheduler();
        const found = rows.find((r) => r.id === LEGACY_UPPERCASE_AUDITOR.id);
        expect(found).toBeDefined();
        expect(normalizeRole(found.role)).toBe(CANONICAL_ROLES.FIELD_INSPECTOR);
    });

    test('คืนแถวผู้ตรวจแปลงทั้งตัวพิมพ์ผสมและคำปกติ', async () => {
        const rows = await providerUserService.listAuditorsForScheduler();
        const ids = rows.map((r) => r.id);
        expect(ids).toContain(MIXED_CASE_AUDITOR_ROW.id);
        expect(ids).toContain(CANONICAL_AUDITOR.id);
    });

    test('does NOT over-match — REVIEWER_AUDITOR (→ document_reviewer) and scheduler are excluded', async () => {
        const rows = await providerUserService.listAuditorsForScheduler();
        const ids = rows.map((r) => r.id);
        expect(ids).not.toContain(REVIEWER_AUDITOR_ROW.id);
        expect(ids).not.toContain(SCHEDULER_ROW.id);
    });

    test('returns exactly the 3 auditor rows out of the 5-row fixture', async () => {
        const rows = await providerUserService.listAuditorsForScheduler();
        expect(rows.map((r) => r.id).sort()).toEqual(
            [CANONICAL_AUDITOR.id, LEGACY_UPPERCASE_AUDITOR.id, MIXED_CASE_AUDITOR_ROW.id].sort(),
        );
    });
});
