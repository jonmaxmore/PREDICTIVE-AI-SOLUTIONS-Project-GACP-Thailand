/**
 * Run-config for the G4 REAL-JOURNEY walk (`e2e-g4/`).
 *
 * Goal: GOALS.md §G4. Two farmers are walked end to end through the doors a real
 * applicant and real officers press — register → wizard → submit → pay → document
 * review → pay → on-site audit → certificate → plots → planting → harvest → lots.
 *
 * Deliberately separate from playwright.phase0.config.ts: that suite proves the
 * Phase-0 pipe on ONE application and owns evidence/phase0. This one owns
 * evidence/g4-rebuild-2026-08-25 and must never overwrite Phase-0's artefacts.
 *
 * video + trace are 'on' for EVERY test: G4.0 rule 4 requires an inspector to
 * believe the walk from the pictures without reading code.
 *
 * `workers: 1` / `fullyParallel: false` is load-bearing:
 *   - the login rate-limiter is 50 requests / 15 min / IP;
 *   - the two farmers share one Supabase session pooler, and the submit endpoint
 *     is already known to fail under concurrent pooler pressure
 *     (evidence/phase0 FINDINGS F-SUBMIT-500-FLAKY);
 *   - the specs run in a fixed order and hand state to each other through VARS.
 *
 * Usage (stack must be up first):
 *   backend  :8000  cd apps/backend && NODE_ENV=development PORT=8000 node server.js
 *   frontend :3000  cd apps/web-app && BACKEND_URL=http://localhost:8000 \
 *                     INTERNAL_API_URL=http://localhost:8000 npx next dev -p 3000
 *   webhook         stripe listen --forward-to localhost:8000/api/webhooks/stripe
 *                   (its signing secret MUST equal STRIPE_WEBHOOK_SECRET in .env —
 *                    the webhook is the ONLY path that settles a payment gate)
 *   npx playwright test --config=playwright.g4.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const EVIDENCE = process.env.G4_EVIDENCE_DIR ?? '../../evidence/g4-rebuild-2026-08-25';

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e-g4/**/*.spec.ts'],
  timeout: 30 * 60 * 1000,
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
    // `next dev` compiles each route on first hit; a cold compile routinely exceeds
    // the 30s default (evidence/phase0/red-1-cold-compile).
    navigationTimeout: 200_000,
    actionTimeout: 60_000,
    // The farm step can capture coordinates from the device (farm-info-step.tsx:304).
    // Granting geolocation lets the applicant press the real "use my location"
    // button instead of typing coordinates a real farmer would not type.
    permissions: ['geolocation'],
    geolocation: { latitude: 18.796143, longitude: 98.953608 }, // เมือง เชียงใหม่
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
