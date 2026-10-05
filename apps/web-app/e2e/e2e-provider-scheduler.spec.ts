/**
 * ============================================================================
 * E2E TESTS — SCHEDULER ("คนแจกงาน" / work-distributor) portal
 * ============================================================================
 * Exercises the scheduler's tools/menus end-to-end: login + landing, every
 * scheduler page renders (RBAC admits SCHEDULER, no bounce-to-login), and the
 * work-distribution (ledger) view loads without crashing on the apiClient
 * envelope. Complements the backend UAT (assign/reassign/ledger) already run on
 * staging.
 *
 * Run (against staging with the seeded scheduler):
 *   E2E_BASE_URL=https://staging.gacpth.com \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_SCHEDULER_USERNAME=3333333333333 \
 *   E2E_SCHEDULER_PASSWORD=Gacp@2025 \
 *   npx playwright test e2e/e2e-provider-scheduler.spec.ts --project=chromium
 *
 * (Not in CI — the web-app e2e specs run against a live server, staging or a
 *  local `npm run dev`. Mirrors the existing e2e-provider-portal.spec.ts.)
 */

import { test, expect } from '@playwright/test';
import { loginAsScheduler } from './helpers/provider-auth';

/** The scheduler's tool pages (provider-role-config.ts admits ADMIN+SCHEDULER). */
const SCHEDULER_PAGES = [
    { path: '/provider/coordinator', name: 'coordinator dashboard (queues + assign-reviewer modal)' },
    { path: '/provider/scheduler/queue', name: 'audit-scheduling queue (AssignAuditorModal)' },
    { path: '/provider/scheduler/reassign', name: 'auditor reassignment' },
    { path: '/provider/scheduler/reviewer-reassign', name: 'reviewer reassignment (incl. REVISION_REQUESTED)' },
    { path: '/provider/scheduler/workload', name: 'work-distribution / fairness (ledger)' },
    { path: '/provider/calendar', name: 'calendar' },
];

test.describe('E2E: Scheduler — login + landing', () => {
    test('scheduler login auto-routes to /provider/coordinator', async ({ page }) => {
        await loginAsScheduler(page);
        await expect(page).toHaveURL(/\/provider\/coordinator/);
        await page.waitForLoadState('networkidle');
        const body = await page.locator('body').textContent();
        expect((body || '').length).toBeGreaterThan(0);
    });
});

test.describe('E2E: Scheduler — tool pages render (RBAC admits scheduler)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsScheduler(page);
    });

    for (const p of SCHEDULER_PAGES) {
        test(`renders ${p.name}`, async ({ page }) => {
            await page.goto(p.path);
            await page.waitForLoadState('networkidle');
            // RBAC: scheduler is NOT bounced to the login page,
            expect(page.url()).not.toContain('/auth/');
            // and the page renders real content (not a blank/error shell).
            await expect(page.locator('body')).toBeVisible();
            const body = await page.locator('body').textContent();
            expect((body || '').length).toBeGreaterThan(50);
        });
    }
});

test.describe('E2E: Scheduler — work-distribution view loads ledger data', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsScheduler(page);
    });

    test('workload page shows the distribution view (data row or honest empty-state, no crash)', async ({ page }) => {
        await page.goto('/provider/scheduler/workload');
        await page.waitForLoadState('networkidle');
        const body = (await page.locator('body').textContent()) || '';
        // Either the fairness/distribution UI rendered, or the honest empty-state —
        // both prove the page consumed the /provider/ledger/* response without
        // crashing on the apiClient envelope-strip.
        expect(body).toMatch(/การกระจายงาน|งานที่ได้รับมอบหมาย|ยังไม่มีการมอบหมาย|Work Distribution/);
        // The honest-metric guard: never mislabel throughput as current load.
        expect(body).not.toContain('ภาระงานปัจจุบัน');
    });
});
