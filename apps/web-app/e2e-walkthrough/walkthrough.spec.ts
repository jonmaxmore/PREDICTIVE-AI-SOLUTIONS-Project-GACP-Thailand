/**
 * STAGING-WALKTHROUGH capture kit — screenshots (desktop + mobile) + video +
 * trace for every page this kit can discover, per role, against a real
 * staging host. NOT part of the regular suite: run with
 * `--config=playwright.walkthrough.config.ts` only (see that file for why).
 *
 * Design (per PROMPT mandate + the gacp-view-in-the-loop guideline):
 *   - Route list per role comes from `role-routes.ts` (filesystem + the app's
 *     own RBAC config) — nothing here hand-lists pages.
 *   - Credentials come ONLY from `WALK_<ROLE>_ID` / `WALK_<ROLE>_PW` env vars.
 *     If either is empty for a role, that role's authenticated pages are
 *     SKIPPED and recorded as such in the manifest — this file never guesses
 *     or falls back to a hardcoded password (mission: "ห้ามเดารหัส").
 *   - Every page load: wait for `networkidle` (best-effort — some pages poll,
 *     so this degrades to "proceed anyway" rather than failing the capture),
 *     then screenshot at 1440x900 (desktop) and 390x844 (mobile — the
 *     farmer-facing viewport per the work queue's "เกษตรกรใช้มือถือเป็นหลัก").
 *   - Dynamic ([id]) pages are not visited — see role-routes.ts.
 *   - Result: `evidence/staging-walkthrough/walkthrough-manifest.json`
 *     (captured/skipped/error, per page, real numbers — never summarized
 *     without the file existing) + one screenshot file per page per viewport
 *     under `evidence/staging-walkthrough/screenshots/<role>/`.
 *
 * Throttling for a first/slow run (optional, both default to "no limit"):
 *   WALK_ROLES=farmer,reviewer            — only run these roles
 *   WALK_MAX_ROUTES_PER_ROLE=10           — cap routes visited per role
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, Page, Locator } from '@playwright/test';
import { ROLE_DEFS, DYNAMIC_ROUTES, RoleDef, RouteInfo } from './role-routes';
// Pure string-constant module (see role-routes.ts's import comment) — reused
// here only for isLoginRoute(), the app's own definition of "this URL is a
// login page", as one of the post-login signals loginRole() below checks.
import { isLoginRoute } from '../src/lib/constants/auth-routes';

const EVIDENCE_DIR = process.env.WALK_EVIDENCE_DIR
  ? path.resolve(process.env.WALK_EVIDENCE_DIR)
  : path.resolve(__dirname, '../../../evidence/staging-walkthrough');
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'screenshots');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
type ViewportName = (typeof VIEWPORTS)[number]['name'];

const MAX_ROUTES = Number(process.env.WALK_MAX_ROUTES_PER_ROLE || 0) || undefined;
const ROLE_ALLOWLIST = (process.env.WALK_ROLES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

type PageStatus = 'captured' | 'error';

interface PageResult {
  seq: number;
  route: string;
  sourceFile: string;
  status: PageStatus;
  httpStatus: number | null;
  screenshots: Partial<Record<ViewportName, string>>;
  consoleErrorCount: number;
  error?: string;
}

/**
 * Diagnostic detail for a failed login attempt — added 2026-08-07 after the
 * first real staging run produced `authStatus: "skipped-login-failed"` for
 * all 6 authenticated roles with no further detail, making the actual cause
 * (seed/password-rotation failure vs. login-page mismatch on the ~22-Jul
 * staging build) unrecoverable from the manifest alone. `step` pins exactly
 * which part of loginRole() gave up; `screenshot` (when present) is a path
 * relative to EVIDENCE_DIR, matching PageResult.screenshots' path style.
 */
interface LoginFailure {
  step: 'goto' | 'fill-id' | 'fill-password' | 'submit' | 'redirect' | 'no-officer-link';
  path: string;
  message: string;
  screenshot?: string;
}

interface RoleResult {
  role: string;
  labelTh: string;
  authStatus: 'public' | 'authenticated' | 'skipped-no-creds' | 'skipped-login-failed';
  loginError?: LoginFailure;
  routesDiscovered: number;
  routesCaptured: number;
  artifactsDir?: string;
  pages: PageResult[];
}

// Populated by each role test, written once by afterAll. Valid ONLY because
// playwright.walkthrough.config.ts pins workers:1 / fullyParallel:false, so
// every test in this file runs sequentially in one worker process.
const roleResults: RoleResult[] = [];

function slugify(route: string): string {
  return route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '-');
}

/**
 * Locate a form field trying several strategies in priority order, so the
 * spec keeps working against a build whose DOM differs slightly from the
 * `role-routes.ts` config (id attribute renamed, label-only markup, etc.) —
 * added 2026-08-07 after the ~22-Jul staging build failed to log in on any of
 * the 6 authenticated roles. Returns the FIRST matching, existing locator;
 * throws (caller catches, per LoginFailure step) only when none of them do.
 */
async function locateField(
  page: Page,
  opts: { cssSelectors: readonly string[]; labelPattern?: RegExp | undefined; placeholderPattern?: RegExp | undefined; genericCss: string },
): Promise<Locator> {
  const strategies: Array<() => Locator> = [];
  if (opts.labelPattern) strategies.push(() => page.getByLabel(opts.labelPattern!));
  for (const css of opts.cssSelectors) strategies.push(() => page.locator(css));
  if (opts.placeholderPattern) strategies.push(() => page.getByPlaceholder(opts.placeholderPattern!));
  strategies.push(() => page.locator(opts.genericCss));

  for (const make of strategies) {
    try {
      const loc = make().first();
      // eslint-disable-next-line no-await-in-loop -- strategies are tried in
      // priority order, stopping at the first that exists; each check is cheap.
      if (await loc.count() > 0) return loc;
    } catch {
      // getByLabel/getByPlaceholder throw on some malformed a11y trees —
      // treat as "did not match", try the next strategy.
    }
  }
  throw new Error(
    `no field matched — tried label ${opts.labelPattern ?? '(none)'}, css [${opts.cssSelectors.join(', ')}], `
    + `placeholder ${opts.placeholderPattern ?? '(none)'}, generic "${opts.genericCss}"`,
  );
}

async function locateSubmit(page: Page, cssSelectors: readonly string[], namePattern: RegExp): Promise<Locator> {
  const strategies: Array<() => Locator> = [
    () => page.getByRole('button', { name: namePattern }),
    ...cssSelectors.map((css) => () => page.locator(css)),
    () => page.locator('button[type="submit"], input[type="submit"]'),
  ];
  for (const make of strategies) {
    try {
      const loc = make().first();
      // eslint-disable-next-line no-await-in-loop -- see locateField above.
      if (await loc.count() > 0) return loc;
    } catch {
      // try next strategy
    }
  }
  throw new Error(`no submit button matched — tried role-name ${namePattern}, css [${cssSelectors.join(', ')}], generic submit`);
}

/** One login attempt at ONE path (already-navigated or navigated here fresh). */
async function attemptLoginAt(
  page: Page,
  role: RoleDef,
  loginPath: string,
  id: string,
  pw: string,
): Promise<{ ok: true } | { ok: false; error: LoginFailure }> {
  const a = role.auth!;

  try {
    await page.goto(loginPath, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  } catch (e) {
    return { ok: false, error: { step: 'goto', path: loginPath, message: String((e as Error).message || e).slice(0, 300) } };
  }

  let idField: Locator;
  try {
    idField = await locateField(page, {
      cssSelectors: a.idSelectors,
      labelPattern: a.idLabelPattern,
      placeholderPattern: a.idPlaceholderPattern,
      genericCss: 'input[type="text"], input[inputmode="numeric"]',
    });
    await idField.fill(id, { timeout: 10_000 });
  } catch (e) {
    return { ok: false, error: { step: 'fill-id', path: loginPath, message: String((e as Error).message || e).slice(0, 300) } };
  }

  try {
    const pwField = await locateField(page, {
      cssSelectors: a.pwSelectors,
      labelPattern: a.pwLabelPattern,
      genericCss: 'input[type="password"]',
    });
    await pwField.fill(pw, { timeout: 10_000 });
  } catch (e) {
    return { ok: false, error: { step: 'fill-password', path: loginPath, message: String((e as Error).message || e).slice(0, 300) } };
  }

  try {
    const submit = await locateSubmit(page, a.submitSelectors, a.submitNamePattern);
    await submit.click({ timeout: 10_000 });
  } catch (e) {
    return { ok: false, error: { step: 'submit', path: loginPath, message: String((e as Error).message || e).slice(0, 300) } };
  }

  // Post-login signal 1 (authoritative): URL matches the role's known
  // dashboard prefix (role-routes.ts `landed`).
  try {
    await page.waitForURL((url) => a.landed(url), { timeout: 15_000 });
    return { ok: true };
  } catch {
    // Post-login signal 2 (fallback, for a build whose dashboard path does
    // not match the configured prefix): the URL moved off the login route
    // (isLoginRoute() — the app's own definition, not a re-guessed one) AND
    // the login form itself is gone. Neither on its own proves a successful
    // authenticated landing (a validation error can also swap the DOM
    // without navigating), so both are required together.
    await page.waitForTimeout(1_000); // let a slower client-side redirect settle
    const currentUrl = new URL(page.url());
    if (a.landed(currentUrl)) return { ok: true };
    const idStillVisible = await idField.isVisible().catch(() => false);
    if (!isLoginRoute(currentUrl.pathname) && !idStillVisible) return { ok: true };
    return {
      ok: false,
      error: { step: 'redirect', path: loginPath, message: `did not land on expected page — final URL: ${page.url()}` },
    };
  }
}

async function loginRole(page: Page, role: RoleDef): Promise<{ status: 'ok' | 'no-creds' | 'failed'; error?: LoginFailure }> {
  if (!role.auth) return { status: 'ok' };
  const a = role.auth;
  const id = process.env[a.idEnvVar];
  const pw = process.env[a.pwEnvVar];
  if (!id || !pw) return { status: 'no-creds' };

  let lastError: LoginFailure | undefined;
  const MAX_RATE_LIMIT_RETRIES = 3;

  for (const [i, loginPath] of a.loginPaths.entries()) {
    // Rate-limit backoff (staging shares the production droplet's login
    // rate-limiter — documented in .github/workflows/e2e-staging-nightly.yml's
    // header, same technique as e2e/helpers/auth.ts loginAsHealth) only makes
    // sense on the FIRST candidate path — a 404/selector-miss on a fallback
    // path is a routing mismatch, not something backoff fixes.
    const attempts = i === 0 ? MAX_RATE_LIMIT_RETRIES : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design,
      // same shared-page/session reasoning as the route capture loop below.
      const result = await attemptLoginAt(page, role, loginPath, id, pw);
      if (result.ok) return { status: 'ok' };
      lastError = result.error;
      if (result.error.step === 'redirect' && attempt < attempts) {
        // eslint-disable-next-line no-await-in-loop
        const rateLimited = await page
          .getByText(/HTTP 429|429|too many|มากเกินไป|ไม่สามารถดำเนินการ/i)
          .count()
          .catch(() => 0);
        if (rateLimited) {
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(15_000 * attempt);
          continue;
        }
      }
      break; // this path failed for a non-rate-limit reason — try the next candidate path
    }
  }

  // Every direct login path failed. Officer-portal roles only: fall back to
  // the citizen/health login page and follow its "สำหรับเจ้าหน้าที่" link —
  // covers a build where the provider login route 404s but is still linked
  // from there (see role-routes.ts's officerLinkFallback doc comment).
  if (a.officerLinkFallback) {
    const fb = a.officerLinkFallback;
    for (const healthPath of fb.fromPaths) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await page.goto(healthPath, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const link = page.getByRole('link', { name: fb.linkPattern }).first();
        // eslint-disable-next-line no-await-in-loop
        const linkCount = await link.count().catch(() => 0);
        if (linkCount === 0) {
          lastError = { step: 'no-officer-link', path: healthPath, message: `no link matching ${fb.linkPattern} found on ${healthPath}` };
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await link.click({ timeout: 10_000 });
        // eslint-disable-next-line no-await-in-loop -- best-effort settle;
        // attemptLoginAt() below does its own explicit page.goto(page.url())
        // right after, so this only needs the click's navigation to have
        // started, not fully finished, before reading page.url().
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
        // Re-run the same fill/submit/land sequence against wherever the link
        // landed (attemptLoginAt's own page.goto() there is a same-URL
        // reload — harmless, and keeps one code path handling every attempt).
        // eslint-disable-next-line no-await-in-loop
        const result = await attemptLoginAt(page, role, page.url(), id, pw);
        if (result.ok) return { status: 'ok' };
        lastError = result.error;
      } catch (e) {
        lastError = { step: 'goto', path: healthPath, message: String((e as Error).message || e).slice(0, 300) };
      }
    }
  }

  return lastError ? { status: 'failed', error: lastError } : { status: 'failed' };
}

async function captureRoute(
  page: Page,
  roleKey: string,
  route: RouteInfo,
  seq: number,
): Promise<PageResult> {
  const result: PageResult = {
    seq,
    route: route.route,
    sourceFile: route.sourceFile,
    status: 'captured',
    httpStatus: null,
    screenshots: {},
    consoleErrorCount: 0,
  };
  const consoleErrors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  };
  page.on('console', onConsole);

  try {
    const resp = await page.goto(route.route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    result.httpStatus = resp ? resp.status() : null;
    try {
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
    } catch {
      // Some pages poll/stream and never go idle — proceed with whatever
      // rendered rather than failing the whole capture over it.
    }
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300); // let responsive layout settle
      const fileName = `${roleKey}/${String(seq).padStart(3, '0')}-${slugify(route.route)}-${vp.name}.png`;
      const filePath = path.join(SCREENSHOT_DIR, fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      await page.screenshot({ path: filePath, fullPage: true });
      result.screenshots[vp.name] = path.relative(EVIDENCE_DIR, filePath);
    }
  } catch (e) {
    result.status = 'error';
    result.error = String((e as Error).message || e).slice(0, 300);
  } finally {
    page.off('console', onConsole);
    result.consoleErrorCount = consoleErrors.length;
  }
  return result;
}

test.describe('Staging walkthrough capture', () => {
  for (const role of ROLE_DEFS) {
    if (ROLE_ALLOWLIST.length > 0 && !ROLE_ALLOWLIST.includes(role.key)) {
      continue;
    }

    test(`${role.key} — ${role.labelTh}`, async ({ page }, testInfo) => {
      // A full-role crawl (public/health/provider can each be 40-70 pages x 2
      // viewports) legitimately takes longer than Playwright's 30s default.
      test.setTimeout(20 * 60 * 1000);

      const loginOutcome = await loginRole(page, role);
      const result: RoleResult = {
        role: role.key,
        labelTh: role.labelTh,
        authStatus: role.auth === null
          ? 'public'
          : loginOutcome.status === 'ok'
            ? 'authenticated'
            : loginOutcome.status === 'no-creds'
              ? 'skipped-no-creds'
              : 'skipped-login-failed',
        routesDiscovered: role.routes.length,
        routesCaptured: 0,
        artifactsDir: path.relative(EVIDENCE_DIR, testInfo.outputDir),
        pages: [],
      };
      roleResults.push(result);

      if (role.auth && loginOutcome.status !== 'ok') {
        // Mission rule: never guess a password. Record why this role's
        // authenticated pages are absent from the pack instead of faking it.
        testInfo.annotations.push({
          type: 'skipped',
          description: loginOutcome.status === 'no-creds'
            ? `no credentials in ${role.auth.idEnvVar}/${role.auth.pwEnvVar} — public pages only, this role's pages skipped`
            : `login failed at step "${loginOutcome.error?.step}" on ${loginOutcome.error?.path} — ${loginOutcome.error?.message}`,
        });
        if (loginOutcome.status === 'failed' && loginOutcome.error) {
          // Diagnostic screenshot of whatever the login page looked like at
          // the moment of failure — 2026-08-07: the first staging run's
          // manifest gave no way to tell a seed/password-rotation failure
          // apart from a login-page/selector mismatch. Best-effort: a page
          // already closed/navigated away by the failure itself should not
          // also fail the whole role test.
          let screenshotRel: string | undefined;
          try {
            const fileName = `${role.key}/000-login-failed.png`;
            const filePath = path.join(SCREENSHOT_DIR, fileName);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            await page.screenshot({ path: filePath, fullPage: true });
            screenshotRel = path.relative(EVIDENCE_DIR, filePath);
          } catch {
            // page may already be in a state screenshot() can't handle —
            // loginError.message still records the real failure reason.
          }
          result.loginError = screenshotRel
            ? { ...loginOutcome.error, screenshot: screenshotRel }
            : loginOutcome.error;
        }
        return;
      }

      const routes = MAX_ROUTES ? role.routes.slice(0, MAX_ROUTES) : role.routes;
      let seq = 1;
      for (const route of routes) {
        // eslint-disable-next-line no-await-in-loop -- sequential by design: one
        // shared page/session per role, staging rate-limits parallel traffic.
        const pageResult = await captureRoute(page, role.key, route, seq);
        result.pages.push(pageResult);
        if (pageResult.status === 'captured') result.routesCaptured += 1;
        seq += 1;
      }
    });
  }

  // Runs after every role test above completes (success or failure) — but
  // BEFORE the standalone assertion test below, because that test lives in a
  // separate top-level `test()`, not inside this describe block. Playwright
  // runs a single spec file's tests/hooks in declaration order within one
  // worker when workers:1/fullyParallel:false (playwright.walkthrough.config.ts
  // pins both), so this ordering is load-bearing, not incidental.
  test.afterAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const manifest = {
      generatedAt: new Date().toISOString(),
      baseURL: process.env.E2E_BASE_URL || 'https://staging.gacpth.com',
      roles: roleResults,
      dynamicRoutesSkipped: DYNAMIC_ROUTES.map((r) => ({
        route: r.route,
        sourceFile: r.sourceFile,
        reason: 'dynamic route — no seeded record id, not crawled (no-guessing rule)',
      })),
    };
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'walkthrough-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  });
});

test('manifest file was written', () => {
  // A trivial assertion so this file always has at least one green test even
  // when every role above is skipped (e.g. a dry run with zero creds) — and so
  // a CI/operator glance at the report catches a manifest that silently failed
  // to write. Must run after the describe block above (see its afterAll
  // comment) — do not move this inside that describe.
  expect(fs.existsSync(path.join(EVIDENCE_DIR, 'walkthrough-manifest.json'))).toBe(true);
});
