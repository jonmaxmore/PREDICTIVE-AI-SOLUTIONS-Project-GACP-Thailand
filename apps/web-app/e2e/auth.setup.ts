/**
 * Playwright `setup` project — authenticates ONCE and persists the session so
 * specs that opt in (via `test.use({ storageState: HEALTH_STORAGE_STATE })`)
 * don't re-login per test. A per-test login burst trips the login rate-limit
 * (50/15min/IP → HTTP 429) under carpet-bomb runs; one shared login does not.
 *
 * Runs as its own project (testMatch /auth\.setup\.ts/) that the chromium
 * project depends on, so the storageState file exists on disk before the
 * chromium worker starts — unlike a beforeAll, which Playwright cannot satisfy
 * because it reads `test.use({ storageState })` while building the worker.
 *
 * The `page` fixture here inherits the project `use` (baseURL, ignoreHTTPSErrors),
 * so loginAsHealth's relative navigation resolves against the target host.
 */
import { test as setup } from '@playwright/test';
import { loginAsHealth, HEALTH_STORAGE_STATE } from './helpers/auth';

setup('authenticate as HEALTH applicant', async ({ page }) => {
  await loginAsHealth(page);
  await page.context().storageState({ path: HEALTH_STORAGE_STATE });
});
