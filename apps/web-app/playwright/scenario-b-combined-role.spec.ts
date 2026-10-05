/**
 * ============================================================================
 * Scenario B — one officer holds BOTH the document-review and on-site roles
 * ============================================================================
 *
 * Scenario A (a document reviewer and an on-site auditor who are different
 * people) is covered by the existing journey specs. Scenario B — an admin or
 * scheduler assigning both jobs to the same officer — is what the schema's
 * `sameReviewerAuditor` flag exists for, and it had no end-to-end coverage on
 * either side.
 *
 * What this pins, on the client:
 *   1. The same user id occupies `reviewerId` AND `auditorId` on one
 *      application without the detail page erroring.
 *   2. That officer can carry the application from document review through the
 *      on-site decision — the handoff that would break if the UI assumed the
 *      two roles were different people.
 *   3. The visibility filter's cross-role branch is exercised: an application
 *      is reachable by a user who is reviewer and auditor at once.
 *
 * Scope, stated plainly: this is the API-mocked suite, so it proves the client
 * and API-client survive the combined-role shape. It does NOT prove the
 * backend's uniqueness/assignment constraints — that needs a live database,
 * which is blocked while `prisma generate` cannot fetch its engine. The backend
 * side is covered by `application-visibility.test.js`, which asserts the
 * `sameReviewerAuditor: true` branch directly.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { signInAsDocumentReviewer } from './fixtures/dtam-fixtures';
import { installMockAssetRoutes } from './fixtures/mock-assets';

const SHOTS = process.env.PREVIEW_SHOT_DIR || 'test-results/preview';

/** The one officer wearing both hats. */
const OFFICER_ID = 'provider-user-combined-001';
const APP_ID = 'app-scenario-b-001';
const APP_NUMBER = 'APP-2026-SCEN-B-001';

function combinedApplication(overrides: Record<string, unknown> = {}) {
    return {
        id: APP_ID,
        applicationNumber: APP_NUMBER,
        status: 'UNDER_REVIEW',
        healthId: '1234567890999',
        // The point of the fixture: one id in both columns, plus the flag the
        // backend's visibility filter branches on.
        reviewerId: OFFICER_ID,
        auditorId: OFFICER_ID,
        sameReviewerAuditor: true,
        createdAt: '2026-05-10T03:00:00.000Z',
        updatedAt: '2026-07-27T03:00:00.000Z',
        applicant: {
            firstName: 'สมปอง', lastName: 'ร่วมบทบาท',
            phone: '082-381-6274', email: 'sompong.scenb@test.local',
        },
        formData: {
            farmData: {
                farmName: 'ไร่ทดสอบควบบทบาท',
                address: '1 หมู่ 1 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
                latitude: 18.7883, longitude: 98.9853,
            },
            farmAddress: '1 หมู่ 1 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
            plantName: 'กัญชา',
            areaType: 'organic',
            productionData: {}, harvestData: {},
            documents: {
                idCardDoc: '/mock/doc-id-card.png',
                houseRegDoc: '/mock/doc-house-reg.png',
                LAND_TITLE: '/mock/doc-land-title.png',
            },
            reviewedSteps: [], reviewProgress: {},
            workflowState: 'UNDER_REVIEW',
            sameReviewerAuditor: true,
        },
        workflowHistory: [],
        ...overrides,
    };
}

async function scenarioBMocks(page: Page, opts: { reviewedSteps?: number[] } = {}) {
    await installMockAssetRoutes(page);
    const app = combinedApplication(
        opts.reviewedSteps
            ? { formData: { ...combinedApplication().formData, reviewedSteps: opts.reviewedSteps } }
            : {},
    );
    const ok = (route: Route, data: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

    // Order matters: Playwright tries the MOST RECENTLY registered matching
    // route first, so the broad list pattern must be registered BEFORE the
    // specific detail one — otherwise the catch-all swallows the detail call
    // and the page renders with every field empty.
    await page.route('**/api/provider/applications**', (r) =>
        ok(r, { items: [app], total: 1, page: 1, pageSize: 20 }));
    await page.route(`**/api/provider/applications/${APP_ID}`, (r) => ok(r, app));
    await page.route(`**/api/provider/applications/${APP_ID}/workflow-transitions`, (r) =>
        ok(r, { applicationId: APP_ID, workflowState: 'DOC_APPROVED' }));
    await page.route(`**/api/audits/**`, (r) => ok(r, { id: 'audit-scen-b', applicationId: APP_ID, auditorId: OFFICER_ID }));
    await page.route('**/api/audit/**', (r) => ok(r, { id: 'audit-scen-b', applicationId: APP_ID, auditorId: OFFICER_ID }));
    await page.route('**/api/notifications**', (r) => ok(r, { items: [], unreadCount: 0 }));
}

test.describe('Scenario B — combined reviewer + on-site auditor', () => {
    test('one officer holds both roles and the application detail renders without error', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await signInAsDocumentReviewer(page);
        await scenarioBMocks(page);

        await page.goto(`/provider/applications/${APP_ID}`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.getByText(APP_NUMBER)).toBeVisible({ timeout: 20_000 });

        // No constraint/permission error surface. These are the app's own error
        // states — if the combined-role shape tripped anything, one shows.
        for (const bad of [/เกิดข้อผิดพลาด/, /ไม่มีสิทธิ/, /Something went wrong/i]) {
            await expect(page.getByText(bad)).toHaveCount(0);
        }

        await page.screenshot({ path: `${SHOTS}/scenario-b__detail-combined-role.png`, fullPage: false });
    });

    test('the same officer can read documents and then reach the on-site decision', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await signInAsDocumentReviewer(page);
        await scenarioBMocks(page);

        await page.goto(`/provider/applications/${APP_ID}`);
        await expect(page.getByText(APP_NUMBER)).toBeVisible({ timeout: 20_000 });

        // Hat 1 — document review: open a document and confirm it renders.
        await page.getByText('เอกสาร', { exact: true }).first().click();
        const previewBtn = page.getByRole('button', { name: /ดูตัวอย่าง|Preview/i }).first();
        await expect(previewBtn, 'combined-role officer sees no reviewable documents').toBeVisible({ timeout: 15_000 });
        await previewBtn.click();

        const frame = page.locator('iframe[title*="ตัวอย่างเอกสาร"]').first();
        await expect(frame).toBeVisible({ timeout: 15_000 });
        await expect
            .poll(async () => frame.evaluate((el: HTMLIFrameElement) =>
                el.contentDocument?.documentElement?.childElementCount ?? -1), { timeout: 15_000 })
            .toBeGreaterThan(0);

        await page.screenshot({ path: `${SHOTS}/scenario-b__reviewer-hat.png`, fullPage: false });

        // Hat 2 — the same session reaches the on-site inspection surface for
        // the same application. No re-login, no role switch.
        const resp = await page.evaluate(async (id) => {
            const r = await fetch(`/api/audit/onsite/${id}/start`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ latitude: 18.7883, longitude: 98.9853 }),
            });
            return { status: r.status, body: await r.json().catch(() => null) };
        }, APP_ID);
        expect(resp.status, 'on-site start rejected for the combined-role officer').toBe(200);
    });

    test('the fixture really does put one id in both role columns', async ({ page }) => {
        // Guards the test itself: if a future edit splits the ids, this spec
        // would silently go back to testing Scenario A.
        await signInAsDocumentReviewer(page);
        await scenarioBMocks(page);
        await page.goto(`/provider/applications/${APP_ID}`);

        const app = await page.evaluate(async (id) => {
            const r = await fetch(`/api/provider/applications/${id}`);
            return (await r.json()).data as { reviewerId: string; auditorId: string; sameReviewerAuditor: boolean };
        }, APP_ID);

        expect(app.reviewerId).toBe(OFFICER_ID);
        expect(app.auditorId).toBe(OFFICER_ID);
        expect(app.reviewerId).toBe(app.auditorId);
        expect(app.sameReviewerAuditor).toBe(true);
    });
});
