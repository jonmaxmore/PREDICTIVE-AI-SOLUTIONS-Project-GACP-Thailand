/**
 * ============================================================================
 * DOCUMENT_REVIEWER — the document preview box, rendered for real
 * ============================================================================
 *
 * `dtam-staff-full-journey.spec.ts` is titled "Full DTAM Staff Journey" and its
 * Stage 1 is "DOCUMENT_REVIEWER lands on review queue + opens application", but
 * all 11 of its stages navigate only to `/auth/health/login` and then assert
 * through `pageFetch()`. It is an API-contract spec: the reviewer UI is never
 * rendered, so the preview pane a reviewer actually reads documents in had no
 * coverage at all — neither that it renders, nor that its iframe resolves.
 *
 * This spec drives that UI. It opens the application detail page as a
 * DOCUMENT_REVIEWER, switches to the documents tab, clicks Preview on a real
 * document row, and asserts the preview iframe both mounts AND loads a
 * document (an iframe pointed at a 404 still "exists" — the assertion is that
 * its document actually parsed and has content).
 */
import { test, expect } from '@playwright/test';
import { signInAsDocumentReviewer, reviewerStageMocks, W1B_APP_ID } from './fixtures/dtam-fixtures';
import { installMockAssetRoutes } from './fixtures/mock-assets';

const SHOTS = process.env.PREVIEW_SHOT_DIR || 'test-results/preview';

test.describe('DOCUMENT_REVIEWER document preview', () => {
    test('the reviewer can open a document and the preview actually renders it', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 }); // xl+ → inline preview pane
        await signInAsDocumentReviewer(page);
        await installMockAssetRoutes(page);
        await reviewerStageMocks(page);

        await page.goto(`/provider/applications/${W1B_APP_ID}`);
        await page.waitForLoadState('domcontentloaded');

        // Reach the documents tab. Exact match: the tab strip also carries
        // "เอกสารคำขอ (เต็ม)", which a substring match would hit first.
        await expect(page.getByText('APP-2026-W1B-00001')).toBeVisible({ timeout: 20_000 });
        await page.getByText('เอกสาร', { exact: true }).first().click();

        const previewBtn = page.getByRole('button', { name: /ดูตัวอย่าง|Preview/i }).first();
        await expect(previewBtn, 'no Preview button — the documents tab did not render any document rows')
            .toBeVisible({ timeout: 20_000 });
        await previewBtn.click();

        const frame = page.locator('iframe[title*="ตัวอย่างเอกสาร"]').first();
        await expect(frame).toBeVisible({ timeout: 15_000 });

        // An iframe whose src 404s is still visible and still has a
        // contentDocument — so assert the loaded document has real content.
        // Check `documentElement`, not `body`: an SVG document (which is what a
        // scanned page preview is here) has no <body> at all, so a body-based
        // check reports "empty" for a preview that rendered perfectly well.
        await expect
            .poll(async () => frame.evaluate((el: HTMLIFrameElement) => {
                const d = el.contentDocument;
                if (!d || !d.documentElement) return -1;   // cross-origin / not ready
                const root = d.documentElement;
                return root.childElementCount > 0 ? root.childElementCount : 0;
            }), { timeout: 15_000 })
            .toBeGreaterThan(0);

        await page.screenshot({ path: `${SHOTS}/document-reviewer__document-preview.png`, fullPage: false });
    });
});
