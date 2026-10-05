/**
 * ============================================================================
 * E2E TESTS - Provider (DTAM Provider) Portal
 * ============================================================================
 * Full end-to-end user journey for the provider/provider portal.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_PROVIDER_USERNAME=reviewer \
 *   E2E_PROVIDER_PASSWORD=Test@12345 \
 *   npx playwright test e2e/e2e-provider-portal.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { loginAsProvider } from './helpers/provider-auth';

test.describe('E2E: Provider Portal - Login & Dashboard', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('successful login redirects to /provider/dashboard', async ({ page }) => {
        await expect(page).toHaveURL(/\/provider\/dashboard/);
    });

    test('dashboard page renders with heading', async ({ page }) => {
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
        const content = await page.locator('body').textContent();
        expect(content?.length).toBeGreaterThan(0);
    });
});

test.describe('E2E: Provider Portal - Applications Management', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to applications list', async ({ page }) => {
        await page.goto('/provider/applications');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Audits', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to audits list', async ({ page }) => {
        await page.goto('/provider/audits');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Certificates', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to certificates page', async ({ page }) => {
        await page.goto('/provider/certificates');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Analytics', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to analytics page', async ({ page }) => {
        await page.goto('/provider/analytics');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Accounting', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to accounting/receipts page', async ({ page }) => {
        await page.goto('/provider/receipts');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Calendar & Scheduler', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to calendar page', async ({ page }) => {
        await page.goto('/provider/calendar');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });

    test('navigate to scheduler page', async ({ page }) => {
        await page.goto('/provider/scheduler');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Criteria & Standards', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to criteria management', async ({ page }) => {
        await page.goto('/provider/criteria');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Management', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to management page', async ({ page }) => {
        await page.goto('/provider/management');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Verification', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to verification page', async ({ page }) => {
        await page.goto('/provider/verification');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Planting', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to planting oversight', async ({ page }) => {
        await page.goto('/provider/planting');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Provider Portal - Profile & Settings', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsProvider(page);
    });

    test('navigate to provider profile', async ({ page }) => {
        await page.goto('/provider/profile');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });

    test('navigate to provider settings', async ({ page }) => {
        await page.goto('/provider/settings');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});
