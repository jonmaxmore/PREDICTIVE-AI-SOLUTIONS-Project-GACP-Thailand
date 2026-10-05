/**
 * ============================================================================
 * E2E TESTS — ACCOUNT (บัญชี / finance) portal
 * ============================================================================
 * Complements the backend UAT. Verifies the account department's surfaces
 * render and the cross-role RBAC boundary holds end-to-end in a real browser:
 *   - login + landing on a /provider/* page
 *   - the account tool pages render (RBAC admits ACCOUNT) — accounting, receipts, analytics
 *   - the role-correctness boundary: the account user is BOUNCED from the
 *     reviewer/auditor/scheduler surfaces it must not enter (provider-role-config.ts
 *     excludes ACCOUNT from /provider/applications, /provider/audits, /provider/scheduler)
 *
 * Run (against staging with the seeded account):
 *   E2E_BASE_URL=https://staging.gacpth.com \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_ACCOUNT_USERNAME=4444444444444 \
 *   E2E_ACCOUNT_PASSWORD=Gacp@2025 \
 *   npx playwright test e2e/e2e-provider-account.spec.ts --project=chromium
 *
 * (Not in CI — runs against a live server, staging or local `npm run dev`.)
 */

import { test, expect } from '@playwright/test';
import { loginAsAccount } from './helpers/provider-auth';

/** Pages the ACCOUNT roles are route-admitted to (provider-role-config.ts). */
const ACCOUNT_PAGES = [
    { path: '/provider/accounting', name: 'accounting dashboard (slip review + ledger)' },
    { path: '/provider/receipts', name: 'receipts / tax invoices' },
    { path: '/provider/analytics', name: 'analytics' },
];

/** Surfaces the account user must NOT enter — middleware bounces them (RBAC boundary). */
const FORBIDDEN_PAGES = [
    '/provider/applications',
    '/provider/audits',
    '/provider/scheduler/queue',
];

test.describe('E2E: Account — login + landing', () => {
    test('account login lands on a /provider/* page (not bounced to auth)', async ({ page }) => {
        await loginAsAccount(page);
        await expect(page).toHaveURL(/\/provider\//);
        await page.waitForLoadState('networkidle');
        expect(((await page.locator('body').textContent()) || '').length).toBeGreaterThan(0);
    });
});

test.describe('E2E: Account — tool pages render (RBAC admits)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAccount(page);
    });

    for (const p of ACCOUNT_PAGES) {
        test(`renders ${p.name}`, async ({ page }) => {
            await page.goto(p.path);
            await page.waitForLoadState('networkidle');
            expect(page.url()).not.toContain('/auth/');
            await expect(page.locator('body')).toBeVisible();
            expect(((await page.locator('body').textContent()) || '').length).toBeGreaterThan(50);
        });
    }
});

test.describe('E2E: Account — cross-role RBAC boundary (must be bounced)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAccount(page);
    });

    for (const path of FORBIDDEN_PAGES) {
        test(`is bounced away from ${path} (excluded from this role)`, async ({ page }) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            expect(page.url()).not.toContain(path);
        });
    }
});
