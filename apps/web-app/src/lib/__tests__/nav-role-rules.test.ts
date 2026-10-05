/**
 * X4-FIX-A NAV-1 — NAV_ROLE_RULES + visibleProviderNavItems regression guard.
 *
 * Background: Tier 16 / V4-A introduced two split finance roles —
 * ACCOUNT_DTAM (DTAM state-fee reviewer) and ACCOUNT_PLATFORM (platform-
 * fee + subscription reviewer). `apps/web-app/src/middleware.ts:43-44`
 * already admits both to `/provider/accounting` + `/provider/receipts`,
 * but the sidebar's nav visibility table previously narrowed to
 * `[ADMIN, ACCOUNT]`. Split-role users hit the dashboard with NO nav
 * link to their own accounting surface — they could only reach it by
 * typing the URL. Same "reverse drift" pattern X3-D flagged for
 * AUDITOR / accounting.
 *
 * The fix moved NAV_ROLE_RULES out of `provider-layout.tsx` and into
 * `lib/constants.ts` alongside `providerNavigation`, then widened the
 * `work`, `analytics`, and `accounting` entries to include both split
 * roles. This test pins the post-fix surface and guards against the
 * symmetric "middleware widens but nav stays narrow" drift recurring.
 *
 * Assertions:
 *   1. Split-role users see the `accounting` nav item.
 *   2. Split-role users see the `work` nav item.
 *   3. Single-role legacy ACCOUNT users still see both (no regression).
 *   4. Non-finance roles (DOCUMENT_REVIEWER, AUDITOR, SCHEDULER) do NOT
 *      see accounting (their middleware admission stays narrow too).
 *   5. ADMIN sees everything regardless of rule table.
 *   6. Unrestricted items (e.g. `dashboard`, `applications`) are visible
 *      to everyone — the rule table is an allow-list, items with no rule
 *      stay public.
 */

import { describe, expect, it } from '@jest/globals';

import { NAV_ROLE_RULES, visibleProviderNavItems } from '../constants';
import { CANONICAL_ROLES } from '../constants/canonical-roles';

describe('[X4-FIX-A NAV-1] NAV_ROLE_RULES — split-role admission', () => {
    it('accounting nav admits ACCOUNT_DTAM + ACCOUNT_PLATFORM + legacy ACCOUNT', () => {
        const accounting = NAV_ROLE_RULES.accounting;
        expect(accounting).toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        expect(accounting).toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(accounting).toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        expect(accounting).toContain(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
    });

    it('work nav is ADMIN-only (C1-2: generic inbox retired from non-admin sidebar)', () => {
        // C1-2 (role-specific nav): the generic /provider/work unified inbox is
        // redundant for non-admin roles — each role has its OWN dashboard
        // (reviewer/coordinator/audits/accounting) that already shows its role-scoped
        // queue. The route stays open (unlisted) so /provider/work is still reachable
        // by URL; only the sidebar link is now ADMIN-only.
        expect(NAV_ROLE_RULES.work).toEqual([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);
        expect(NAV_ROLE_RULES.work).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(NAV_ROLE_RULES.work).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        expect(NAV_ROLE_RULES.work).not.toContain(CANONICAL_ROLES.FIELD_INSPECTOR);
        expect(NAV_ROLE_RULES.work).not.toContain(CANONICAL_ROLES.DOCUMENT_REVIEWER);
        expect(NAV_ROLE_RULES.work).not.toContain(CANONICAL_ROLES.DISPATCHER);
    });

    it('analytics nav admits split roles (shares ACCOUNTING_DASHBOARD_READ)', () => {
        const analytics = NAV_ROLE_RULES.analytics;
        expect(analytics).toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(analytics).toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
    });

    it('image-assessment nav is AUDIT_STAFF-only (matches backend ROLE_GROUPS.AUDIT_STAFF)', () => {
        // ต้นแบบที่ 6 tool: every /api/image-assessment/* endpoint is gated by
        // ROLE_GROUPS.AUDIT_STAFF, so the sidebar link must not show for the
        // finance/platform-admin roles the backend 403s (would be a dead surface).
        const img = NAV_ROLE_RULES['image-assessment'];
        expect(img).toEqual([
            CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.DISPATCHER,
        ]);
        expect(img).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(img).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        expect(img).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        expect(img).not.toContain(CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM);
    });

    it('admin-only nav items stay admin-only (no over-widening)', () => {
        expect(NAV_ROLE_RULES.management).toEqual([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);
        expect(NAV_ROLE_RULES.settings).toEqual([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);
    });

    it('P1-F: admin-console nav is ADMIN-only', () => {
        expect(NAV_ROLE_RULES['admin-console']).toEqual([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]);
    });

    it('certificates nav is [ADMIN, AUDITOR] (C1-3: reviewer hidden, finance out of scope)', () => {
        // The finance team does not issue certificates; C1-3 also hides the link
        // from DOCUMENT_REVIEWER (reviewer neither issues nor needs certs). The
        // ROUTE still admits [ADMIN, AUDITOR, DR] for URL access — this is a
        // deliberate menu-hide-but-URL-allow (route roles ⊃ nav roles).
        expect(NAV_ROLE_RULES.certificates).toEqual([CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.FIELD_INSPECTOR]);
        expect(NAV_ROLE_RULES.certificates).not.toContain(CANONICAL_ROLES.DOCUMENT_REVIEWER);
        expect(NAV_ROLE_RULES.certificates).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(NAV_ROLE_RULES.certificates).not.toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
    });
});

describe('[X4-FIX-A NAV-1] visibleProviderNavItems — split-role rendering', () => {
    it('an ACCOUNT_DTAM user sees the accounting nav (but NOT the generic work inbox)', () => {
        const items = visibleProviderNavItems(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        const keys = items.map((item) => item.key);
        expect(keys).toContain('accounting');
        expect(keys).not.toContain('work'); // C1-2: generic inbox retired for non-admin
        expect(keys).toContain('analytics');
    });

    it('an ACCOUNT_PLATFORM user sees the accounting nav (but NOT the generic work inbox)', () => {
        const items = visibleProviderNavItems(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        const keys = items.map((item) => item.key);
        expect(keys).toContain('accounting');
        expect(keys).not.toContain('work'); // C1-2: generic inbox retired for non-admin
        expect(keys).toContain('analytics');
    });

    it('a split-role user does NOT see admin-only items', () => {
        const items = visibleProviderNavItems(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        const keys = items.map((item) => item.key);
        expect(keys).not.toContain('settings');
        // `management` is admin-only too if it appears in providerNavigation
        // (currently not in the list, but the rule entry says ADMIN-only).
    });

    it('a legacy single-role ACCOUNT user still sees accounting (work inbox retired for non-admin)', () => {
        const items = visibleProviderNavItems(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
        const keys = items.map((item) => item.key);
        expect(keys).toContain('accounting');
        expect(keys).not.toContain('work'); // C1-2: generic inbox now ADMIN-only
    });

    it('non-finance roles do NOT see the accounting nav link', () => {
        for (const role of [
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.DISPATCHER,
        ]) {
            const items = visibleProviderNavItems(role);
            const keys = items.map((item) => item.key);
            expect(keys).not.toContain('accounting');
        }
    });

    it('ADMIN sees every nav item (admin bypass preserved)', () => {
        const items = visibleProviderNavItems(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
        const keys = items.map((item) => item.key);
        // Every providerNavigation entry must be present.
        expect(keys).toEqual(expect.arrayContaining([
            'dashboard', 'work', 'applications', 'audits', 'calendar',
            'analytics', 'accounting', 'certificates', 'settings',
            'admin-console', // P1-F: admin console reachable from the sidebar
        ]));
    });

    it('P1-F: the admin-console link (href=/admin/dashboard) is ADMIN-only in the rendered nav', () => {
        const adminItem = visibleProviderNavItems(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)
            .find((i) => i.key === 'admin-console');
        expect(adminItem?.href).toBe('/admin/dashboard');
        // No non-admin provider role gets it.
        for (const role of [
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.DISPATCHER,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
        ]) {
            const keys = visibleProviderNavItems(role).map((i) => i.key);
            expect(keys).not.toContain('admin-console');
        }
    });

    it('dashboard nav is unrestricted (visible to every staff role)', () => {
        for (const role of [
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.DISPATCHER,
        ]) {
            const keys = visibleProviderNavItems(role).map((item) => item.key);
            expect(keys).toContain('dashboard');
        }
    });

    it('C1-2: NO non-admin role sees the generic "งานของฉัน" work inbox', () => {
        for (const role of [
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            CANONICAL_ROLES.DISPATCHER,
            CANONICAL_ROLES.FIELD_INSPECTOR,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
        ]) {
            const keys = visibleProviderNavItems(role).map((item) => item.key);
            expect(keys).not.toContain('work');
        }
        // ADMIN keeps it.
        expect(visibleProviderNavItems(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM).map((i) => i.key)).toContain('work');
    });

    it('C1-1: dashboard ("หน้าหลัก") href is role-aware (points at each role\'s own landing)', () => {
        const homeHref = (role: string) =>
            visibleProviderNavItems(role).find((i) => i.key === 'dashboard')?.href;
        const homeLabel = (role: string) =>
            visibleProviderNavItems(role).find((i) => i.key === 'dashboard')?.label;

        expect(homeHref(CANONICAL_ROLES.DOCUMENT_REVIEWER)).toBe('/provider/reviewer');
        expect(homeHref(CANONICAL_ROLES.DISPATCHER)).toBe('/provider/coordinator');
        expect(homeHref(CANONICAL_ROLES.FIELD_INSPECTOR)).toBe('/provider/audits');
        // Both finance roles share one home (operator 2026-09-11) — was /dtam and /platform.
        expect(homeHref(CANONICAL_ROLES.FINANCE_OFFICER_DTAM)).toBe('/provider/accounting');
        expect(homeHref(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM)).toBe('/provider/accounting');
        // Task 7 (tile-home-nav, N1): ADMIN + legacy ACCOUNT now land on
        // tile home too (was: no landing entry, stayed on the generic
        // /provider/dashboard).
        expect(homeHref(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)).toBe('/provider/home');
        // Label is the role-neutral "หน้าหลัก" (Home), not the generic "แดชบอร์ด".
        expect(homeLabel(CANONICAL_ROLES.FIELD_INSPECTOR)).toBe('หน้าหลัก');
        expect(homeLabel(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)).toBe('หน้าหลัก');
    });

    it('PROV-NAV-1: applications nav is gated to its middleware set [ADMIN, DR, AUDITOR]', () => {
        // Was public-by-default → SCHEDULER + ACCOUNT* saw the link then bounced
        // (middleware admits only ADMIN/DR/AUDITOR). Now the nav matches the gate.
        for (const role of [CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR]) {
            expect(visibleProviderNavItems(role).map((i) => i.key)).toContain('applications');
        }
        for (const role of [
            CANONICAL_ROLES.DISPATCHER,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
        ]) {
            expect(visibleProviderNavItems(role).map((i) => i.key)).not.toContain('applications');
        }
    });

    it('PROV-NAV-1: calendar nav drops AUDITOR (middleware = [ADMIN, SCHEDULER])', () => {
        expect(visibleProviderNavItems(CANONICAL_ROLES.FIELD_INSPECTOR).map((i) => i.key)).not.toContain('calendar');
        expect(visibleProviderNavItems(CANONICAL_ROLES.DISPATCHER).map((i) => i.key)).toContain('calendar');
    });

    it('P1-F: a null / unknown role renders the LEAST-PRIVILEGE nav (no admin items — fail-closed)', () => {
        // Was previously "falls back to admin behaviour (shows all)". The provider
        // layout swallows a failed /auth/provider/me and passes role=null; showing
        // the full admin nav then leaked every admin-only link to an errored /
        // unauthenticated session. Fail-closed: null renders ONLY the unrestricted
        // items — never the role-gated ones (accounting/settings/…). Routes still
        // enforce; this is display-only over-exposure closed.
        const keys = visibleProviderNavItems(null).map((i) => i.key);
        // No role-gated item leaks:
        expect(keys).not.toContain('accounting'); // gated → [ADMIN, ACCOUNT*]
        expect(keys).not.toContain('settings');   // gated → [ADMIN]
        expect(keys).not.toContain('work');        // gated → [ADMIN]
        expect(keys).not.toContain('applications'); // gated → [ADMIN, DR, AUDITOR]
        expect(keys).not.toContain('audits');       // gated → [ADMIN, AUDITOR]
        expect(keys).not.toContain('calendar');     // gated → [ADMIN, SCHEDULER]
        // Unrestricted items (no NAV_ROLE_RULES entry) still render — the home
        // affordance + any public link survive so the shell isn't blank-broken.
        expect(keys).toContain('dashboard');
    });

    it('P1-F: a null role sees strictly FEWER items than ADMIN (never the full admin set)', () => {
        const nullKeys = visibleProviderNavItems(null).map((i) => i.key);
        const adminKeys = visibleProviderNavItems(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM).map((i) => i.key);
        expect(nullKeys.length).toBeLessThan(adminKeys.length);
    });
});
