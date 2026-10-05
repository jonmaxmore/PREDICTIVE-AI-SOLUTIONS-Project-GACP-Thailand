/**
 * Run-config for the PHASE 0 FLOW-PROOF suite (`e2e-phase0/`).
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 2.2, D-P4).
 * Separate from playwright.config.ts (testMatch `e2e/**` + `playwright/**`),
 * playwright.demo.config.ts and playwright.walkthrough.config.ts — this suite is
 * matched by none of them, so it never runs as part of `pnpm test:e2e` / CI.
 *
 * video + trace are 'on' for EVERY test by design: Phase 0 is an evidence-capture
 * run (checkpoint protocol §II needs screen proof next to the DB dump), not a
 * pass/fail gate. Playwright has no `--video` CLI flag, which is why this lives
 * in a config file at all (D-P4).
 *
 * `workers: 1` / `fullyParallel: false` is load-bearing: the scenarios share one
 * application row and run in a fixed order, and the login rate-limiter is
 * 50 requests / 15 min / IP.
 *
 * Usage (stack must be up first — Task 1):
 *   npx playwright test --config=playwright.phase0.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
// แบบอย่าง: playwright.walkthrough.config.ts (video+trace เต็ม, workers:1 — login rate-limit 50/15นาที/IP)
const EVIDENCE = process.env.PHASE0_EVIDENCE_DIR ?? '../../evidence/phase0';
export default defineConfig({
  testDir: '.',
  testMatch: ['e2e-phase0/**/*.spec.ts'],
  timeout: 20 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: `${EVIDENCE}/playwright-report`, open: 'never' }]],
  outputDir: `${EVIDENCE}/test-output`,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    video: 'on',
    trace: 'on',
    screenshot: 'off',
    // Amendment B: frontend runs `next dev` (production build blocked on Windows by
    // output:standalone symlinks), which compiles each route on first hit — give
    // navigation room to wait through a cold compile instead of the 30s default.
    navigationTimeout: 200_000,
    actionTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
