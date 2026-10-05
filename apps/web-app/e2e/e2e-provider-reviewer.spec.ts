/**
 * ============================================================================
 * E2E TESTS — DOCUMENT_REVIEWER (ผู้ตรวจเอกสาร) portal
 * ============================================================================
 * Complements the backend UAT. Verifies the reviewer's surfaces render and the
 * cross-role RBAC boundary holds end-to-end in a real browser:
 *   - login + landing on a /provider/* page
 *   - the reviewer's tool pages render (RBAC admits document_reviewer)
 *   - the role-correctness boundary: the reviewer is BOUNCED from the
 *     scheduler + auditor surfaces it must not enter (the "เด่งไปเด่งมา" guard,
 *     provider-role-config.ts excludes DOCUMENT_REVIEWER from /provider/scheduler
 *     and /provider/audits)
 *
 * Run (against staging with the seeded reviewer):
 *   E2E_BASE_URL=https://staging.gacpth.com \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_REVIEWER_USERNAME=1111111111111 \
 *   E2E_REVIEWER_PASSWORD=Gacp@2025 \
 *   npx playwright test e2e/e2e-provider-reviewer.spec.ts --project=chromium
 *
 * (Not in CI — runs against a live server, staging or local `npm run dev`.)
 */

import { test, expect } from '@playwright/test';
import { loginAsReviewer } from './helpers/provider-auth';

/** Pages the DOCUMENT_REVIEWER is route-admitted to (provider-role-config.ts). */
const REVIEWER_PAGES = [
    { path: '/provider/work', name: 'work inbox (assigned queue)' },
    { path: '/provider/applications', name: 'applications list (reviewerId-scoped)' },
    { path: '/provider/analytics', name: 'analytics' },
    { path: '/provider/certificates', name: 'certificates (read)' },
];

/** Surfaces the reviewer must NOT enter — middleware bounces them (RBAC boundary). */
const FORBIDDEN_PAGES = [
    '/provider/scheduler/queue',
    '/provider/audits',
];

test.describe('E2E: Document Reviewer — login + landing', () => {
    test('reviewer login lands on a /provider/* page (not bounced to auth)', async ({ page }) => {
        await loginAsReviewer(page);
        await expect(page).toHaveURL(/\/provider\//);
        await page.waitForLoadState('networkidle');
        expect(((await page.locator('body').textContent()) || '').length).toBeGreaterThan(0);
    });
});

test.describe('E2E: Document Reviewer — tool pages render (RBAC admits)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsReviewer(page);
    });

    for (const p of REVIEWER_PAGES) {
        test(`renders ${p.name}`, async ({ page }) => {
            await page.goto(p.path);
            await page.waitForLoadState('networkidle');
            // Admitted (not bounced to login) + real content.
            expect(page.url()).not.toContain('/auth/');
            await expect(page.locator('body')).toBeVisible();
            expect(((await page.locator('body').textContent()) || '').length).toBeGreaterThan(50);
        });
    }
});

test.describe('E2E: Document Reviewer — cross-role RBAC boundary (must be bounced)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsReviewer(page);
    });

    for (const path of FORBIDDEN_PAGES) {
        test(`is bounced away from ${path} (excluded from this role)`, async ({ page }) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            // The middleware redirects an unauthorized provider role away from the
            // forbidden prefix — the final URL must NOT be the forbidden page.
            expect(page.url()).not.toContain(path);
        });
    }
});
