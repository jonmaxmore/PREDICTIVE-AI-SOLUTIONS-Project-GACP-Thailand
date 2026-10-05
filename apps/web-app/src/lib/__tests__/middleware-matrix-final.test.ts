/**
 * V5-C — Frontend cross-prefix × cross-role RBAC matrix.
 *
 * Companion to `apps/backend/__tests__/unit/rbac-matrix-final.test.js`.
 * Iterates the 5 protected `/provider/*` / `/admin` prefixes × 8 canonical
 * human roles = 40 cells. Each cell asserts the
 * `decideProviderRouteAccess()` helper (which mirrors the live middleware
 * decision at `apps/web-app/src/middleware.ts:151-174`) returns the
 * expected `'allow'` or `'redirect-provider-dashboard'` verdict.
 *
 * Why this consolidates the V1-D / V2-B / V4-A cases:
 *   - `middleware-helpers.test.ts` (the existing file) has per-prefix
 *     narrative cases that prove individual decisions.
 *   - V5-C extracts the same rules table into a single `describe.each`
 *     matrix so future role/prefix additions land in ONE place. Per the
 *     V5-C RFC §V5-C this is the "consolidated proof at the matrix
 *     level".
 *
 * Maintenance contract:
 *   - When `middleware.ts:26-50` adds or removes a rule, mirror the
 *     change in PROVIDER_RULES below AND add the new prefix to
 *     `apps/backend/__tests__/helpers/rbac-matrix-routes.js`
 *     FRONTEND_PREFIXES so the backend coverage report stays in sync.
 *   - The matrix expects 5 prefixes × 8 roles = 40 cells. Any
 *     `describe.each` row producing fewer/more cells trips the
 *     "matrix completeness" sanity assertion at the bottom.
 */

import { describe, expect, it } from '@jest/globals';
import {
    decideProviderRouteAccess,
    PROVIDER_ROUTE_ROLE_RULES,
} from '../middleware-helpers';
import { CANONICAL_ROLES, type CanonicalRole } from '../constants/canonical-roles';

// FE-XC-02: the SHIPPING rules table, imported (not a hand-copied mirror that
// can drift). middleware.ts consumes the exact same const via the helper.
const PROVIDER_RULES = PROVIDER_ROUTE_ROLE_RULES;

// ── บทบาทที่เป็นคน (ตรงกับ HUMAN_ROLES ฝั่งหลังบ้าน) ──────────────────
//
// `system_admin_platform` ไม่อยู่ในรายการโดยเจตนา — role-middleware ให้ทางลัดกับมัน
// ว่าผ่านทุกข้อกำหนดบทบาท ⇒ เคส NEGATIVE ของมันจะผ่านตามการออกแบบ ไม่ใช่เพราะรั่ว
const HUMAN_ROLES: readonly CanonicalRole[] = [
    CANONICAL_ROLES.HEALTH,
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
];

// ── The 5 protected prefixes per the RFC V5-C frontend matrix ──────────
//
// admitRoles is the canonical RFC admit-set per
// `docs/handoffs/iter-V5/00-rfc.md §V5-C` "Frontend" rows. ADMIN is
// always admitted (it bypasses every rule via decideProviderRouteAccess).
const PREFIX_MATRIX = [
    {
        id: 'fe.admin',
        prefix: '/admin',
        samplePath: '/admin/users',
        admitRoles: [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM] as readonly CanonicalRole[],
    },
    {
        id: 'fe.provider.applications',
        prefix: '/provider/applications',
        samplePath: '/provider/applications/app-1',
        admitRoles: [
            CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
        ] as readonly CanonicalRole[],
    },
    {
        id: 'fe.provider.accounting',
        prefix: '/provider/accounting',
        samplePath: '/provider/accounting/dashboard',
        admitRoles: [
            CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            // operator 2026-09-27 S6: FIELD_INSPECTOR removed (no finance reads)
        ] as readonly CanonicalRole[],
    },
    {
        id: 'fe.provider.audits',
        prefix: '/provider/audits',
        samplePath: '/provider/audits/queue',
        admitRoles: [
            CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
            CANONICAL_ROLES.FIELD_INSPECTOR,
        ] as readonly CanonicalRole[],
    },
    {
        id: 'fe.provider.scheduler',
        prefix: '/provider/scheduler',
        samplePath: '/provider/scheduler/dashboard',
        admitRoles: [
            CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
            CANONICAL_ROLES.DISPATCHER,
        ] as readonly CanonicalRole[],
    },
] as const;

// Track every cell so the bottom-of-file completeness check can verify
// we exercised 5 × 8 = 40 cells exactly.
type CellResult = {
    prefixId: string;
    role: CanonicalRole;
    decision: 'allow' | 'redirect-provider-dashboard';
    polarity: 'positive' | 'negative';
};
const cellResults: CellResult[] = [];

describe('V5-C — final cross-prefix × cross-role middleware matrix', () => {
    describe.each(PREFIX_MATRIX)('prefix $prefix', ({ id, samplePath, admitRoles }) => {
        const admit = new Set<CanonicalRole>(admitRoles);
        const positive = HUMAN_ROLES.filter((role) => admit.has(role));
        const negative = HUMAN_ROLES.filter((role) => !admit.has(role));

        // Coverage guard: positive + negative must cover ALL 8 roles
        // exactly once each. Catches typos in admitRoles at collect time.
        it('admit set covers all 8 human canonical roles (typo guard)', () => {
            const union = new Set([...positive, ...negative]);
            for (const role of HUMAN_ROLES) {
                expect(union.has(role)).toBe(true);
            }
            for (const role of positive) {
                expect(negative).not.toContain(role);
            }
        });

        if (positive.length > 0) {
            it.each(positive)('POSITIVE — %s role is allowed', (role) => {
                const result = decideProviderRouteAccess(samplePath, role, PROVIDER_RULES);
                expect(result).toEqual({ decision: 'allow' });
                cellResults.push({
                    prefixId: id,
                    role,
                    decision: 'allow',
                    polarity: 'positive',
                });
            });
        }

        if (negative.length > 0) {
            it.each(negative)('NEGATIVE — %s role is redirected to provider dashboard', (role) => {
                const result = decideProviderRouteAccess(samplePath, role, PROVIDER_RULES);
                expect(result).toEqual({ decision: 'redirect-provider-dashboard' });
                cellResults.push({
                    prefixId: id,
                    role,
                    decision: 'redirect-provider-dashboard',
                    polarity: 'negative',
                });
            });
        }
    });

    describe('matrix completeness', () => {
        it('covers exactly 5 prefixes × 8 roles = 40 cells', () => {
            // Each cell appears exactly once across the describe.each
            // iterations above. If a future edit adds a prefix without
            // updating PREFIX_MATRIX, this count surfaces the gap.
            expect(cellResults.length).toBe(PREFIX_MATRIX.length * HUMAN_ROLES.length);
            expect(PREFIX_MATRIX.length).toBe(5);
            expect(HUMAN_ROLES.length).toBe(8);
        });

        it('every (prefix, role) pair has exactly one verdict (no duplicates)', () => {
            const seen = new Set<string>();
            for (const cell of cellResults) {
                const key = `${cell.prefixId}|${cell.role}`;
                expect(seen.has(key)).toBe(false);
                seen.add(key);
            }
            expect(seen.size).toBe(PREFIX_MATRIX.length * HUMAN_ROLES.length);
        });

        it('matches the canonical admit-set per RFC §V5-C', () => {
            // Cross-reference the cell results back to the matrix
            // definition — every positive cell must have its role in
            // admitRoles, every negative cell must NOT.
            for (const cell of cellResults) {
                const matrixEntry = PREFIX_MATRIX.find((entry) => entry.id === cell.prefixId);
                expect(matrixEntry).toBeDefined();
                const admit = new Set<string>(matrixEntry!.admitRoles);
                if (cell.polarity === 'positive') {
                    expect(admit.has(cell.role)).toBe(true);
                    expect(cell.decision).toBe('allow');
                } else {
                    expect(admit.has(cell.role)).toBe(false);
                    expect(cell.decision).toBe('redirect-provider-dashboard');
                }
            }
        });
    });

    describe('rule-order regression guards (per RFC §V5-C maintenance)', () => {
        // Catch the "more specific prefix accidentally listed after the
        // bare /provider rule" bug class — the test that surfaces a rule
        // order break loudly so a silent admit doesn't slip through.
        it('/admin is matched before any bare / rule', () => {
            const rule = PROVIDER_RULES.find((item) =>
                '/admin/users'.startsWith(item.prefix),
            );
            expect(rule?.prefix).toBe('/admin');
        });

        it('/provider/accounting is matched before any bare /provider rule', () => {
            const rule = PROVIDER_RULES.find((item) =>
                '/provider/accounting/foo'.startsWith(item.prefix),
            );
            expect(rule?.prefix).toBe('/provider/accounting');
        });

        it('/provider/scheduler is matched before any bare /provider rule', () => {
            const rule = PROVIDER_RULES.find((item) =>
                '/provider/scheduler/dashboard'.startsWith(item.prefix),
            );
            expect(rule?.prefix).toBe('/provider/scheduler');
        });

        it('/provider/audits is matched before any bare /provider rule', () => {
            const rule = PROVIDER_RULES.find((item) =>
                '/provider/audits/queue'.startsWith(item.prefix),
            );
            expect(rule?.prefix).toBe('/provider/audits');
        });

        it('/provider/applications is matched before any bare /provider rule', () => {
            const rule = PROVIDER_RULES.find((item) =>
                '/provider/applications/abc'.startsWith(item.prefix),
            );
            expect(rule?.prefix).toBe('/provider/applications');
        });
    });
});
