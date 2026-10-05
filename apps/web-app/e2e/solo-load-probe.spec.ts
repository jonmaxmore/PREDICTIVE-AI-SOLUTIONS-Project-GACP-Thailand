/** Solo probe: do provider/health pages actually reach 'load' and 'networkidle'
 *  when NOT under parallel-suite load? (v2 sweep saw hangs while 6 suites ran.) */
import { test } from '@playwright/test';
import { loginAsProvider } from './helpers/provider-auth';
import { loginAsHealth } from './helpers/auth';

const PROVIDER_PAGES = ['/provider/applications', '/provider/audits', '/provider/calendar', '/provider/management'];
const HEALTH_PAGES = ['/health/tracking', '/health/profile'];

async function probe(page, route: string) {
  const t0 = Date.now();
  await page.goto(route, { waitUntil: 'load', timeout: 45_000 });
  const tLoad = Date.now() - t0;
  let tIdle = -1;
  try {
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    tIdle = Date.now() - t0;
  } catch { /* never idle within 20s */ }
  console.warn(`PROBE ${route}  load=${tLoad}ms  networkidle=${tIdle === -1 ? 'NEVER(<=20s)' : tIdle + 'ms'}`);
}

test('solo provider pages reach load', async ({ page }) => {
  await loginAsProvider(page);
  for (const r of PROVIDER_PAGES) { await probe(page, r); }
});

test('solo health pages reach load', async ({ page }) => {
  await loginAsHealth(page);
  for (const r of HEALTH_PAGES) { await probe(page, r); }
});
