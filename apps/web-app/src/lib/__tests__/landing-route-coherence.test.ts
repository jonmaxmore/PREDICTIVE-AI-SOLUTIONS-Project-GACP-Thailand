/**
 * Role-config Phase 1 — provider-role-config.ts is the single source of truth.
 *
 * Two jobs:
 *   1. PROJECTION FIDELITY — prove PROVIDER_ROUTE_ROLE_RULES + NAV_ROLE_RULES,
 *      now derived from PROVIDER_AREAS, are byte-identical (incl. ordering for the
 *      route table) to the pre-refactor literals. This is the equivalence proof
 *      that the consolidation changed NO behavior. (Closes refactor risks R1
 *      ordering / R2 dead-keys / R3 dashboard-no-rule from the design brief.)
 *   2. LANDING ∈ ALLOWED ROUTES — the new coherence guard that the old hardcoded
 *      landing switch lacked: every post-login destination a role is auto-routed
 *      to MUST be a route that role is admitted to. A future edit that points a
 *      role at a page it can't enter now fails CI. This is the post-login-landing
 *      analogue of nav-middleware-coherence.test.ts (nav ⊆ route).
 */

import { describe, expect, it } from '@jest/globals';

import {
  PROVIDER_ROUTE_ROLE_RULES,
  NAV_ROLE_RULES,
  PROVIDER_LANDING,
  providerLandingPath,
  providerRoleCanOpen,
} from '../provider-role-config';
import { decideProviderRouteAccess } from '../middleware-helpers';
import { CANONICAL_ROLES } from '../constants/canonical-roles';

const R = CANONICAL_ROLES;

describe('[role-config Phase 1] PROVIDER_ROUTE_ROLE_RULES projection fidelity', () => {
  it('is byte-identical (and order-identical) to the pre-refactor literal', () => {
    // First-match-wins ordering is load-bearing — assert exact array order.
    expect(PROVIDER_ROUTE_ROLE_RULES).toEqual([
      // platform_admin org-portal carve-out precedes the bare /admin (first-match-wins).
      { prefix: '/admin/organizations', roles: [R.SYSTEM_ADMIN_DTAM, R.SYSTEM_ADMIN_PLATFORM] },
      { prefix: '/admin', roles: [R.SYSTEM_ADMIN_DTAM] },
      { prefix: '/provider/applications', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR] },
      // B5: DOCUMENT_REVIEWER's own launchpad route, admitted to [ADMIN, DR].
      { prefix: '/provider/reviewer', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER] },
      // One accounting area for both finance roles (operator 2026-09-11) — the B5
      // per-side prefixes /provider/accounting/dtam and /platform were removed.
      // operator 2026-09-27 S6: field_inspector does not read finance data — was admitted here
      { prefix: '/provider/accounting', roles: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM] },
      { prefix: '/provider/receipts', roles: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM] },
      { prefix: '/provider/calendar', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
      { prefix: '/provider/scheduler', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
      { prefix: '/provider/coordinator', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
      { prefix: '/provider/audits', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR] },
      // ผู้อนุมัติใบรับรอง (F-CERT-SOD 2026-09-10) — ผู้ตรวจประเมินแปลงไม่อยู่ในรายชื่อ
      { prefix: '/provider/certification-decisions', roles: [R.CERTIFICATE_APPROVER] },
      { prefix: '/provider/analytics', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM] },
      { prefix: '/provider/certificates', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR, R.DOCUMENT_REVIEWER] },
      { prefix: '/provider/management', roles: [R.SYSTEM_ADMIN_DTAM] },
      // M7: criteria CRUD is admin-only (backend criteria.js = authenticateProvider + adminOnly).
      { prefix: '/provider/criteria', roles: [R.SYSTEM_ADMIN_DTAM] },
      // L6: gate the whole /provider/settings subtree (system + work-config), not just /system.
      { prefix: '/provider/settings', roles: [R.SYSTEM_ADMIN_DTAM] },
    ]);
  });

  it('keeps the /admin area first; the /provider/settings subtree is admin-gated as a whole', () => {
    // /admin/organizations (platform_admin portal) precedes the bare /admin (first-match-wins).
    expect(PROVIDER_ROUTE_ROLE_RULES[0].prefix).toBe('/admin/organizations');
    expect(PROVIDER_ROUTE_ROLE_RULES[1].prefix).toBe('/admin');
    const prefixes = PROVIDER_ROUTE_ROLE_RULES.map((r) => r.prefix);
    // L6: a single /provider/settings rule now covers /system AND /work-config (startsWith).
    expect(prefixes).toContain('/provider/settings');
    expect(prefixes).not.toContain('/provider/settings/system');
    // M7: criteria is now gated.
    expect(prefixes).toContain('/provider/criteria');
  });

  it('one accounting area: no per-side prefix; both finance roles open the same pages', () => {
    const prefixes = PROVIDER_ROUTE_ROLE_RULES.map((r) => r.prefix);
    expect(prefixes).not.toContain('/provider/accounting/dtam');
    expect(prefixes).not.toContain('/provider/accounting/platform');
    for (const path of ['/provider/accounting', '/provider/accounting/reports', '/provider/accounting/wht', '/provider/receipts']) {
      for (const role of [R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM, R.SYSTEM_ADMIN_DTAM]) {
        expect(decideProviderRouteAccess(path, role, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
      }
    }
    // The reviewer is admitted to its own launchpad.
    expect(decideProviderRouteAccess('/provider/reviewer', R.DOCUMENT_REVIEWER, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
    expect(decideProviderRouteAccess('/provider/reviewer', R.SYSTEM_ADMIN_DTAM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
  });

  it('admits PLATFORM_ADMIN to /admin/organizations but bounces it from the rest of /admin', () => {
    // F4 (multi-role system test 2026-06-24): platform_admin was locked out + cookie-wiped
    // because normalizeRole returned null. It now reaches ONLY its org-management portal.
    expect(decideProviderRouteAccess('/admin/organizations', R.SYSTEM_ADMIN_PLATFORM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
    expect(decideProviderRouteAccess('/admin/organizations/abc', R.SYSTEM_ADMIN_PLATFORM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
    // ...but NOT the rest of /admin (backend /api/admin/* is admin-only anyway).
    expect(decideProviderRouteAccess('/admin/users', R.SYSTEM_ADMIN_PLATFORM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('redirect-provider-dashboard');
    // ADMIN still reaches all of /admin.
    expect(decideProviderRouteAccess('/admin/organizations', R.SYSTEM_ADMIN_DTAM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
    expect(decideProviderRouteAccess('/admin/users', R.SYSTEM_ADMIN_DTAM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
  });

  it('M7/L6: admin-only routes redirect non-admin provider roles', () => {
    for (const path of ['/provider/criteria', '/provider/settings/work-config', '/provider/settings/system']) {
      expect(decideProviderRouteAccess(path, R.SYSTEM_ADMIN_DTAM, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('allow');
      for (const role of [R.DISPATCHER, R.FIELD_INSPECTOR, R.DOCUMENT_REVIEWER, R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM]) {
        expect(decideProviderRouteAccess(path, role, PROVIDER_ROUTE_ROLE_RULES).decision).toBe('redirect-provider-dashboard');
      }
    }
  });
});

describe('[role-config Phase 1] NAV_ROLE_RULES projection fidelity', () => {
  it('is deep-equal to the pre-refactor literal (incl. legacy dead keys)', () => {
    expect(NAV_ROLE_RULES).toEqual({
      // P1-F: the admin console (/admin/dashboard) is now reachable from the
      // provider sidebar for ADMIN only (was: no clickable path from
      // /provider/dashboard). ADMIN bypasses every route rule so nav⊆route holds.
      'admin-console': [R.SYSTEM_ADMIN_DTAM],
      // C1-2: the generic work inbox is now ADMIN-only in the sidebar (each role has
      // its own dashboard queue); the route stays open (unlisted) so URL access is intact.
      work: [R.SYSTEM_ADMIN_DTAM],
      coordinator: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER],
      audits: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR],
      // ต้นแบบที่ 6 tool: AUDIT_STAFF-only (backend ROLE_GROUPS.AUDIT_STAFF) so
      // the finance/platform-admin roles don't see a dead surface.
      'image-assessment': [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.DISPATCHER],
      applications: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR],
      calendar: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER],
      analytics: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM],
      accounting: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM],
      // C1-3: certificates nav hides DOCUMENT_REVIEWER (route still admits it for URL access).
      certificates: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR],
      'certification-decisions': [R.CERTIFICATE_APPROVER],
      management: [R.SYSTEM_ADMIN_DTAM],
      settings: [R.SYSTEM_ADMIN_DTAM],
      // T&T ชั้นพนักงานติดตาม (มติ operator 2026-09-05, §3.3 ของ
      // docs/design/2026-09-05-tnt-loop-and-farmer-updates.md): เมนูของงานตรวจติดตาม
      // สายการเงินไม่เห็น เพราะมติเขียนว่าเรื่องเงิน "คนละหน้าที่ ไม่ได้อยู่ในคำว่าติดตาม"
      // route ไม่ถูกจดไว้ = default-allow ทุก provider role ตามหลังบ้านที่ให้
      // APPLICATION_VIEW_ALL กับทุก role (ซ่อนเมนู ไม่ตัดสิทธิ์ แบบ auditor↔accounting)
      tracking: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR, R.DOCUMENT_REVIEWER],
    });
  });

  it('has NO entry for `dashboard` (always-visible nav item, must stay unrestricted)', () => {
    expect(NAV_ROLE_RULES).not.toHaveProperty('dashboard');
  });
});

describe('[role-config Phase 1] landing ∈ allowed routes (new coherence guard)', () => {
  it('every PROVIDER_LANDING destination is a route its roles can enter', () => {
    for (const entry of PROVIDER_LANDING) {
      for (const role of entry.roles) {
        const decision = decideProviderRouteAccess(entry.path, role, PROVIDER_ROUTE_ROLE_RULES).decision;
        expect(decision).toBe('allow');
      }
    }
  });

  it('maps each role to its dedicated landing (B5 — different departments, different pages)', () => {
    expect(providerLandingPath(R.DISPATCHER)).toBe('/provider/coordinator');
    expect(providerLandingPath(R.FIELD_INSPECTOR)).toBe('/provider/audits');
    // B5: DOCUMENT_REVIEWER now lands on its own launchpad (was: null).
    expect(providerLandingPath(R.DOCUMENT_REVIEWER)).toBe('/provider/reviewer');
    // Both finance roles land on the one accounting page (operator 2026-09-11) —
    // was B5 /provider/accounting/dtam and /provider/accounting/platform.
    expect(providerLandingPath(R.FINANCE_OFFICER_DTAM)).toBe('/provider/accounting');
    expect(providerLandingPath(R.FINANCE_OFFICER_PLATFORM)).toBe('/provider/accounting');
  });

  it('ผู้ดูแลลงหน้ารวม · การเงินทั้งสองบทบาทลงหน้าบัญชีเดียวกัน · unknown/null/health เป็น null', () => {
    // Task 7 (tile-home-nav): ADMIN and legacy ACCOUNT previously fell
    // through to null (stayed on the generic /provider/dashboard). N1 —
    // "ใช้ tile home กับทุก role ทั้งระบบ" — makes /provider/home their
    // landing too, like every other provider role.
    expect(providerLandingPath(R.SYSTEM_ADMIN_DTAM)).toBe('/provider/home');
    expect(providerLandingPath(R.FINANCE_OFFICER_PLATFORM)).toBe('/provider/accounting');
    // HEALTH / unknown / null are not provider roles — no landing at all.
    expect(providerLandingPath(R.HEALTH)).toBeNull();
    expect(providerLandingPath(null)).toBeNull();
    expect(providerLandingPath(undefined)).toBeNull();
    expect(providerLandingPath('mystery_role')).toBeNull();
  });

  it('รับตัวพิมพ์ต่างของคำปัจจุบัน และปฏิเสธคำเก่า', () => {
    // providerLandingPath normalises internally, so an aliased JWT role still lands.
    expect(providerLandingPath('field_inspector')).toBe('/provider/audits');
    expect(providerLandingPath('document_reviewer')).toBe('/provider/reviewer');
    // คำเก่าแปลไม่ออกแล้ว — ไม่มีหน้าลงจอดให้
    expect(providerLandingPath('reviewer')).toBeNull();
  });
});

describe('[link-coherence] providerRoleCanOpen — guards in-page links against "เด่งไปเด่งมา"', () => {
  const ROLES = [
    R.SYSTEM_ADMIN_DTAM, R.DISPATCHER, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR,
    R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM, R.HEALTH,
  ];
  const PATHS = [
    '/provider/applications', '/provider/applications/abc-123',
    '/provider/audits', '/provider/accounting', '/provider/coordinator',
    '/provider/work', '/provider/dashboard', '/provider/settings/work-config',
  ];

  it('agrees with decideProviderRouteAccess for every role × path (no drift)', () => {
    for (const role of ROLES) {
      for (const path of PATHS) {
        const canOpen = providerRoleCanOpen(role, path);
        const allowed = decideProviderRouteAccess(path, role, PROVIDER_ROUTE_ROLE_RULES).decision === 'allow';
        expect(canOpen).toBe(allowed);
      }
    }
  });

  it('blocks the specific in-page links that were bouncing (regression guard)', () => {
    // scheduler coordinator page + work-inbox + 404 linked to /provider/applications,
    // which scheduler/account cannot enter → self-loop / bounce. Pin that they are blocked.
    expect(providerRoleCanOpen(R.DISPATCHER, '/provider/applications/x')).toBe(false);
    expect(providerRoleCanOpen(R.FINANCE_OFFICER_DTAM, '/provider/applications/x')).toBe(false);
    expect(providerRoleCanOpen(R.FINANCE_OFFICER_PLATFORM, '/provider/applications/x')).toBe(false);
    // and that the roles which SHOULD see them still can:
    expect(providerRoleCanOpen(R.SYSTEM_ADMIN_DTAM, '/provider/applications/x')).toBe(true);
    expect(providerRoleCanOpen(R.DOCUMENT_REVIEWER, '/provider/applications/x')).toBe(true);
    expect(providerRoleCanOpen(R.FIELD_INSPECTOR, '/provider/applications/x')).toBe(true);
  });

  it('gates the profile "System Settings" quick-action to admin only (4th guarded link)', () => {
    // profile/page.tsx "System Settings" → /provider/settings/system (admin-only). Showing
    // it to non-admin staff bounced them to the dashboard — same class as the 3 above.
    expect(providerRoleCanOpen(R.SYSTEM_ADMIN_DTAM, '/provider/settings/system')).toBe(true);
    for (const role of [R.DISPATCHER, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM]) {
      expect(providerRoleCanOpen(role, '/provider/settings/system')).toBe(false);
    }
  });

  it('null/unknown role → false; unlisted /provider/* → true for any provider role', () => {
    expect(providerRoleCanOpen(null, '/provider/applications')).toBe(false);
    expect(providerRoleCanOpen('mystery', '/provider/work')).toBe(false);
    // /provider/work + /provider/dashboard are unlisted → any provider role may open.
    expect(providerRoleCanOpen(R.DISPATCHER, '/provider/work')).toBe(true);
    expect(providerRoleCanOpen(R.FINANCE_OFFICER_DTAM, '/provider/dashboard')).toBe(true);
  });
});
