/**
 * ============================================================================
 * SMOKE TESTS - Quick sanity checks for all systems
 * ============================================================================
 * Validates that all critical pages load and core APIs respond.
 * Should run in < 2 minutes.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   npx playwright test e2e/smoke.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE_URL || '/api';

// ─── API Health ────────────────────────────────────────────────────────────────
test.describe('Smoke: API Health', () => {
    test('GET /api/health returns 200 with OK status', async ({ request }) => {
        const response = await request.get(`${API_BASE}/health`);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.dbStatus?.status).toBe('connected');
    });

    test('GET /api/version returns version info', async ({ request }) => {
        const response = await request.get(`${API_BASE}/version`);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.version).toBeDefined();
    });

    test('GET /api/metrics returns metrics data', async ({ request }) => {
        const response = await request.get(`${API_BASE}/metrics`);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });
});

// ─── Public Pages ──────────────────────────────────────────────────────────────
test.describe('Smoke: Public Pages', () => {
    test('Homepage (/) loads', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/.+/);
        // Should have some meaningful content
        await page.waitForLoadState('domcontentloaded');
        expect(await page.locator('body').textContent()).toBeTruthy();
    });

    test('Login page (/login) loads', async ({ page }) => {
        await page.goto('/login');
        await page.waitForLoadState('domcontentloaded');
        // Should have an identifier/password form
        const form = page.locator('form');
        await expect(form.first()).toBeVisible({ timeout: 10_000 });
    });

    test('Register page (/register) loads', async ({ page }) => {
        await page.goto('/register');
        await page.waitForLoadState('domcontentloaded');
        const body = page.locator('body');
        await expect(body).toBeVisible();
    });

    test('Trace page (/trace) loads', async ({ page }) => {
        await page.goto('/trace');
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });

    test('404 page renders for unknown URL', async ({ page }) => {
        await page.goto('/this-page-does-not-exist-123');
        // Should either be 404 or a custom not-found page
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).toBeVisible();
    });
});

// ─── Auth Endpoints ────────────────────────────────────────────────────────────
test.describe('Smoke: Auth Endpoints', () => {
    test('POST /api/auth/health/login returns structured error for invalid creds', async ({ request }) => {
        const response = await request.post(`${API_BASE}/auth/health/login`, {
            data: { identifier: 'invalid', password: 'invalid' },
        });
        const body = await response.json();
        // Should be 400 or 401 with a structured error
        expect([400, 401]).toContain(response.status());
        expect(body.success).toBe(false);
    });

    test('POST /api/auth/provider/login returns structured error for invalid creds', async ({ request }) => {
        const response = await request.post(`${API_BASE}/auth/provider/login`, {
            data: { username: 'invalid', password: 'invalid' },
        });
        const body = await response.json();
        expect([400, 401]).toContain(response.status());
        expect(body.success).toBe(false);
    });
});

// ─── Core API Endpoints Respond ────────────────────────────────────────────────
test.describe('Smoke: Core API Endpoints (no auth → 401/403)', () => {
    const protectedEndpoints: Array<{ endpoint: string; expectedStatuses: number[] }> = [
        { endpoint: '/applications', expectedStatuses: [401, 403] },
        { endpoint: '/farms', expectedStatuses: [401, 403] },
        { endpoint: '/certificates', expectedStatuses: [401, 403] },
        { endpoint: '/audits', expectedStatuses: [401, 403] },
        { endpoint: '/planting-cycles', expectedStatuses: [401, 403] },
        { endpoint: '/lots', expectedStatuses: [401, 403, 404] },
        { endpoint: '/harvest-batches', expectedStatuses: [401, 403] },
        { endpoint: '/dashboard', expectedStatuses: [401, 403, 404] },
        { endpoint: '/notifications', expectedStatuses: [401, 403] },
        { endpoint: '/invoices', expectedStatuses: [401, 403] },
        { endpoint: '/payments', expectedStatuses: [401, 403, 404] },
    ];

    for (const { endpoint, expectedStatuses } of protectedEndpoints) {
        test(`GET ${endpoint} without auth returns expected status`, async ({ request }) => {
            const response = await request.get(`${API_BASE}${endpoint}`);
            // Optional modules may return 404 when not enabled in the deployment.
            expect(expectedStatuses).toContain(response.status());
        });
    }
});

// ─── Public API Endpoints ──────────────────────────────────────────────────────
test.describe('Smoke: Public API Endpoints', () => {
    test('GET /api/public/plants returns plant data', async ({ request }) => {
        const response = await request.get(`${API_BASE}/public/plants`);
        // May return 200 or 404 depending on seeding
        expect([200, 404]).toContain(response.status());
    });

    test('GET /api/standards returns standards', async ({ request }) => {
        const response = await request.get(`${API_BASE}/standards`);
        expect([200, 401, 403]).toContain(response.status());
    });

    test('GET /api/config returns config data', async ({ request }) => {
        const response = await request.get(`${API_BASE}/config`);
        expect([200, 401, 404]).toContain(response.status());
    });
});
