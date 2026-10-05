/** Identify what keeps the network busy: count requests in a 10s window after 'load'. */
import { test } from '@playwright/test';
import { loginAsHealth } from './helpers/auth';

test('pending requests on /health/tracking', async ({ page }) => {
  const pending = new Map<string, string>();
  page.on('request', (req) => { pending.set(req.url(), `${req.method()} ${req.url().slice(0, 140)}`); });
  page.on('requestfinished', (req) => { pending.delete(req.url()); });
  page.on('requestfailed', (req) => { pending.delete(req.url()); });
  await loginAsHealth(page);
  await page.goto('/health/tracking', { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(10_000);
  console.warn(`=== still-PENDING requests 10s after load: ${pending.size} ===`);
  for (const v of [...pending.values()].slice(0, 10)) { console.warn(`  PENDING: ${v}`); }
});
