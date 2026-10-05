/**
 * ============================================================================
 * Preview integrity — slips and application documents must actually render
 * ============================================================================
 *
 * Every existing spec asserted on DOM text, so a preview whose bytes never
 * loaded still passed: the applicant's slip, the reviewer's document iframe,
 * and the accounting slip-review modal all showed a broken-image icon while
 * the suite reported green. That modal exists so a clerk can read the amount
 * and transfer time off the slip — a broken image there is the whole feature
 * failing, silently.
 *
 * Root cause: fixtures pointed previews at `/mock/*.png` (404 — `public/mock/`
 * does not exist) and `/api/payments/slip/<id>/file` (503 — no backend in mock
 * mode). `installMockAssetRoutes` serves both.
 *
 * The assertion is `naturalWidth`, not visibility: a broken `<img>` is still
 * "visible" to Playwright. `naturalWidth === 0` on a completed image is the
 * browser reporting the bytes failed to decode.
 *
 * Set PREVIEW_NO_ASSET_ROUTES=1 to skip the fix and watch these fail — that is
 * how the RED state was verified rather than assumed.
 */
import { test, expect } from '@playwright/test';
import { accountDtamMocks, accountPlatformMocks, seedProviderTokenCookie, DTAM_PENDING_SLIPS } from './account-fixtures';
import { installMockAssetRoutes, expectImagesRendered } from './fixtures/mock-assets';

const SKIP_FIX = process.env.PREVIEW_NO_ASSET_ROUTES === '1';
const SHOTS = process.env.PREVIEW_SHOT_DIR || 'test-results/preview';

async function assets(page: import('@playwright/test').Page) {
    if (!SKIP_FIX) await installMockAssetRoutes(page);
}

test.describe('Slip preview — ACCOUNT_DTAM', () => {
    test('the slip-review modal renders a readable slip image, not a broken icon', async ({ page }) => {
        await seedProviderTokenCookie(page, 'ACCOUNT_DTAM');
        await assets(page);
        await accountDtamMocks(page);

        await page.goto('/provider/accounting');
        await page.waitForLoadState('domcontentloaded');

        const reviewButton = page.getByRole('button', { name: /^ตรวจ$/ }).first();
        await expect(reviewButton).toBeVisible({ timeout: 20_000 });
        await reviewButton.click();

        const slipImg = page.locator('img[alt^="สลิปสำหรับ"]');
        await expect(slipImg).toBeVisible({ timeout: 15_000 });

        // The load has to actually complete before naturalWidth means anything.
        await expect
            .poll(async () => slipImg.evaluate((el: HTMLImageElement) => el.complete), { timeout: 15_000 })
            .toBe(true);

        const natural = await slipImg.evaluate((el: HTMLImageElement) => ({
            w: el.naturalWidth, h: el.naturalHeight, src: el.currentSrc || el.src,
        }));
        expect(
            natural.w,
            `slip preview failed to decode (src=${natural.src}) — this is the broken-image icon`,
        ).toBeGreaterThan(0);
        expect(natural.h).toBeGreaterThan(0);

        await page.screenshot({ path: `${SHOTS}/account-dtam__slip-preview.png`, fullPage: false });

        const { broken } = await expectImagesRendered(page);
        expect(broken, `broken images on the DTAM slip-review modal: ${broken.join(', ')}`).toEqual([]);
    });
});

test.describe('Slip preview — ACCOUNT_PLATFORM', () => {
    test('the platform-side slip modal renders its slip image too', async ({ page }) => {
        await seedProviderTokenCookie(page, 'ACCOUNT_PLATFORM');
        await assets(page);
        await accountPlatformMocks(page);

        await page.goto('/provider/accounting');
        await page.waitForLoadState('domcontentloaded');

        const reviewButton = page.getByRole('button', { name: /^ตรวจ$/ }).first();
        await expect(reviewButton).toBeVisible({ timeout: 20_000 });
        await reviewButton.click();

        const slipImg = page.locator('img[alt^="สลิปสำหรับ"]');
        await expect(slipImg).toBeVisible({ timeout: 15_000 });
        await expect
            .poll(async () => slipImg.evaluate((el: HTMLImageElement) => el.complete), { timeout: 15_000 })
            .toBe(true);

        const w = await slipImg.evaluate((el: HTMLImageElement) => el.naturalWidth);
        expect(w, 'platform slip preview failed to decode').toBeGreaterThan(0);

        await page.screenshot({ path: `${SHOTS}/account-platform__slip-preview.png`, fullPage: false });
    });
});

test.describe('Slip preview — PDF slips', () => {
    test('a PDF slip is previewed inline, not reduced to an "open in a new tab" link', async ({ page }) => {
        // slip-upload-modal accepts application/pdf alongside jpeg/png, so a
        // clerk will meet PDF slips. The modal only inlined `image/*`; a PDF
        // fell to a link, meaning the reviewer had to leave the approve/reject
        // screen to see the document they were approving.
        await seedProviderTokenCookie(page, 'ACCOUNT_DTAM');
        await assets(page);
        await accountDtamMocks(page);
        // Build the PDF row from the fixture rather than re-fetching it:
        // `route.fetch()` performs the real request and bypasses the fixture's
        // own handler, so with no backend the queue came back empty.
        // Registered AFTER accountDtamMocks so this handler wins.
        const pdfSlips = DTAM_PENDING_SLIPS.map((s, i) => (i === 0
            ? { ...s, id: 'slip-w1c-dtam-pdf-001', fileMimeType: 'application/pdf', fileUrl: '/mock/slip-dtam.pdf' }
            : s));
        await page.route('**/api/payments/slip/pending**', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: pdfSlips }),
            });
        });

        await page.goto('/provider/accounting');
        await page.waitForLoadState('domcontentloaded');
        const reviewButton = page.getByRole('button', { name: /^ตรวจ$/ }).first();
        await expect(reviewButton).toBeVisible({ timeout: 20_000 });
        await reviewButton.click();

        // The document must be ON SCREEN. An <a> pointing at the file is not a
        // preview, which is exactly the state this pins against.
        const viewer = page.locator('[data-testid="slip-pdf-preview"]');
        await expect(
            viewer,
            'PDF slip rendered no inline viewer — the clerk cannot see the slip they are approving',
        ).toBeVisible({ timeout: 15_000 });

        const box = await viewer.boundingBox();
        expect(box?.height ?? 0, 'inline PDF viewer collapsed to zero height').toBeGreaterThan(200);

        // Assert the CONTRACT THE APP OWNS, not the viewer's internals.
        //
        // An earlier version polled for the <embed> that Chromium's PDF viewer
        // injects. That passed locally against full Chrome and failed all three
        // retries in CI, because since Playwright 1.49 headless runs use
        // `chromium-headless-shell`, which is built without PDFium — no PDF
        // viewer, so no <embed>, ever. The product was fine; the assertion was
        // testing a browser plugin that CI's browser does not ship.
        //
        // What the app is actually responsible for: pointing an iframe at the
        // slip file, and that URL serving a real PDF. Both are checked below,
        // and both hold in every browser. Whether PDFium then paints it is
        // Chromium's job, not this codebase's.
        const src = await viewer.getAttribute('src');
        expect(src, 'PDF viewer iframe has no src').toBeTruthy();

        const served = await page.evaluate(async (u) => {
            const r = await fetch(u!);
            const buf = new Uint8Array(await r.arrayBuffer());
            const magic = String.fromCharCode(...buf.slice(0, 5));
            return { status: r.status, type: r.headers.get('content-type'), magic, bytes: buf.length };
        }, src);

        expect(served.status, `slip file did not resolve (${src})`).toBe(200);
        expect(served.type, 'slip file is not served as a PDF').toContain('application/pdf');
        // %PDF- header: proves real PDF bytes reached the browser, not an
        // error page with a PDF content-type stapled on.
        expect(served.magic, 'slip file body is not a PDF').toBe('%PDF-');
        expect(served.bytes).toBeGreaterThan(100);

        await page.screenshot({ path: `${SHOTS}/account-dtam__pdf-slip-preview.png`, fullPage: false });
    });
});

test.describe('Mock asset routes serve decodable content', () => {
    test('every preview URL the app requests returns an image the browser can decode', async ({ page }) => {
        await assets(page);

        // Probe the exact URL shapes the components build, through the same
        // routing layer the app uses, and confirm each decodes in-browser.
        const urls = [
            '/api/payments/slip/slip-w1c-dtam-001/file',
            '/api/payments/slip/slip-w1c-plat-001/file',
            '/mock/slip-w1b-state.png',
            '/mock/slip-w1b-platform.png',
            '/mock/audit-photo-w1b.png',
        ];

        await page.goto('/');
        const results = await page.evaluate(async (list) => {
            const out: { url: string; w: number; h: number }[] = [];
            for (const u of list) {
                const dims = await new Promise<{ w: number; h: number }>((resolve) => {
                    const img = new Image();
                    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
                    img.onerror = () => resolve({ w: 0, h: 0 });
                    img.src = u;
                });
                out.push({ url: u, ...dims });
            }
            return out;
        }, urls);

        const failed = results.filter((r) => r.w === 0);
        expect(failed.map((f) => f.url), 'these preview URLs did not decode').toEqual([]);
    });
});
