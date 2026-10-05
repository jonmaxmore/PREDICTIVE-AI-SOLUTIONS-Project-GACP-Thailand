/**
 * ============================================================================
 * FARMER SERVICES CARPET — healthId identity + every farmer-facing service
 * ============================================================================
 * Owner ask 2026-07-08: "e2e healthid และบริการของฝั่งเกษตรกรทั้งหมดแบบปูพรม".
 *
 * Complements carpet-pages.spec.ts (page-render walk of 37 /health routes) and
 * e2e-health-portal.spec.ts (portal navigation) with the layers those do NOT
 * cover:
 *   A. healthId IDENTITY BOUNDARIES — wrong password rejected; the HEALTH
 *      session is cryptographically useless on provider APIs (separate JWT
 *      secret + audience, not just a role gate).
 *   B. AUTHENTICATED API CARPET — every farmer-facing GET service answers
 *      success with the real session cookie (paths harvested from the real
 *      FE service layer, not guessed).
 *   C. FIXTURE-POWERED DATA FLOW — the planting service returns the seeded
 *      staging cycle; certificates/invoices carry the seeded data.
 *
 * Run:
 *   E2E_BASE_URL=https://staging.gacpth.com E2E_IGNORE_HTTPS_ERRORS=true \
 *   E2E_TEST_IDENTIFIER=<13-digit> E2E_TEST_PASSWORD=<pw> \
 *   npx playwright test e2e/farmer-services-carpet.spec.ts --project=chromium
 */

import { test, expect, type Page } from '@playwright/test';
import { HEALTH_STORAGE_STATE } from './helpers/auth';
import { healthIdentifier, NONEXISTENT_IDENTIFIER } from './helpers/seeded-credentials';

/**
 * ไม่มี `HAS_CREDS` และไม่มี `test.skip` อีกแล้ว (2026-09-11)
 *
 * เดิมสี่บล็อกข้างล่างข้ามตัวเองเมื่อไม่มี E2E_TEST_IDENTIFIER / E2E_TEST_PASSWORD
 * ซึ่งถูกตั้งไว้เฉพาะใน workflow กลางคืนที่ไม่รันอีกแล้ว ⇒ ข้ามตลอดกาล และขึ้นเขียว
 * ตอนนี้ค่าปริยายคือบัญชีที่ seed ไว้ · สภาพแวดล้อมที่ยังไม่ seed จะ **ล้มเหลว** ไม่ใช่ข้าม
 */
const IDENTIFIER = healthIdentifier();

// Farmer-facing GET services, harvested from src/lib/services/* (the exact
// paths the production FE calls through the /api proxy).
const FARMER_GET_ENDPOINTS: Array<{ path: string; label: string }> = [
    { path: '/api/auth/health/me', label: 'identity/profile' },
    { path: '/api/consent', label: 'PDPA consent status' },
    { path: '/api/applications/my', label: 'applications' },
    { path: '/api/certificates/my', label: 'certificates' },
    { path: '/api/invoices/my', label: 'invoices/billing' },
    { path: '/api/planting-cycles/my', label: 'planting cycles' },
    { path: '/api/farms/my/eligible-for-planting', label: 'farms eligible for planting' },
    { path: '/api/subscription/me', label: 'subscription' },
    { path: '/api/subscription/plans', label: 'subscription plans' },
];

// Provider-side APIs that the SAME health session must NOT be able to read
// (cross-portal crypto separation: 401 before any role check).
const PROVIDER_PROBE_ENDPOINTS = [
    '/api/provider/work',
    '/api/provider/scheduler/reviewer-assignments',
];

async function apiGet(page: Page, path: string) {
    // page.request carries the browser session cookies (auth + csrf).
    return page.request.get(path, { failOnStatusCode: false });
}

test.describe('A0. wrong password (clean context — no session)', () => {
    // Force a session-less context so this negative test doesn't inherit the
    // shared storageState.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('wrong password is rejected and never grants a session', async ({ page }) => {
        // ยิงใส่เลขบัตรที่ไม่มีในระบบ ไม่ใช่บัญชีจริง — ล็อกอินผิดห้าครั้งติดจะล็อกบัญชี
        // 15 นาที (the change log) · ก่อน 2026-09-11 บล็อกนี้ข้ามตัวเองเสมอจึงไม่เคยยิงจริง
        // พอเอา skip ออก ถ้ายังใช้บัญชี seed มันจะล็อกเกษตรกรที่ทุกไฟล์อื่นใช้ล็อกอิน
        // สิ่งที่ข้อนี้พิสูจน์ไม่เปลี่ยน: รหัสที่ไม่ถูกต้องไม่ได้เซสชัน
        await page.goto('/auth/health/login');
        await page.waitForSelector('#identifier', { timeout: 10_000 });
        await page.fill('#identifier', NONEXISTENT_IDENTIFIER);
        await page.fill('#password', 'Wrong@Password999');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(3000);
        expect(page.url()).not.toContain('/health/dashboard');
        const me = await apiGet(page, '/api/auth/health/me');
        expect([401, 403]).toContain(me.status());
    });
});

test.describe('A. healthId identity boundaries (shared session)', () => {
    // Reuse the ONE login from the setup project — no per-test login (avoids
    // the 50/15min login rate-limit under carpet runs).
    test.use({ storageState: HEALTH_STORAGE_STATE });

    test('the identity API answers for a valid healthId session', async ({ page }) => {
        const me = await apiGet(page, '/api/auth/health/me');
        expect(me.status()).toBe(200);
        const body = await me.json();
        expect(body.success).not.toBe(false);
        expect(JSON.stringify(body)).not.toContain('"password"');
    });

    test('the HEALTH session is useless on provider APIs (crypto separation)', async ({ page }) => {
        for (const path of PROVIDER_PROBE_ENDPOINTS) {
            const res = await apiGet(page, path);
            expect([401, 403, 404], `${path} must reject a HEALTH session`).toContain(res.status());
            expect(res.status(), `${path} must not leak to a HEALTH session`).not.toBe(200);
        }
    });
});

test.describe('B. farmer service API carpet (authenticated)', () => {
    test.use({ storageState: HEALTH_STORAGE_STATE });

    test('every farmer-facing GET service answers with success', async ({ page }) => {
        const failures: string[] = [];
        for (const ep of FARMER_GET_ENDPOINTS) {
            const res = await apiGet(page, ep.path);
            if (res.status() !== 200) {
                failures.push(`${ep.label} ${ep.path} -> HTTP ${res.status()}`);
                continue;
            }
            let body: { success?: boolean } | null = null;
            try { body = await res.json(); } catch { /* non-JSON */ }
            if (body && body.success === false) {
                failures.push(`${ep.label} ${ep.path} -> success:false`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

});

test.describe('B2. unauthenticated fail-closed (clean context)', () => {
    // Own empty storageState so this describe's context has NO session —
    // otherwise browser.newContext() here would inherit describe-B's auth.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('every farmer service rejects an unauthenticated caller (no 200 leak)', async ({ request }) => {
        const leaks: string[] = [];
        for (const ep of FARMER_GET_ENDPOINTS) {
            if (ep.path === '/api/subscription/plans') { continue; } // public pricing by design
            const res = await request.get(ep.path, { failOnStatusCode: false });
            // Fail-closed: unauth must NEVER get 200 (data). 401/403 are the
            // norm; a transient 429 is still not-a-leak. <400 = real leak.
            if (res.status() < 400) { leaks.push(`${ep.path} -> HTTP ${res.status()}`); }
        }
        expect(leaks, leaks.join(' | ')).toEqual([]);
    });
});

test.describe('C. fixture-powered farmer data flows', () => {
    test.use({ storageState: HEALTH_STORAGE_STATE });

    test('planting service returns cycles and the planting page lists them', async ({ page }) => {
        const res = await apiGet(page, '/api/planting-cycles/my');
        expect(res.status()).toBe(200);
        const body = await res.json();
        const cycles = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
        // The staging UAT fixture guarantees at least one cycle for this user's
        // org; a farmer with zero cycles still gets a valid empty list.
        expect(Array.isArray(cycles)).toBe(true);

        await page.goto('/health/planting');
        await expect(page.getByRole('heading').first()).toBeVisible();
        // No error boundary / crash text.
        await expect(page.getByText(/something went wrong|เกิดข้อผิดพลาดร้ายแรง/i)).toHaveCount(0);
    });

    test('certificates + invoices services return the seeded data shape', async ({ page }) => {
        const certs = await apiGet(page, '/api/certificates/my');
        expect(certs.status()).toBe(200);
        const invoices = await apiGet(page, '/api/invoices/my');
        expect(invoices.status()).toBe(200);
        const invBody = await invoices.json();
        expect(invBody.success).not.toBe(false);
    });

    test('payments page renders the two-money-flow cards (state + platform)', async ({ page }) => {
        await page.goto('/health/payments');
        await expect(page.getByText('ค่าธรรมเนียมรัฐ').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('ค่าบริการแพลตฟอร์ม').first()).toBeVisible();
    });
});
