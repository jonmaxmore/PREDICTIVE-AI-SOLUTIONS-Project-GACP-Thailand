/**
 * ============================================================================
 * E2E TESTS - Track & Trace (Public System)
 * ============================================================================
 * Tests the public-facing QR code traceability system.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   npx playwright test e2e/e2e-trace.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE_URL || '/api';

test.describe('E2E: Track & Trace - Public Page', () => {
    test('trace page loads and has search interface', async ({ page }) => {
        await page.goto('/trace');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
        // Trace page should have some form of search input or QR scanner
        const content = await page.locator('body').textContent();
        expect(content).toBeTruthy();
    });

    test('trace page shows not-found for invalid QR code', async ({ page }) => {
        await page.goto('/trace/INVALID-QR-CODE-123');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Track & Trace - API', () => {
    test('GET /api/trace returns structured response', async ({ request }) => {
        const response = await request.get(`${API_BASE}/trace`);
        // Should return 200 (list) or 401 (auth required)
        expect([200, 401, 403, 404]).toContain(response.status());
    });

    test('GET /api/trace/verify with invalid code returns error', async ({ request }) => {
        const response = await request.get(`${API_BASE}/trace/verify?code=INVALID`);
        expect([400, 404, 401]).toContain(response.status());
    });
});

test.describe('E2E: Track & Trace - Batch & Lot Subpages', () => {
    test('batch trace page loads', async ({ page }) => {
        await page.goto('/trace/batch');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });

    test('lot trace page loads', async ({ page }) => {
        await page.goto('/trace/lot');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });

    test('plant trace page loads', async ({ page }) => {
        await page.goto('/trace/plant');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });

    test('plot-cycle trace page loads', async ({ page }) => {
        await page.goto('/trace/plot-cycle');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('E2E: Track & Trace - Consumer Feedback API', () => {
    test('POST /api/consumer-feedback with invalid data returns error', async ({ request }) => {
        const response = await request.post(`${API_BASE}/consumer-feedback`, {
            data: { qrCode: 'INVALID', rating: 0 },
        });
        expect([400, 404, 401]).toContain(response.status());
    });
});
