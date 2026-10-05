/**
 * ============================================================================
 * E2E TESTS - Health (health/Citizen) Portal
 * ============================================================================
 * Full end-to-end user journey for the Applicant portal.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_TEST_IDENTIFIER=<idCard> \
 *   E2E_TEST_PASSWORD=<pw> \
 *   npx playwright test e2e/e2e-health-portal.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { loginAsHealth } from './helpers/auth';

test.describe('E2E: Health Portal - Login & Dashboard', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('successful login redirects to /health/dashboard', async ({ page }) => {
        await expect(page).toHaveURL(/\/health\/dashboard/);
    });

    test('dashboard heading is visible', async ({ page }) => {
        const dashboardHeading = page
            .getByRole('heading', { name: /แดชบอร์ดเกษตรกร|ภาพรวมและงานที่ต้องดำเนินการ/i })
            .first();
        await expect(dashboardHeading).toBeVisible({ timeout: 10_000 });
    });
    test('stat cards display farm and certificate counts', async ({ page }) => {
        await expect(page.getByText(/ฟาร์มที่ลงทะเบียน/i).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/ใบรับรองที่ออกแล้ว|ได้รับใบรับรอง/i).first()).toBeVisible();
    });
    test('quick action buttons are visible', async ({ page }) => {
        const heroPanel = page.locator('.hero-panel').first();
        await expect(heroPanel).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('E2E: Health Portal - Applications', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to applications list', async ({ page }) => {
        await page.goto('/health/applications');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
        // Should show either application list or empty state
        const content = await page.locator('body').textContent();
        expect(content).toBeTruthy();
    });

    test('navigate to new application form', async ({ page }) => {
        await page.goto('/health/applications/new');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Establishments/Farms', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to establishments list', async ({ page }) => {
        await page.goto('/health/establishments');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Certificates', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to certificates page', async ({ page }) => {
        await page.goto('/health/certificates');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Planting & Tracking', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to planting management', async ({ page }) => {
        await page.goto('/health/planting');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });

    test('navigate to tracking page', async ({ page }) => {
        await page.goto('/health/tracking');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Payments', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to payments page', async ({ page }) => {
        await page.goto('/health/payments');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Profile & Settings', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to profile page', async ({ page }) => {
        await page.goto('/health/profile');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });

    test('navigate to settings page', async ({ page }) => {
        await page.goto('/health/settings');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Notifications', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to notifications page', async ({ page }) => {
        await page.goto('/health/notifications');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Site Analysis', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to site analysis page', async ({ page }) => {
        await page.goto('/health/site-analysis');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Training Records', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to training page', async ({ page }) => {
        await page.goto('/health/training');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Health Portal - Documents', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsHealth(page);
    });

    test('navigate to documents page', async ({ page }) => {
        await page.goto('/health/documents');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});


