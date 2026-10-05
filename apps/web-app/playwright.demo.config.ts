/**
 * Run-config for the API-mocked `playwright/**` suite.
 *
 * The default `playwright.config.ts` targets a live backend on port 80. This
 * one runs only the mocked specs, which need nothing but `next start` — no
 * database, no Prisma client, no Docker. Useful locally and in any environment
 * where the backend cannot be brought up.
 *
 *   npx next build && npx next start -p 3000
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test --config=playwright.demo.config.ts
 *
 * Optional env:
 *   STAGE_SHOT_DIR              per-stage screenshots from the journey specs
 *   PREVIEW_SHOT_DIR            slip / document preview screenshots
 *   PLAYWRIGHT_CHROMIUM_PATH    explicit Chromium binary, for images whose
 *                               bundled build does not match the
 *                               @playwright/test version and where downloading
 *                               one is not possible.
 */
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const hasPinnedChromium = (() => {
    try { return fs.existsSync(CHROMIUM); } catch { return false; }
})();

export default defineConfig({
    testDir: '.',
    testMatch: ['playwright/**/*.spec.ts'],
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    reporter: [['list']],
    use: {
        baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
        // Fall through to Playwright's own resolution when the pinned binary is
        // absent, so this config is not tied to one machine's layout.
        ...(hasPinnedChromium ? { launchOptions: { executablePath: CHROMIUM } } : {}),
        screenshot: 'only-on-failure',
        trace: 'off',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
