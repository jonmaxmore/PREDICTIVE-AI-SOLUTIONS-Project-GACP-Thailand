import { Page } from '@playwright/test';

/** Credentials read from environment variables (set before running e2e) */
export const TEST_CREDENTIALS = {
  identifier: process.env.E2E_TEST_IDENTIFIER || '',
  password: process.env.E2E_TEST_PASSWORD || '',
};

/**
 * Where the HEALTH applicant's authenticated storageState is persisted by the
 * `setup` project (e2e/auth.setup.ts). Specs opt in with
 * `test.use({ storageState: HEALTH_STORAGE_STATE })` to reuse one login instead
 * of logging in per test (avoids the login rate-limit, 50/15min/IP). Relative to
 * the Playwright config dir (apps/web-app); gitignored.
 */
export const HEALTH_STORAGE_STATE = 'playwright/.auth/health.json';

/**
 * Login via the citizen/Applicant login page.
 * Fills the form, submits, and waits until redirected to /health/dashboard.
 *
 * Rate-limit resilient: the provider/health login route is rate-limited
 * (`ratelimit: 50;w=900` = 50/15min PER IP). A carpet-bomb E2E run that logs in
 * per-test can exceed that from a single CI/dev IP — the FE then shows
 * "ไม่สามารถดำเนินการได้ (HTTP 429)" on the login page and never redirects. We
 * detect that 429 state and back off + retry instead of a blind 20s timeout that
 * masquerades as an app failure. (Best long-term fix: Playwright storageState
 * auth reuse so the suite logs in once per worker, not per test.)
 */
export async function loginAsHealth(page: Page): Promise<void> {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await page.goto('/auth/health/login');
    await page.waitForSelector('#identifier', { timeout: 10_000 });
    await page.fill('#identifier', TEST_CREDENTIALS.identifier);
    await page.fill('#password', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]');

    try {
      await page.waitForURL('**/health/dashboard', { timeout: 15_000 });
      return; // logged in + redirected
    } catch {
      // Distinguish a rate-limit (429) stall from a genuine login failure.
      const rateLimited = await page
        .getByText(/HTTP 429|429|too many|มากเกินไป|ไม่สามารถดำเนินการ/i)
        .count()
        .catch(() => 0);
      if (rateLimited && attempt < MAX_ATTEMPTS) {
        // Back off so older logins age out of the 15-min sliding window.
        await page.waitForTimeout(20_000 * attempt);
        continue;
      }
      throw new Error(
        `loginAsHealth: not redirected to /health/dashboard (attempt ${attempt}/${MAX_ATTEMPTS}); `
        + `${rateLimited ? 'rate-limited (HTTP 429) — too many logins from this IP in 15min' : 'login failed'}. `
        + `Last URL: ${page.url()}`,
      );
    }
  }
}
