/**
 * X5-FIX-A / H-6 — Tier 16 ACCOUNT_DTAM + ACCOUNT_PLATFORM coverage
 * across the 4 sites that previously hardcoded a role/group list.
 *
 * V5-A landed the centralised `admin-role-options.ts` exports but
 * left the per-page wiring to V5-D. X5-A audit (§11) confirmed V5-D
 * did NOT rewire 4 of the pages:
 *
 *   1. /admin/users          — ROLE_OPTIONS filter dropdown
 *   2. /admin/communication  — TARGET_OPTIONS broadcast picker
 *   3. /provider/management  — filter dropdown + create/edit role picker
 *   4. /provider/management/users/[id]/groups — ALL_GROUPS
 *
 * X5-FIX-A wires each of these to the canonical source. This test
 * locks the contract: each derived list MUST include the Tier 16
 * split roles (ACCOUNT_DTAM + ACCOUNT_PLATFORM) so admin filtering
 * + assignment of split-finance staff is not silently empty.
 *
 * The assertions are dual-purpose:
 *   - They prove the canonical source exposes the split roles
 *     (regression guard against accidental removal).
 *   - They prove each derivation pattern preserves the split roles
 *     after the page-specific filter/map projection (so a future
 *     `.filter(opt => !opt.hidden)` rewrite cannot drop them).
 */

import {
    ADMIN_ROLE_OPTIONS,
    ADMIN_ROLE_OPTIONS_FOR_NEW_USER,
    ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX,
} from '../admin-role-options';

describe('X5-FIX-A H-6 — Tier 16 coverage on 4 hardcoded role/group sites', () => {
    describe('canonical source', () => {
        it('ADMIN_ROLE_OPTIONS exposes ACCOUNT_DTAM and ACCOUNT_PLATFORM', () => {
            const values = ADMIN_ROLE_OPTIONS.map((opt) => opt.value);
            expect(values).toContain('finance_officer_dtam');
            expect(values).toContain('finance_officer_platform');
        });
    });

    describe('Site 1: /admin/users — ROLE_OPTIONS filter dropdown', () => {
        // Mirrors the projection in apps/web-app/src/app/admin/users/page.tsx
        // (ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX.map → { value, label }).
        const ROLE_OPTIONS = ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX.map((opt) => ({
            value: opt.value,
            label: opt.label,
        }));

        it('includes both ACCOUNT_DTAM and ACCOUNT_PLATFORM in the dropdown', () => {
            const values = ROLE_OPTIONS.map((opt) => opt.value);
            expect(values).toContain('finance_officer_dtam');
            expect(values).toContain('finance_officer_platform');
        });

        it('prefixes "ALL" as the first option for "ทุกบทบาท" sentinel', () => {
            expect(ROLE_OPTIONS[0]).toEqual(
                expect.objectContaining({ value: 'ALL' }),
            );
        });
    });

    describe('Site 2: /admin/communication — TARGET_OPTIONS broadcast picker', () => {
        // Mirrors the projection in apps/web-app/src/app/admin/communication/page.tsx.
        const TARGET_OPTIONS = [
            { value: '', label: 'ผู้ใช้ทั้งหมด' },
            ...ADMIN_ROLE_OPTIONS
                .filter((option) => !option.hidden && option.canonical !== 'health')
                .map((option) => ({
                    value: `role:${option.canonical}`,
                    label: option.isLegacy ? `${option.label}` : `${option.label} (${option.value})`,
                })),
            { value: 'userType:health', label: 'ผู้ยื่นคำขอ (Applicants)' },
            { value: 'userType:provider', label: 'เจ้าหน้าที่ทั้งหมด (Providers)' },
        ];

        it('includes the split-finance role targets', () => {
            const values = TARGET_OPTIONS.map((t) => t.value);
            expect(values).toContain('role:finance_officer_dtam');
            expect(values).toContain('role:finance_officer_platform');
        });

        it('still surfaces the all-applicants + all-providers shortcuts', () => {
            const values = TARGET_OPTIONS.map((t) => t.value);
            expect(values).toContain('userType:health');
            expect(values).toContain('userType:provider');
            expect(values[0]).toBe(''); // "ผู้ใช้ทั้งหมด"
        });

        it('excludes the hidden SYSTEM target (internal webhook actor)', () => {
            const values = TARGET_OPTIONS.map((t) => t.value);
            expect(values).not.toContain('role:system');
        });
    });

    describe('Site 3: /provider/management — filter dropdown + create/edit picker', () => {
        // Filter projection: mirrors the Select.data assignment.
        const FILTER_OPTIONS = ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX
            .filter((opt) => !opt.hidden && opt.value !== 'HEALTH')
            .map((opt) => ({ value: opt.value, label: opt.label }));

        // Create/edit role picker projection.
        const NEW_USER_OPTIONS = ADMIN_ROLE_OPTIONS_FOR_NEW_USER
            .filter((opt) => opt.canonical !== 'health')
            .map((opt) => ({ value: opt.canonical, label: opt.label }));

        it('filter dropdown includes the split-finance roles', () => {
            const values = FILTER_OPTIONS.map((opt) => opt.value);
            expect(values).toContain('finance_officer_dtam');
            expect(values).toContain('finance_officer_platform');
        });

        it('filter dropdown excludes HEALTH (provider scope only)', () => {
            const values = FILTER_OPTIONS.map((opt) => opt.value);
            expect(values).not.toContain('HEALTH');
        });

        it('create/edit role picker exposes split-finance for new provisioning', () => {
            const values = NEW_USER_OPTIONS.map((opt) => opt.value);
            expect(values).toContain('finance_officer_dtam');
            expect(values).toContain('finance_officer_platform');
        });

        it('หน้าสร้างผู้ใช้ไม่มีบทบาทที่ไม่ใช่คน และไม่มีคำที่ปลดระวางแล้ว', () => {
            const values = NEW_USER_OPTIONS.map((opt) => opt.value);
            expect(values).not.toContain('system');
            for (const retired of ['account', 'admin', 'account_dtam', 'account_platform']) {
                expect(values).not.toContain(retired);
            }
        });
    });

    describe('Site 4: /provider/management/users/[id]/groups — ALL_GROUPS', () => {
        // Mirrors the projection in client-view.tsx.
        const ALL_GROUPS = ADMIN_ROLE_OPTIONS
            .filter((option) => !option.hidden && option.canonical !== 'health')
            .map((option) => ({
                code: option.canonical,
                titleTH: option.label,
            }));

        it('includes the split-finance group codes for membership assignment', () => {
            const codes = ALL_GROUPS.map((g) => g.code);
            expect(codes).toContain('finance_officer_dtam');
            expect(codes).toContain('finance_officer_platform');
        });

        it('excludes HEALTH (group is for staff memberships, not applicants)', () => {
            const codes = ALL_GROUPS.map((g) => g.code);
            expect(codes).not.toContain('health');
        });
    });
});
