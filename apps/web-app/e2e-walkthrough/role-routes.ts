/**
 * Route + role inventory for the STAGING-WALKTHROUGH capture kit.
 *
 * Two sources, both read from the real app — no hand-typed duplicate route
 * list to go stale after the next deploy (mission requirement: "kit ต้อง
 * generic พอที่จะรันซ้ำหลัง deploy ใหม่"):
 *
 *   1. `discoverRoutes()` walks every `page.tsx` under `src/app/**` at import
 *      time and converts each file path into a URL. Route groups like
 *      `(marketing)`/`(auth)`/`(public)` are stripped (Next.js does not put
 *      them in the URL). This is the full, current page inventory.
 *
 *   2. `providerRoleCanOpen()` / `CANONICAL_ROLES`, imported DIRECTLY (by
 *      relative path, not the `@/` alias — this file runs under Playwright's
 *      plain Node/esbuild loader, not the Next.js bundler) from
 *      `src/lib/provider-role-config.ts`. That module is the app's own single
 *      source of truth for "which canonical role may open which
 *      /provider/**` path" (its own header states it imports nothing
 *      Next/React-only, specifically so it stays Edge-safe — which also
 *      makes it safe to import here). Reusing it means this kit carries NO
 *      second copy of the RBAC table (the project rules §3.6 single-source-of-truth);
 *      each provider-family role's route list is computed from the real
 *      rules, not retyped by hand.
 *
 * Dynamic routes (`[id]`, `[qr-code]`, `[cert-number]`, ...) are EXCLUDED —
 * there is no seeded record id this kit is allowed to guess (same
 * no-guessing principle the mission states for credentials: "ห้ามเดารหัส").
 * They are still listed via `DYNAMIC_ROUTES` so the gap is visible in the
 * manifest instead of silently missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { providerRoleCanOpen } from '../src/lib/provider-role-config';
import { CANONICAL_ROLES } from '../src/lib/constants/canonical-roles';
// Pure string-constant module (no Next/React import, verified 2026-08-07 —
// same edge-safety requirement as provider-role-config above), so it is safe
// to reuse here too: the app's own SSOT for "which paths this login route can
// be reached at" (canonical + pre-rename legacy alias), not a second
// hand-typed path list (the project rules §3.6). Feeds loginPaths/officerLinkFallback
// below, which walkthrough.spec.ts's loginRole() tries in order — the
// 2026-08-07 first staging run found the configured canonical path alone was
// not enough against the ~22-Jul staging build.
import {
  HEALTH_LOGIN_ALIASES,
  PROVIDER_LOGIN_ALIASES,
} from '../src/lib/constants/auth-routes';

const APP_DIR = path.resolve(__dirname, '../src/app');
const WEB_APP_DIR = path.resolve(__dirname, '..');

export interface RouteInfo {
  /** URL path, e.g. '/health/applications' */
  route: string;
  /** true if any path segment is a Next.js dynamic segment, e.g. `[id]` */
  dynamic: boolean;
  /** page.tsx path, relative to apps/web-app — for the manifest / debugging */
  sourceFile: string;
}

function toUrlSegments(relDir: string): string[] {
  if (relDir === '') return [];
  return relDir
    .split(path.sep)
    // Route groups `(marketing)` etc. are a Next.js organizational device and
    // never appear in the actual URL.
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
}

/** Recursively find every `page.tsx` under `src/app` and convert it to a route. */
function discoverRoutes(): RouteInfo[] {
  const out: RouteInfo[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name === 'page.tsx') {
        const relDir = path.relative(APP_DIR, dir);
        const segments = toUrlSegments(relDir);
        const route = segments.length === 0 ? '/' : `/${segments.join('/')}`;
        const dynamic = segments.some((s) => s.startsWith('[') && s.endsWith(']'));
        out.push({ route, dynamic, sourceFile: path.relative(WEB_APP_DIR, abs) });
      }
    }
  }
  walk(APP_DIR);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

export const ALL_ROUTES: RouteInfo[] = discoverRoutes();
export const DYNAMIC_ROUTES: RouteInfo[] = ALL_ROUTES.filter((r) => r.dynamic);

function staticRoutesUnder(prefixes: string[]): RouteInfo[] {
  return ALL_ROUTES.filter(
    (r) => !r.dynamic && prefixes.some((p) => r.route === p || r.route.startsWith(`${p}/`)),
  );
}

const healthRoutes = staticRoutesUnder(['/health']);
const providerRoutesAll = staticRoutesUnder(['/provider']);
const adminRoutesAll = staticRoutesUnder(['/admin']);
// "public" = everything that is not gated behind a /health, /provider or
// /admin login — includes the marketing site, the login/register pages
// themselves, /help, /verify, /trace (the public QR-scan landing), etc.
const publicRoutes = ALL_ROUTES.filter(
  (r) => !r.dynamic
    && !r.route.startsWith('/health')
    && !r.route.startsWith('/provider')
    && !r.route.startsWith('/admin'),
);

function providerRoutesFor(canonicalRole: string): RouteInfo[] {
  return providerRoutesAll.filter((r) => providerRoleCanOpen(canonicalRole, r.route));
}

export type WalkRoleKey =
  | 'public' | 'farmer' | 'reviewer' | 'auditor' | 'scheduler' | 'account' | 'admin';

export interface AuthConfig {
  /**
   * Ordered candidate login paths — walkthrough.spec.ts's loginRole() tries
   * each in turn (canonical path first) until one yields a fillable ID
   * field. Sourced from HEALTH_LOGIN_ALIASES/PROVIDER_LOGIN_ALIASES
   * (auth-routes.ts) so an older deployed build still serving the
   * pre-rename legacy alias is covered without a second hand-typed path.
   */
  loginPaths: readonly string[];
  /**
   * Officer-portal roles only. If every path in `loginPaths` fails to reach
   * a fillable form, loginRole() falls back to each path here (the
   * citizen/health login page) and clicks the first visible link whose
   * accessible name matches `linkPattern` — the "สำหรับเจ้าหน้าที่ / For
   * Officers" link `health-login-page.tsx` renders — for a build where the
   * provider login route is reachable only by navigating through that link.
   */
  officerLinkFallback?: { fromPaths: readonly string[]; linkPattern: RegExp };
  /** CSS selectors tried before the generic input[...] fallback in loginRole(). */
  idSelectors: readonly string[];
  idLabelPattern: RegExp;
  idPlaceholderPattern?: RegExp;
  pwSelectors: readonly string[];
  pwLabelPattern: RegExp;
  submitSelectors: readonly string[];
  submitNamePattern: RegExp;
  /** true once the post-login redirect has landed on an authenticated page */
  landed: (url: URL) => boolean;
  idEnvVar: string;
  pwEnvVar: string;
}

export interface RoleDef {
  key: WalkRoleKey;
  labelTh: string;
  /** null = public, no login required */
  auth: AuthConfig | null;
  routes: RouteInfo[];
}

function providerLoginAuth(roleKey: WalkRoleKey): AuthConfig {
  return {
    // Same login route + field ids the app itself uses — see
    // apps/web-app/e2e/helpers/provider-auth.ts (#provider-id / #provider-password,
    // redesigned provider login page) — PROVIDER_LOGIN_ALIASES[0] is that
    // canonical path; [1] is the pre-rename legacy alias, tried second.
    loginPaths: PROVIDER_LOGIN_ALIASES,
    officerLinkFallback: {
      fromPaths: HEALTH_LOGIN_ALIASES,
      linkPattern: /สำหรับเจ้าหน้าที่|for officers?/i,
    },
    idSelectors: ['#provider-id', 'input[name="providerId"]'],
    idLabelPattern: /เลขประจำตัวเจ้าหน้าที่|provider id/i,
    idPlaceholderPattern: /x-xxxx-xxxxx-xx-x/i,
    pwSelectors: ['#provider-password', 'input[name="password"]'],
    pwLabelPattern: /รหัสผ่าน|password/i,
    submitSelectors: ['button[type="submit"]'],
    submitNamePattern: /เข้าสู่ระบบ|sign in|login/i,
    landed: (url) => /\/provider\//.test(url.pathname) && !/\/auth\//.test(url.pathname),
    idEnvVar: `WALK_${roleKey.toUpperCase()}_ID`,
    pwEnvVar: `WALK_${roleKey.toUpperCase()}_PW`,
  };
}

export const ROLE_DEFS: RoleDef[] = [
  {
    key: 'public',
    labelTh: 'สาธารณะ (ไม่ต้องล็อกอิน)',
    auth: null,
    routes: publicRoutes,
  },
  {
    key: 'farmer',
    labelTh: 'เกษตรกร (Health portal)',
    auth: {
      // Same login route + field ids as apps/web-app/e2e/helpers/auth.ts —
      // HEALTH_LOGIN_ALIASES[0] is that canonical path; [1] is the
      // pre-rename legacy alias, tried second.
      loginPaths: HEALTH_LOGIN_ALIASES,
      idSelectors: ['#identifier', 'input[name="identifier"]'],
      idLabelPattern: /เลขประจำตัวประชาชน|national id/i,
      idPlaceholderPattern: /x-xxxx-xxxxx-xx-x/i,
      pwSelectors: ['#password', 'input[name="password"]'],
      pwLabelPattern: /รหัสผ่าน|password/i,
      submitSelectors: ['button[type="submit"]'],
      submitNamePattern: /เข้าสู่ระบบ|sign in|login/i,
      landed: (url) => url.pathname.startsWith('/health/dashboard'),
      idEnvVar: 'WALK_FARMER_ID',
      pwEnvVar: 'WALK_FARMER_PW',
    },
    routes: healthRoutes,
  },
  {
    key: 'reviewer',
    labelTh: 'ผู้ตรวจเอกสาร (document_reviewer)',
    auth: providerLoginAuth('reviewer'),
    routes: providerRoutesFor(CANONICAL_ROLES.DOCUMENT_REVIEWER),
  },
  {
    key: 'auditor',
    labelTh: 'ผู้ตรวจประเมินพื้นที่ (auditor)',
    auth: providerLoginAuth('auditor'),
    routes: providerRoutesFor(CANONICAL_ROLES.FIELD_INSPECTOR),
  },
  {
    key: 'scheduler',
    labelTh: 'ผู้จัดตารางนัดหมาย (scheduler)',
    auth: providerLoginAuth('scheduler'),
    routes: providerRoutesFor(CANONICAL_ROLES.DISPATCHER),
  },
  {
    key: 'account',
    labelTh: 'การเงิน/บัญชี (account)',
    auth: providerLoginAuth('account'),
    routes: providerRoutesFor(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM),
  },
  {
    key: 'admin',
    labelTh: 'ผู้ดูแลระบบ (admin)',
    auth: providerLoginAuth('admin'),
    // ADMIN bypasses every per-prefix rule in providerRoleCanOpen (mirrors the
    // real middleware), so providerRoutesFor(ADMIN) already equals
    // providerRoutesAll — added explicitly for readability, plus the
    // /admin/** console routes that only ADMIN (and PLATFORM_ADMIN, not
    // captured separately by this kit) can reach.
    routes: [...providerRoutesFor(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM), ...adminRoutesAll],
  },
];
