/**
 * Provider portal role config — SINGLE SOURCE OF TRUTH (architecture Phase 1).
 *
 * Before this module, three separate places independently decided what a
 * provider role may see/do, and they could silently drift:
 *   1. NAV_ROLE_RULES        (lib/constants.ts)        — which sidebar links show
 *   2. PROVIDER_ROUTE_ROLE_RULES (lib/middleware-helpers.ts) — which URLs admit
 *   3. a hardcoded landing switch (app/provider/dashboard/page.tsx) — post-login home
 * Items 1↔2 were coherence-tested (nav ⊆ route); the landing switch (#3) was an
 * UNTESTED third source — a role could be auto-routed to a page it can't enter.
 *
 * This module owns all three as one ordered `PROVIDER_AREAS` table; the legacy
 * exports `NAV_ROLE_RULES` (constants.ts) + `PROVIDER_ROUTE_ROLE_RULES`
 * (middleware-helpers.ts) are now PROJECTIONS of it, re-exported under their
 * original names so every consumer + the 5 existing guard tests are unchanged.
 * `landing-route-coherence.test.ts` adds the new "landing ∈ allowed routes" guard.
 *
 * EDGE-SAFE: middleware.ts (Edge runtime) imports the route projection via
 * middleware-helpers.ts, so this module MUST import ONLY ./constants/canonical-roles
 * (a pure module). Do NOT import ./constants (it pulls lucide-react) or anything
 * node/next-only — it would break the Edge build (PR CI does not run `next build`).
 *
 * ORDER IS LOAD-BEARING: PROVIDER_ROUTE_ROLE_RULES is consumed via
 * `rules.find(r => pathname.startsWith(r.prefix))` (first-match-wins), so the
 * AREA order below — and each area's `routes` order — reproduces the exact
 * shipping order (/admin first, every specific prefix before any bare prefix).
 * middleware-matrix-final.test.ts pins this ordering.
 */

import { CANONICAL_ROLES, normalizeRole, isProviderRole } from './constants/canonical-roles';

const R = CANONICAL_ROLES;

export interface ProviderArea {
  /** stable internal id (not user-facing) */
  id: string;
  /** URL-gate prefixes this area contributes to PROVIDER_ROUTE_ROLE_RULES, in order */
  routes?: ReadonlyArray<{ prefix: string; roles: readonly string[] }>;
  /**
   * Sidebar visibility rules this area contributes to NAV_ROLE_RULES. `key` is a
   * providerNavigation item key (or a legacy "dead" key with no item — e.g.
   * `coordinator`/`management` — kept because nav-role-rules.test.ts pins them).
   * navRoles MUST be a subset of the matching route's roles (coherence invariant,
   * guarded by nav-middleware-coherence.test.ts).
   */
  navRules?: ReadonlyArray<{ key: string; roles: string[] }>;
  /** post-login landing: roles auto-routed to `path` from the generic dashboard */
  landing?: { roles: readonly string[]; path: string };
}

/**
 * The ordered area table. Authored in the exact current route order so the
 * flattened route projection is byte-identical to the previous literal.
 */
export const PROVIDER_AREAS: readonly ProviderArea[] = [
  {
    id: 'admin-area',
    // /admin is gated by the same provider middleware. ADMIN reaches all of /admin;
    // PLATFORM_ADMIN (cross-tenant governance) reaches ONLY its org-management portal
    // /admin/organizations. The specific prefix MUST precede the bare /admin (the
    // projection is consumed first-match-wins) so platform_admin is admitted there but
    // still bounced from the rest of /admin. (multi-role system test 2026-06-24)
    routes: [
      { prefix: '/admin/organizations', roles: [R.SYSTEM_ADMIN_DTAM, R.SYSTEM_ADMIN_PLATFORM] },
      { prefix: '/admin', roles: [R.SYSTEM_ADMIN_DTAM] },
    ],
    // P1-F: surface the admin console in the provider sidebar for ADMIN only.
    // The `admin-console` nav item (constants.ts, href=/admin/dashboard) was
    // previously unreachable from /provider/dashboard. navRoles ⊆ route roles
    // (ADMIN ∈ [ADMIN]) so nav-middleware-coherence stays green; ADMIN bypasses
    // every per-prefix rule in decideProviderRouteAccess.
    navRules: [{ key: 'admin-console', roles: [R.SYSTEM_ADMIN_DTAM] }],
    landing: { roles: [R.SYSTEM_ADMIN_PLATFORM], path: '/admin/organizations' },
  },
  {
    id: 'applications',
    routes: [{ prefix: '/provider/applications', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR] }],
    navRules: [{ key: 'applications', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR] }],
  },
  {
    id: 'reviewer',
    // B5 ("different departments → different pages"): the DOCUMENT_REVIEWER lands on
    // its OWN dedicated launchpad (/provider/reviewer) instead of the shared generic
    // /provider/dashboard. Admitted to [ADMIN, DOCUMENT_REVIEWER]; ADMIN may open it
    // by URL but keeps its own landing on /provider/dashboard. No nav rule is added:
    // the sidebar "dashboard" item is always-visible and points at /provider/dashboard,
    // which redirects DOCUMENT_REVIEWER to /provider/reviewer via providerLandingPath —
    // so the home affordance resolves correctly while nav⊆route coherence is untouched
    // (the dashboard item's href is unlisted = allow for every provider role).
    routes: [{ prefix: '/provider/reviewer', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER] }],
    landing: { roles: [R.DOCUMENT_REVIEWER], path: '/provider/reviewer' },
  },
  {
    id: 'accounting',
    // One accounting area for both finance roles (operator 2026-09-11 "finance
    // ต้องเห็นเหมือนกัน"): the per-side landing URLs /provider/accounting/dtam and
    // /provider/accounting/platform (B5) were removed — both roles land on the
    // same /provider/accounting and open the same pages. The write buttons on
    // those pages follow the backend write sets (operator 2026-09-27 "กรมฯ ดูอย่างเดียว").
    // The field inspector no longer reaches these pages (operator 2026-09-27: the
    // inspection job reaches the inspector only after payment, so billing is not
    // theirs to see) — route roles now equal nav roles.
    routes: [
      { prefix: '/provider/accounting', roles: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM] },
      { prefix: '/provider/receipts', roles: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM] },
    ],
    navRules: [{ key: 'accounting', roles: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM] }],
    landing: { roles: [R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM], path: '/provider/accounting' },
  },
  {
    id: 'scheduling',
    routes: [
      { prefix: '/provider/calendar', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
      { prefix: '/provider/scheduler', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
      // P2-2: the scheduler auto-routes here on login; gate the route so other
      // provider roles can't reach it by URL (was rule-less = open).
      { prefix: '/provider/coordinator', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
    ],
    // `calendar` = the real nav item; `coordinator` = a legacy dead nav key (no
    // providerNavigation item) kept for byte-equality with the old NAV_ROLE_RULES.
    navRules: [
      { key: 'calendar', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
      { key: 'coordinator', roles: [R.SYSTEM_ADMIN_DTAM, R.DISPATCHER] },
    ],
    landing: { roles: [R.DISPATCHER], path: '/provider/coordinator' },
  },
  {
    id: 'audits',
    // X2-FIX-D M-19: DOCUMENT_REVIEWER excluded from the audits route + nav (DR
    // retains read access to audit timelines via per-application detail pages).
    routes: [{ prefix: '/provider/audits', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR] }],
    navRules: [{ key: 'audits', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR] }],
    landing: { roles: [R.FIELD_INSPECTOR], path: '/provider/audits' },
  },
  {
    // ผู้อนุมัติใบรับรอง — หน้าเดียว บทบาทเดียว (F-CERT-SOD 2026-09-10)
    // ตรงกับ ROLE_GROUPS.CERT_DECIDERS ฝั่งหลังบ้านเป๊ะ ๆ: ไม่มีทั้งผู้ตรวจประเมินแปลง
    // และ admin · หน้าจอที่พาไปหาประตูที่ 403 คือหน้าจอที่โกหก
    id: 'certification-decisions',
    routes: [{ prefix: '/provider/certification-decisions', roles: [R.CERTIFICATE_APPROVER] }],
    navRules: [{ key: 'certification-decisions', roles: [R.CERTIFICATE_APPROVER] }],
    landing: { roles: [R.CERTIFICATE_APPROVER], path: '/provider/certification-decisions' },
  },
  {
    id: 'image-assessment',
    // สัญญา C05F680149 ต้นแบบที่ 6 (ตรวจสอบและประเมินภาพ 3 โมดูล): ทุก endpoint
    // /api/image-assessment/* — รวม /catalog อ่านอย่างเดียว — gated ด้วย
    // ROLE_GROUPS.AUDIT_STAFF (routes/api/audit/image-assessment.js). เดิม nav ไม่มี
    // rule → ACCOUNT_DTAM/ACCOUNT_PLATFORM/legacy ACCOUNT/PLATFORM_ADMIN เห็นเมนู
    // "ตรวจประเมินภาพ" แต่ทุก call 403 = หน้าตาย. ซ่อน nav ให้ตรง backend
    // (AUDIT_STAFF = ADMIN/DOCUMENT_REVIEWER/AUDITOR/SCHEDULER). ไม่ตั้ง route rule —
    // ปล่อย default-allow (backend 403 คุมจริง); nav ⊆ route ยังคงจริง.
    navRules: [{ key: 'image-assessment', roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.DISPATCHER] }],
  },
  {
    id: 'tracking',
    // T&T ชั้นพนักงานติดตาม — มติ operator 2026-09-05
    // (docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §3.3):
    // *"เห็นข้อมูลทั้งหมด" + "ฟาร์มทุกประเทศ"* ⇒ ห้ามมีตัวกรองการมอบหมายงาน
    // มาบังฟาร์ม และห้ามผูกจอนี้กับเรื่องเงิน ("คนละหน้าที่")
    //
    // ไม่ตั้ง `routes` โดยเจตนา: ประตูหลังบ้าน /api/provider/planting-cycles
    // gate ด้วย APPLICATION_VIEW_ALL ซึ่ง shared/canonical-rbac.js ให้กับ
    // provider role ทุกตัว การตั้งกฎ URL ที่แคบกว่าหลังบ้านจะทำให้ FE กับ BE
    // พูดคนละอย่าง · unlisted /provider/* = default-allow ทุก provider role
    // (แบบเดียวกับ area 'image-assessment' และ 'work') และ backend คือผู้บังคับจริง
    //
    // navRoles จำกัดที่ ADMIN + AUDITOR + DOCUMENT_REVIEWER เพราะ *เมนู* คือการ
    // ประกาศว่างานนี้เป็นของใคร งานติดตามฟาร์มคืองานของสายตรวจ ไม่ใช่สายการเงิน
    // (SCHEDULER ยังเข้าทาง URL ได้ตามกฎ default-allow ข้างบน — ซ่อนเมนู ไม่ตัดสิทธิ์)
    // · nav ⊆ route ยังจริงเพราะ route เปิดกว้างกว่า
    navRules: [{ key: 'tracking', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR, R.DOCUMENT_REVIEWER] }],
  },
  {
    id: 'analytics',
    routes: [{
      prefix: '/provider/analytics',
      roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM],
    }],
    navRules: [{
      key: 'analytics',
      roles: [R.SYSTEM_ADMIN_DTAM, R.DOCUMENT_REVIEWER, R.FIELD_INSPECTOR, R.FINANCE_OFFICER_PLATFORM, R.FINANCE_OFFICER_DTAM, R.FINANCE_OFFICER_PLATFORM],
    }],
  },
  {
    id: 'certificates',
    // C1-3 (role-specific nav): the certificates ROUTE stays admitted to
    // [ADMIN, AUDITOR, DOCUMENT_REVIEWER] so the reviewer keeps URL access (e.g. a
    // cert link from an application detail page), but the sidebar NAV link is hidden
    // from DOCUMENT_REVIEWER — the reviewer neither issues nor needs certs. This is a
    // deliberate menu-hide-but-URL-allow (route roles ⊃ nav roles), the same pattern
    // the auditor↔accounting case uses; nav-middleware-coherence stays green because
    // nav ⊆ route still holds.
    routes: [{ prefix: '/provider/certificates', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR, R.DOCUMENT_REVIEWER] }],
    navRules: [{ key: 'certificates', roles: [R.SYSTEM_ADMIN_DTAM, R.FIELD_INSPECTOR] }],
  },
  {
    id: 'management',
    // `management` is a legacy dead nav key (no providerNavigation item) but a real
    // admin-only route. Kept in NAV_ROLE_RULES for byte-equality (test pins it).
    routes: [{ prefix: '/provider/management', roles: [R.SYSTEM_ADMIN_DTAM] }],
    navRules: [{ key: 'management', roles: [R.SYSTEM_ADMIN_DTAM] }],
  },
  {
    id: 'criteria',
    // M7: admin-only GACP-criteria CRUD (backend criteria.js gates every route with
    // authenticateProvider + adminOnly). Was rule-less → any provider role could URL in
    // and render the create/edit/delete UI (backend 403s, but defense-in-depth gap). No
    // nav item (admin reaches it directly); add one later if it needs an affordance.
    routes: [{ prefix: '/provider/criteria', roles: [R.SYSTEM_ADMIN_DTAM] }],
  },
  {
    id: 'settings',
    // L6: gate the whole /provider/settings subtree (system + work-config) to ADMIN.
    // Previously only /provider/settings/system was listed, so /provider/settings/work-config
    // rendered the admin-only SLA/stage config UI for any provider role (backend 403s — UX/
    // defense-in-depth gap). startsWith('/provider/settings') covers both + the bare path.
    routes: [{ prefix: '/provider/settings', roles: [R.SYSTEM_ADMIN_DTAM] }],
    navRules: [{ key: 'settings', roles: [R.SYSTEM_ADMIN_DTAM] }],
  },
  {
    id: 'work',
    // ADR-016 Phase 1A introduced the generic /provider/work queue as a shared
    // unified inbox for every staff role. C1-2 (role-specific nav) retires it from
    // the sidebar for non-admin roles: every role now has its OWN dashboard
    // (reviewer/coordinator/audits/accounting) that already shows its role-scoped
    // queue, so the generic "งานของฉัน" inbox is redundant for them. The ROUTE stays
    // unlisted (the bare /provider/work path is still default-allowed to any provider
    // role — no access removed), only the nav link is restricted to ADMIN.
    // nav ⊆ route holds: an unlisted route is allow-for-all, so [ADMIN] ⊆ all.
    navRules: [{ key: 'work', roles: [R.SYSTEM_ADMIN_DTAM] }],
  },
  {
    id: 'tile-home-landing',
    // Task 7 (tile-home-nav, N1/N7): ADMIN and legacy ACCOUNT had no area
    // above with a `landing` entry, so providerLandingPath fell through to
    // null and both roles landed on the pre-tile-home /provider/dashboard
    // (~600-line legacy page) after login. N1 — "ใช้ tile home กับทุก role
    // ทั้งระบบ" — makes /provider/home the universal landing surface; these
    // two roles now get it like every other provider role. (platform_admin
    // is untouched: its landing already points at /admin/organizations, its
    // only entitled surface — not the dashboard.)
    //
    // No `routes` entry is added: /provider/home is an UNLISTED /provider/*
    // path, which decideProviderRouteAccess treats as default-allow for any
    // valid provider role — so landing-route-coherence's "landing ∈ allowed
    // routes" guard holds without widening PROVIDER_ROUTE_ROLE_RULES.
    landing: { roles: [R.SYSTEM_ADMIN_DTAM, R.FINANCE_OFFICER_PLATFORM], path: '/provider/home' },
  },
];

/**
 * Route-admission projection — ordered flatten of every area's `routes`.
 * Re-exported by middleware-helpers.ts under the legacy name so middleware.ts +
 * the matrix tests import the exact same table. Order preserved (first-match-wins).
 */
export const PROVIDER_ROUTE_ROLE_RULES: ReadonlyArray<{ prefix: string; roles: readonly string[] }> =
  PROVIDER_AREAS.flatMap((area) => area.routes ?? []);

/**
 * Nav-visibility projection — keyed by nav item key. Sections with no navRules
 * contribute nothing; `dashboard` deliberately has NO entry (always visible).
 * Re-exported by constants.ts under the legacy name. Mutable string[] values to
 * match the existing `Record<string, string[]>` type.
 */
export const NAV_ROLE_RULES: Record<string, string[]> = Object.fromEntries(
  PROVIDER_AREAS.flatMap((area) => area.navRules ?? []).map((rule) => [rule.key, [...rule.roles]]),
);

/**
 * Post-login landing projection — roles → home path (first match wins),
 * one `landing` per area, in area order.
 */
export const PROVIDER_LANDING: ReadonlyArray<{ roles: readonly string[]; path: string }> =
  PROVIDER_AREAS.flatMap((area) => (area.landing ? [area.landing] : []));

/**
 * The post-login landing path for a role, or `null` to stay on the generic
 * `/provider/dashboard`. Replaces the hardcoded switch in dashboard/page.tsx.
 * admin / document_reviewer / legacy account / unknown / null → null (fall through),
 * exactly as before. The destination is guaranteed to be a route the role may
 * enter by landing-route-coherence.test.ts.
 */
export function providerLandingPath(role: string | null | undefined): string | null {
  const normalized = normalizeRole(role);
  if (!normalized) {
    return null;
  }
  const match = PROVIDER_LANDING.find((entry) => entry.roles.includes(normalized));
  return match ? match.path : null;
}

/**
 * Whether `role` may open `path` under PROVIDER_ROUTE_ROLE_RULES — the boolean
 * mirror of decideProviderRouteAccess's 'allow' decision (admin bypass · first
 * prefix match · unlisted /provider/* default-allowed to any provider role).
 *
 * Use this to GUARD in-page links/buttons so a role is never shown an affordance
 * that the middleware will bounce (the "เด่งไปเด่งมา" class — e.g. the scheduler's
 * coordinator page linking to /provider/applications, which it can't enter, looping
 * it back home). The config-level nav⊆route coherence test only covers sidebar nav;
 * hardcoded in-page links need this guard. link-coherence.test.ts proves this stays
 * in lock-step with decideProviderRouteAccess.
 */
export function providerRoleCanOpen(role: string | null | undefined, path: string): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) {
    return false;
  }
  if (normalized === R.SYSTEM_ADMIN_DTAM) {
    return true; // admin bypasses every per-prefix rule (mirrors decideProviderRouteAccess)
  }
  const rule = PROVIDER_ROUTE_ROLE_RULES.find((item) => path.startsWith(item.prefix));
  if (!rule) {
    // Unlisted /provider/* path → admitted to any provider role (FE-XC-03 default).
    return isProviderRole(normalized);
  }
  return rule.roles.includes(normalized);
}
