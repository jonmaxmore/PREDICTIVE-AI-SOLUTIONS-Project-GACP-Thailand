import * as fs from 'fs';
import * as path from 'path';

/**
 * A4 (design-cleanup-2026-08-21) — dangling links to retired dashboard
 * routes. `/health/dashboard` is a retired redirect-only shim (now just
 * `redirect('/health/home')`, see health/dashboard/page.tsx) and
 * `/provider/dashboard` is being replaced as the universal officer landing
 * by `/provider/home` (Task 7, N1 ruling — "tile home for every role").
 * Several fallback CTAs (error boundaries, 404 pages, onboarding "skip",
 * the profile page's dashboard shortcut) still pointed at the OLD routes,
 * forcing an extra redirect hop through a page whose own comments say it
 * is retired.
 *
 * OUT OF SCOPE, deliberately left untouched (see report for why):
 *   - lib/constants/auth-routes.ts (HEALTH_DASHBOARD_ROUTE /
 *     PROVIDER_DASHBOARD_ROUTE) — feeds the POST-LOGIN redirect target in
 *     auth/callback/[provider]/client-view.tsx; explicitly excluded.
 *   - app/provider/page.tsx — redirects to /provider/dashboard, which
 *     itself branches PER ROLE (scheduler → /provider/coordinator, auditor
 *     → /provider/audits, etc.) before falling through to /provider/home
 *     for admin/legacy. Hardcoding /provider/home here would skip that
 *     role branching, a bigger behavior change than a dangling-link fix.
 *   - apps/web-app/src/app/health/applications/new/** (the wizard) — owned
 *     by another agent in this batch; success-step.tsx and _steps/layout.tsx
 *     both still reference /health/dashboard and are left for that owner.
 */
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('[A4] health-side fallbacks point at /health/home, not the retired /health/dashboard', () => {
  const FILES: Record<string, string> = {
    healthError: read('app/health/error.tsx'),
    onboardingClient: read('app/health/onboarding/onboarding-client.tsx'),
    notFound: read('app/not-found.tsx'),
    healthRoot: read('app/health/page.tsx'),
  };

  it('has no reference to /health/dashboard left', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('/health/dashboard')}`).toBe(`${name}:false`);
    }
  });

  it('links/redirects to /health/home instead', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('/health/home')}`).toBe(`${name}:true`);
    }
  });

  it('onboarding-client updates BOTH the Complete-handler redirect and the Skip-to-home link', () => {
    const matches = FILES.onboardingClient.match(/\/health\/home/g) || [];
    expect(matches.length).toBe(2);
  });
});

describe('[A4] officer-side fallbacks point at /provider/home, not the retired /provider/dashboard', () => {
  const FILES: Record<string, string> = {
    providerProfile: read('app/provider/profile/page.tsx'),
    providerNotFound: read('app/provider/not-found.tsx'),
    providerError: read('app/provider/error.tsx'),
  };

  it('has no reference to /provider/dashboard left', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('/provider/dashboard')}`).toBe(`${name}:false`);
    }
  });

  it('links/redirects to /provider/home instead', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('/provider/home')}`).toBe(`${name}:true`);
    }
  });
});

describe('[A4] exclusions stay untouched', () => {
  it('the HEALTH post-login target skips the retired shim; the PROVIDER one still branches', () => {
    // Revised 2026-09-07 with a measurement the original exclusion did not have: a
    // login on the live demo walked /login -> /auth/health/login -> /health/dashboard
    // -> /health/home and took ~6s, with the retired page flashing past
    // (evidence/apple-qa-audit-2026-09-07). /health/dashboard is a redirect-only shim
    // whose own page comment asks for exactly this sweep, so the health target now
    // points past it.
    //
    // The provider constant keeps its original exclusion, and for the original
    // reason: /provider/dashboard branches per role before falling through to
    // /provider/home, so it is a router and not a dangling link.
    const src = read('lib/constants/auth-routes.ts');
    expect(src).toContain("HEALTH_DASHBOARD_ROUTE = '/health/home'");
    expect(src).toContain("PROVIDER_DASHBOARD_ROUTE = '/provider/dashboard'");
  });

  it('provider root redirect is left on /provider/dashboard (role-branching, not a simple dangling link)', () => {
    const src = read('app/provider/page.tsx');
    expect(src).toContain("redirect('/provider/dashboard')");
  });

  it('the wizard (owned by another agent) is not touched here', () => {
    const successStep = read('app/health/applications/new/_steps/steps/success-step.tsx');
    const stepsLayout = read('app/health/applications/new/_steps/layout.tsx');
    expect(successStep.includes('/health/dashboard')).toBe(true);
    expect(stepsLayout.includes('/health/dashboard')).toBe(true);
  });
});
