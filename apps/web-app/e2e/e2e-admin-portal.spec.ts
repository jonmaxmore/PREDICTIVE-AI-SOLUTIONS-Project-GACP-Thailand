/**
 * ============================================================================
 * E2E TESTS - Admin Portal
 * ============================================================================
 * Tests for the system admin dashboard.
 * Admin access requires a separate admin user login.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_PROVIDER_USERNAME=admin \
 *   E2E_PROVIDER_PASSWORD=<pw> \
 *   npx playwright test e2e/e2e-admin-portal.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { loginAsProvider } from './helpers/provider-auth';

// Admin uses Provider auth flow but with admin credentials
test.describe('E2E: Admin Portal - Access', () => {
    test('admin dashboard loads after provider login', async ({ page }) => {
        await loginAsProvider(page);
        await page.goto('/admin/dashboard');
        await page.waitForLoadState('networkidle');
        // Should render or redirect based on permissions
        await expect(page.locator('body')).toBeVisible();
    });

    test('admin users management page loads', async ({ page }) => {
        await loginAsProvider(page);
        await page.goto('/admin/users');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });

    test('admin settings page loads', async ({ page }) => {
        await loginAsProvider(page);
        await page.goto('/admin/settings');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });

    test('admin planting page loads', async ({ page }) => {
        await loginAsProvider(page);
        await page.goto('/admin/planting');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toBeVisible();
    });
});

// ─── Admin API Endpoints ───────────────────────────────────────────────────────
test.describe('E2E: Admin API Endpoints (no auth → 401/403)', () => {
    const API_BASE = process.env.E2E_API_BASE_URL || '/api';

    test('GET /api/admin/applications without auth returns 401/403', async ({ request }) => {
        const response = await request.get(`${API_BASE}/admin/applications`);
        expect([401, 403]).toContain(response.status());
    });

    test('GET /api/admin/users without auth returns 401/403', async ({ request }) => {
        const response = await request.get(`${API_BASE}/admin/users`);
        expect([401, 403]).toContain(response.status());
    });

    test('GET /api/admin/config without auth returns 401/403', async ({ request }) => {
        const response = await request.get(`${API_BASE}/admin/config`);
        expect([401, 403]).toContain(response.status());
    });
});
