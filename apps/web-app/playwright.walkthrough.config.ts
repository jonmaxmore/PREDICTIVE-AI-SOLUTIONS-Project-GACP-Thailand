/**
 * Run-config for the STAGING-WALKTHROUGH capture kit (`e2e-walkthrough/`).
 *
 * Deliberately separate from `playwright.config.ts` (testMatch
 * `e2e/**` + `playwright/**`) and `playwright.demo.config.ts` (testMatch
 * `playwright/**`) — this suite is matched by neither, so it never runs as
 * part of the regular `pnpm test:e2e` / CI suites. It records full video +
 * trace for every test (heavy artifacts by design — this is a documentation/
 * evidence capture tool, not a pass/fail gate) and targets a real host
 * (staging), never `localhost` or a CI-only backend.
 *
 * Usage:
 *   E2E_BASE_URL=https://staging.gacpth.com \
 *   WALK_FARMER_ID=... WALK_FARMER_PW=...  (per role — see role-routes.ts;
 *     any role with no creds set is skipped, not guessed) \
 *   npx playwright test --config=playwright.walkthrough.config.ts
 *
 * `workers: 1` / `fullyParallel: false` is LOAD-BEARING, not a style choice:
 *   1. walkthrough.spec.ts accumulates results in an in-memory array that its
 *      own `afterAll` writes to `walkthrough-manifest.json` — that is only
 *      correct if every test in the file runs in the SAME worker process.
 *   2. Staging shares the production droplet's login rate-limiter (see the
 *      header of `.github/workflows/e2e-staging-nightly.yml`) — parallel
 *      logins from one IP trip HTTP 429.
 */
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Same fallback pattern as playwright.demo.config.ts: use the pinned sandbox
// Chromium if it exists (this repo's containers), otherwise fall through to
// Playwright's normal resolution — the expected path on a staging host that
// just ran `npx playwright install chromium` (no pinned build there).
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const hasPinnedChromium = (() => {
  try { return fs.existsSync(CHROMIUM); } catch { return false; }
})();

// evidence/staging-walkthrough — matches the gacp-view-in-the-loop guideline
// (`evidence/<work-item>/{screenshots,trace,...}`); work-item = "staging-walkthrough".
const EVIDENCE_DIR = process.env.WALK_EVIDENCE_DIR ?? '../../evidence/staging-walkthrough';

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e-walkthrough/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20 * 60 * 1000,
  outputDir: `${EVIDENCE_DIR}/test-output`,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://staging.gacpth.com',
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === 'true',
    video: 'on',
    trace: 'on',
    // walkthrough.spec.ts takes its own full-page screenshots per step per
    // viewport (see SCREENSHOT_DIR there) — the automatic per-test screenshot
    // would just duplicate that at a different path, so it stays off.
    screenshot: 'off',
    ...(hasPinnedChromium ? { launchOptions: { executablePath: CHROMIUM } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
