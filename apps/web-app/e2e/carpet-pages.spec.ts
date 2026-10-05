/**
 * Carpet page sweep — visits EVERY static route in the app and verifies it renders.
 *
 * Per-route checks:
 *   1. HTTP status < 500 (4xx allowed only where noted — auth redirects follow automatically)
 *   2. No client-side exception ("Application error: a client-side exception has occurred")
 *   3. Collects console errors + pageerrors (REPORTED, not failed — triage separately)
 *
 * Run (staging):
 *   E2E_BASE_URL=https://staging.gacpth.com E2E_TEST_IDENTIFIER=... E2E_TEST_PASSWORD=... \
 *   E2E_PROVIDER_USERNAME=... E2E_PROVIDER_PASSWORD=... \
 *   npx playwright test e2e/carpet-pages.spec.ts --project=chromium
 *
 * Dynamic ([id]) routes are excluded — covered by the portal/workflow e2e specs.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAsHealth } from './helpers/auth';
import { loginAsProvider } from './helpers/provider-auth';

const PUBLIC_ROUTES = [
  '/', '/about', '/accessibility', '/auth', '/auth/health/login', '/auth/health/privacy',
  '/auth/health/terms', '/auth/provider/login', '/help',
  '/help/contact', '/help/faq', '/help/glossary', '/login', '/pricing', '/privacy',
  '/privacy-policy', '/register', '/register/success', '/terms', '/terms-of-service',
  '/trace', '/verify', '/verify-identity',
];
// /auth/clear-session excluded: visiting it nukes the session mid-sweep by design.

const HEALTH_ROUTES = [
  '/health', '/health/account/erasure', '/health/applications', '/health/applications/new',
  '/health/applications/new/step/3', '/health/applications/new/step/11',
  '/health/applications/preview', '/health/applications/renewal', '/health/billing',
  '/health/certificates', '/health/dashboard', '/health/documents', '/health/establishments',
  '/health/establishments/new', '/health/export-documents', '/health/more',
  '/health/notifications', '/health/official-documents', '/health/onboarding',
  '/health/payments', '/health/planting', '/health/planting/new', '/health/profile',
  '/health/profile/notifications', '/health/profile/privacy', '/health/reports',
  '/health/settings', '/health/site-analysis', '/health/sop-builder', '/health/sop-templates',
  '/health/start', '/health/start/readiness', '/health/subscription', '/health/tracking',
  '/health/tracking/lots', '/health/training', '/health/workspaces', '/health/workspaces/new',
];

const PROVIDER_ROUTES = [
  '/provider', '/provider/dashboard', '/provider/dashboard/admin', '/provider/applications',
  '/provider/audits', '/provider/calendar', '/provider/certificates', '/provider/coordinator',
  '/provider/criteria', '/provider/documents', '/provider/management', '/provider/planting',
  '/provider/profile', '/provider/profile/notifications', '/provider/profile/security',
  '/provider/receipts', '/provider/reports', '/provider/scheduler/queue',
  '/provider/scheduler/reassign', '/provider/settings', '/provider/settings/system',
  '/provider/settings/work-config', '/provider/work', '/provider/analytics',
  '/provider/analytics/work', '/provider/accounting', '/provider/accounting/ar-aging',
  '/provider/accounting/manual-journal-entries', '/provider/accounting/period-close',
  '/provider/accounting/purchase-invoices', '/provider/accounting/reports',
  '/provider/accounting/wht', '/provider/admin/audit-log',
  '/admin/dashboard', '/admin/audit-log', '/admin/certificates', '/admin/communication',
  '/admin/organizations', '/admin/planting', '/admin/settings', '/admin/users',
];
// /provider/login excluded from the authed sweep (it would bounce the session).

type RouteResult = {
  route: string;
  status: number | null;
  clientException: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  navError?: string;
};

async function sweep(page: Page, routes: string[]): Promise<RouteResult[]> {
  const results: RouteResult[] = [];
  for (const route of routes) {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const onConsole = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === 'error') { consoleErrors.push(msg.text().slice(0, 200)); }
    };
    const onPageError = (err: Error) => { pageErrors.push(String(err.message || err).slice(0, 200)); };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    let status: number | null = null;
    let navError: string | undefined;
    let clientException = false;
    try {
      const resp = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      status = resp ? resp.status() : null;
      await page.waitForTimeout(1200); // let client components mount / fetch
      clientException = await page
        .locator('text=Application error: a client-side exception has occurred')
        .count() > 0;
    } catch (e) {
      navError = String((e as Error).message || e).slice(0, 200);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
    results.push({ route, status, clientException, consoleErrors, pageErrors, navError });
  }
  return results;
}

function report(label: string, results: RouteResult[]): string[] {
  const hardFails: string[] = [];
  console.warn(`\n===== ${label}: ${results.length} routes =====`);
  for (const r of results) {
    const hard = (r.status !== null && r.status >= 500) || r.clientException || !!r.navError;
    const flags = [
      r.status !== null ? `HTTP ${r.status}` : 'no-response',
      r.clientException ? 'CLIENT-EXCEPTION' : '',
      r.navError ? `NAV-ERROR: ${r.navError}` : '',
      r.pageErrors.length ? `pageerrors=${r.pageErrors.length}` : '',
      r.consoleErrors.length ? `console-errors=${r.consoleErrors.length}` : '',
    ].filter(Boolean).join(' | ');
    console.warn(`${hard ? 'FAIL' : ' ok '} ${r.route}  [${flags}]`);
    for (const ce of r.consoleErrors.slice(0, 3)) { console.warn(`        console: ${ce}`); }
    for (const pe of r.pageErrors.slice(0, 3)) { console.warn(`        pageerror: ${pe}`); }
    if (hard) { hardFails.push(`${r.route} [${flags}]`); }
  }
  return hardFails;
}

test.describe('Carpet page sweep', () => {
  test('public routes render', async ({ page }) => {
    const results = await sweep(page, PUBLIC_ROUTES);
    const hardFails = report('PUBLIC', results);
    expect(hardFails, `hard failures:\n${hardFails.join('\n')}`).toEqual([]);
  });

  test('health portal routes render (authenticated)', async ({ page }) => {
    await loginAsHealth(page);
    const results = await sweep(page, HEALTH_ROUTES);
    const hardFails = report('HEALTH', results);
    expect(hardFails, `hard failures:\n${hardFails.join('\n')}`).toEqual([]);
  });

  test('provider + admin portal routes render (authenticated)', async ({ page }) => {
    await loginAsProvider(page);
    const results = await sweep(page, PROVIDER_ROUTES);
    const hardFails = report('PROVIDER+ADMIN', results);
    expect(hardFails, `hard failures:\n${hardFails.join('\n')}`).toEqual([]);
  });
});
