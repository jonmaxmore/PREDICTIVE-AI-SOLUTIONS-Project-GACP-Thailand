/**
 * E2E tests — Health (Applicant) Dashboard
 *
 * Asserts the CURRENT dashboard design (verified 2026-06-24 against the live
 * render): a welcome hero with a "ยื่นคำขอใหม่" CTA, an "ภาพรวมคำขอรับรอง" funnel
 * card, a "รายการล่าสุด" recent-applications card with a "ดูทั้งหมด" link, and a
 * right-rail "สถานะดำเนินการ" StatusDonut card. This replaces the long-removed
 * "ภาพรวมและงานที่ต้องดำเนินการ" + 6-named-stat-card + SummaryHeader design that
 * the previous version of this spec asserted (it had been failing/masked).
 *
 * Run:
 *   E2E_BASE_URL=https://staging.gacpth.com E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_TEST_IDENTIFIER=<id> E2E_TEST_PASSWORD=<pw> \
 *   npx playwright test e2e/dashboard.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { HEALTH_STORAGE_STATE } from './helpers/auth';

// storageState auth-reuse: the `setup` project (e2e/auth.setup.ts) logs in ONCE
// and persists the session to HEALTH_STORAGE_STATE; we replay it here so these
// tests do NOT each hit the login route. A per-test login burst trips the login
// rate-limit (50/15min/IP → HTTP 429) under carpet-bomb runs; reuse avoids it.
test.use({ storageState: HEALTH_STORAGE_STATE });

test.beforeEach(async ({ page }) => {
  // Authenticated via storageState — just land on the dashboard.
  await page.goto('/health/dashboard');
});

test.describe('Health Dashboard', () => {
  test('renders the welcome hero heading', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /สวัสดี/ })).toBeVisible();
  });

  test('hero CTA links to the new-application wizard', async ({ page }) => {
    const cta = page.getByRole('link', { name: /ยื่นคำขอใหม่/ }).first();
    await expect(cta).toBeVisible();
    expect(await cta.getAttribute('href')).toContain('/health/applications/new');
  });

  test('shows the application-overview funnel card', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'ภาพรวมคำขอรับรอง' })).toBeVisible();
    // Distinctive funnel metrics (audit stage + total) are present.
    await expect(page.getByText('ตรวจภาคสนาม').first()).toBeVisible();
    await expect(page.getByText('คำขอทั้งหมด').first()).toBeVisible();
  });

  test('shows the recent-applications card with a view-all link', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'รายการล่าสุด' })).toBeVisible();
    const viewAll = page.getByRole('link', { name: 'ดูทั้งหมด' }).first();
    await expect(viewAll).toBeVisible();
    expect(await viewAll.getAttribute('href')).toContain('/health/applications');
  });

  test('shows the status (donut) card', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'สถานะดำเนินการ' }).first()).toBeVisible();
  });

  test('view-all navigates to the applications list', async ({ page }) => {
    await page.getByRole('link', { name: 'ดูทั้งหมด' }).first().click();
    await expect(page).toHaveURL(/\/health\/applications/);
  });

  test('new-application CTA navigates to the wizard', async ({ page }) => {
    await page.getByRole('link', { name: /ยื่นคำขอใหม่/ }).first().click();
    await expect(page).toHaveURL(/\/health\/applications\/new/);
  });

  test('does NOT render the removed stat-card design (regression guard)', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'ภาพรวมและงานที่ต้องดำเนินการ' })).toHaveCount(0);
    await expect(page.getByText('ฟาร์มที่ลงทะเบียน', { exact: true })).toHaveCount(0);
  });

  test('renders the health sidebar navigation', async ({ page }) => {
    for (const label of ['แดชบอร์ด', 'คำขอรับรอง', 'การชำระเงิน', 'ใบรับรอง']) {
      await expect(page.getByRole('link', { name: label, exact: true }).first()).toBeVisible();
    }
  });
});
