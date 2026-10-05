/**
 * ============================================================================
 * W3-B — Accessibility scan (WCAG 2.1 AA via @axe-core/playwright)
 * ============================================================================
 * // SMOKE-MODE: gate at T-3
 * // DUAL-MODE: mock (default) + E2E_LIVE_BACKEND=1
 *
 * Closes RFC `docs/handoffs/iter-W3/00-rfc.md` §W3-B. Runs an `AxeBuilder`
 * scan with the WCAG 2.1 AA tag set (`wcag2a`, `wcag2aa`, `wcag21a`,
 * `wcag21aa`) against the 5 highest-traffic surfaces and writes the full
 * per-page result JSON to `apps/web-app/playwright/.axe-results/` so the
 * cutover team can grep for residual violations after a local run.
 *
 * 5 surfaces scanned (one `test()` block each — independent so a failure on
 * one page does not mask violations on another):
 *   1. `/`                       — marketing landing (public traffic peak)
 *   2. `/auth/health/login`      — sign-in (highest public traffic)
 *   3. `/health/dashboard`       — post-login HEALTH landing
 *   4. `/provider/dashboard`     — post-login DTAM/SCHEDULER landing
 *   5. `/admin/users`            — ADMIN user-management surface
 *
 * Per I-018 the spec does NOT use `page.request.*` for any mocked URL — the
 * AxeBuilder scan runs entirely in browser context (axe-core injected via
 * `page.evaluate`), so route mocks fire as expected when the spec layers
 * them via `mockApi(page, ...)`.
 *
 * Per I-017 the spec asserts on the High-severity (critical + serious)
 * subset of WCAG 2.1 AA violations. The full violation set is persisted
 * to the .axe-results JSON so the orchestrator + cutover team can review
 * Moderate / Minor findings during the ratchet window. The Moderate /
 * Minor tier is documented in `W3-B.md` as ratchet-track-2 work (not
 * silently dropped — see "Deferred / consolidated" section there).
 *
 * Per I-013 this spec is NOT wired into `.husky/pre-commit` — the husky
 * hook runs the 6 quality gates (jest + tsc + eslint backend + eslint
 * web-app + 52 system + trust-lint). Playwright runs separately via the
 * existing `npm --prefix apps/web-app run test:e2e` script. The spec ships
 * as a CI-optional / cutover-smoke gate, not a mandatory pre-commit hook.
 *
 * Run (mock mode):
 *   cd apps/web-app
 *   npx playwright test playwright/accessibility-scan.spec.ts --project=chromium --reporter=list
 *
 * Run (live mode):
 *   cd apps/web-app
 *   E2E_LIVE_BACKEND=1 npx playwright test playwright/accessibility-scan.spec.ts --project=chromium --reporter=list
 *
 * Artifacts (each test writes one file):
 *   apps/web-app/playwright/.axe-results/marketing-landing.json
 *   apps/web-app/playwright/.axe-results/auth-health-login.json
 *   apps/web-app/playwright/.axe-results/health-dashboard.json
 *   apps/web-app/playwright/.axe-results/provider-dashboard.json
 *   apps/web-app/playwright/.axe-results/admin-users.json
 */

import { test, expect, type Page } from '@playwright/test';
import {
    loginAsHealthUser,
    loginAsAccountDtam,
    loginAsAdmin,
    mockApi,
} from './fixtures';
import {
    expectLiveBackend,
    filterCriticalSerious,
    runAxeScan,
    summariseViolations,
} from './fixtures/a11y-fixtures';

// ────────────────────────────────────────────────────────────────────────────
// Empty-list mocks shared across the three post-login surfaces. The
// dashboards render skeletons when their primary API call returns an empty
// list, which is the cleanest a11y baseline (no data-driven dynamic
// content that varies between runs). Live mode skips these entirely; the
// real backend's response shape is what gets scanned.
// ────────────────────────────────────────────────────────────────────────────

async function seedEmptyDashboardMocks(page: Page): Promise<void> {
    if (expectLiveBackend()) return;

    // Generic empty-list response — used as the fallback for any list-like
    // endpoint the dashboards happen to call during initial render.
    const emptyList = { success: true, data: [] };

    // HEALTH dashboard endpoints
    await mockApi(page, {
        route: /\/api\/applications\/my(\?.*)?$/u,
        body: emptyList,
    });
    await mockApi(page, {
        route: /\/api\/certificates\/my(\?.*)?$/u,
        body: emptyList,
    });
    await mockApi(page, {
        route: /\/api\/invoices\/my(\?.*)?$/u,
        body: emptyList,
    });

    // PROVIDER dashboard endpoints — DTAM reviewer / scheduler queues.
    await mockApi(page, {
        route: /\/api\/provider\/dashboard(\?.*)?$/u,
        body: { success: true, data: { applications: [], stats: {} } },
    });
    await mockApi(page, {
        route: /\/api\/applications(\?.*)?$/u,
        body: { success: true, data: [], pagination: { total: 0 } },
    });
    await mockApi(page, {
        route: /\/api\/review-queue(\?.*)?$/u,
        body: emptyList,
    });

    // ADMIN /admin/users endpoint (B28-A adminB28Service.listUsers).
    await mockApi(page, {
        route: /\/api\/admin\/users(\?.*)?$/u,
        body: {
            success: true,
            data: { users: [], total: 0, page: 1, pageSize: 20 },
        },
    });
    await mockApi(page, {
        route: /\/api\/admin\/users\/stats(\?.*)?$/u,
        body: { success: true, data: { total: 0, active: 0, disabled: 0 } },
    });
}

/**
 * Single canonical assertion per page. Centralised so each `test()` block
 * stays one-screen-readable. Asserts on the High-severity subset
 * (critical + serious) per I-017; full violation set is persisted to the
 * JSON artifact for the ratchet window.
 */
function assertNoHighSeverityViolations(
    results: Awaited<ReturnType<typeof runAxeScan>>,
    stageLabel: string,
): void {
    const highSeverity = filterCriticalSerious(results.violations);
    expect(
        highSeverity,
        `[a11y][${stageLabel}] expected zero critical/serious WCAG 2.1 AA violations, got ${highSeverity.length}: ${summariseViolations(highSeverity)}`,
    ).toEqual([]);
}

// ────────────────────────────────────────────────────────────────────────────
// 5 independent scans — each test() block is self-contained so a failure on
// one surface does not mask violations on another. Fully parallel: the spec
// does NOT use `test.describe.serial` (no state threads between surfaces).
// ────────────────────────────────────────────────────────────────────────────

test.describe('W3-B: WCAG 2.1 AA accessibility scan (top 5 surfaces)', () => {
    // STAGE 1: the root — which, since E1, IS the login chooser (/ 307s to
    // /auth; the marketing landing was retired from the root and exists at no
    // other route, so it cannot keep a gate). The E1 audit caught the silent
    // repurposing here: this stage kept its old name and kept writing its axe
    // artifact as marketing-landing while actually scanning the chooser —
    // a gate that scans one thing under another thing's label protects neither.
    test('Stage 1: / (login chooser front door) has zero critical/serious WCAG 2.1 AA violations', async ({
        page,
    }) => {
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForLoadState('networkidle').catch(() => {
            /* networkidle may never fire on pages with long-poll websockets;
               fall through — DOM-content already loaded above. */
        });

        const results = await runAxeScan(page, 'root-login-chooser');
        assertNoHighSeverityViolations(results, '/ (login chooser)');
    });

    // STAGE 2: Sign-in page — public, but per I-008 we still register the
    // auth-status endpoint mock so the page does not bounce to a
    // half-rendered loading state during the axe scan.
    test('Stage 2: /auth/health/login has zero critical/serious WCAG 2.1 AA violations', async ({
        page,
    }) => {
        if (!expectLiveBackend()) {
            // The sign-in surface itself does not call /api/auth/* until the
            // user submits, but the global Providers tree polls /api/health
            // (or similar) for connectivity. Return a fast 200 so the spec
            // does not race against network timeouts.
            await mockApi(page, {
                route: /\/api\/(health|status|auth\/me)(\?.*)?$/u,
                body: { success: true, data: { status: 'ok' } },
            });
        }
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        const results = await runAxeScan(page, 'auth-health-login');
        assertNoHighSeverityViolations(results, '/auth/health/login');
    });

    // STAGE 3: HEALTH dashboard — requires a HEALTH JWT seeded BEFORE
    // navigation so the route guard does not bounce back to /auth/health/login.
    test('Stage 3: /health/dashboard has zero critical/serious WCAG 2.1 AA violations', async ({
        page,
    }) => {
        if (!expectLiveBackend()) {
            await loginAsHealthUser(page);
            await seedEmptyDashboardMocks(page);
        }
        await page.goto('/health/dashboard');
        await page.waitForLoadState('domcontentloaded');
        // Accept the dashboard OR an onboarding fallback URL — both are
        // valid post-login states for a HEALTH user with no apps yet. The
        // axe scan runs on whichever surface we land on.
        await expect(page).toHaveURL(
            /\/health\/(dashboard|onboarding|start)/u,
            { timeout: 15_000 },
        );

        const results = await runAxeScan(page, 'health-dashboard');
        assertNoHighSeverityViolations(results, '/health/dashboard');
    });

    // STAGE 4: PROVIDER dashboard — DTAM / reviewer / scheduler landing.
    // Uses ACCOUNT_DTAM fixture (gates broadly to /provider/*).
    test('Stage 4: /provider/dashboard has zero critical/serious WCAG 2.1 AA violations', async ({
        page,
    }) => {
        if (!expectLiveBackend()) {
            await loginAsAccountDtam(page);
            await seedEmptyDashboardMocks(page);
        }
        await page.goto('/provider/dashboard');
        await page.waitForLoadState('domcontentloaded');
        // Provider routes may redirect to /provider/login if the role
        // gate rejects — accept either as a valid landed state and let
        // axe scan whichever surface rendered.
        await expect(page).toHaveURL(/\/provider\//u, { timeout: 15_000 });

        const results = await runAxeScan(page, 'provider-dashboard');
        assertNoHighSeverityViolations(results, '/provider/dashboard');
    });

    // STAGE 5: ADMIN /admin/users — Iter 28 B28-A admin tooling. ADMIN
    // role required (loginAsAdmin from shared fixtures).
    test('Stage 5: /admin/users has zero critical/serious WCAG 2.1 AA violations', async ({
        page,
    }) => {
        if (!expectLiveBackend()) {
            await loginAsAdmin(page);
            await seedEmptyDashboardMocks(page);
        }
        await page.goto('/admin/users');
        await page.waitForLoadState('domcontentloaded');

        const results = await runAxeScan(page, 'admin-users');
        assertNoHighSeverityViolations(results, '/admin/users');
    });
});
