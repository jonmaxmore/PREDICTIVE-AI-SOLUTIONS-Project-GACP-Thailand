/**
 * ============================================================================
 * CHECKOUT VISUAL EVIDENCE — /health/payments/checkout (W2-03 D3)
 * ============================================================================
 * Opens the real checkout page in a real browser, clicks the real
 * "เริ่มขั้นตอนชำระเงิน" button (no page.evaluate shortcuts), asserts the Thai
 * destination copy for each mock scenario, and captures a screenshot of every
 * terminal state under evidence/W2-03/screenshots/.
 *
 * This is EVIDENCE CAPTURE of behavior D2 already shipped — a PIN, not a fix
 * (Law 3.11). It is expected to pass on the first run; a failure here means a
 * genuine D2 regression to report back, not to patch from this spec.
 *
 * Mock mode (no backend required):
 *   NEXT_PUBLIC_CHECKOUT_API_MODE=mock  → checkout-service serves fixtures
 *   after ~300ms; mockScenario selects happy / conflict / server-error /
 *   timeout. See src/lib/services/checkout-service.ts.
 *
 * Auth:
 *   /health/* is gated by src/middleware.ts, which redirects to
 *   /auth/health/login without an `auth_token` cookie and, when present,
 *   base64url-decodes the JWT payload for its role (no signature check in the
 *   edge runtime — see decodeCanonicalRoleFromToken in middleware-helpers.ts).
 *   The repo's e2e suite carries a real login via Playwright storageState, but
 *   the live backend that mints that session is not reachable in this
 *   mock-only environment. We therefore grant the SAME kind of credential the
 *   middleware reads — a health-role `auth_token` cookie — via
 *   context.addCookies(). No middleware/auth code is modified. The
 *   unauthenticated redirect is documented by the first test below so the
 *   auth gate itself is proven, not assumed.
 *
 * Run (dev server started with the two NEXT_PUBLIC_* flags, port 3000):
 *   E2E_BASE_URL=http://localhost:3000 \
 *   PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium \
 *   npx playwright test e2e/checkout-visual.spec.ts --project=chromium --no-deps
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// Repo-root evidence/W2-03/screenshots, resolved from this spec's location
// (apps/web-app/e2e → repo root is three levels up).
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../evidence/W2-03/screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Launch the operator-provisioned Chromium at /opt/pw-browsers when its path
// is supplied — the bundled Playwright revision may not match what ships
// there. Unset → Playwright's default browser resolution.
test.use(
  process.env.PW_CHROMIUM_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } }
    : {},
);

const CHECKOUT_PATH = '/health/payments/checkout';
const START_BUTTON_LABEL = 'เริ่มขั้นตอนชำระเงิน';
/**
 * F-G4-64 — the page now shows the payment-terms disclosure (Q4) and keeps the
 * start button disabled until it is ticked, so every scenario below ticks it
 * before pressing: the acknowledgment an applicant really gives is part of the
 * evidence this spec captures, not a step around it. The consent LEDGER call is
 * skipped in mock mode (client-view.tsx consentLedgerReachable), which is what
 * keeps this spec runnable with no backend at all.
 */
const TERMS_CHECKBOX = '[data-testid="checkout-terms-checkbox"]';
const RETRY_BUTTON_LABEL = 'ลองใหม่อีกครั้ง';

// Terminal-state copy — asserted verbatim against the strings D2 renders
// (src/app/health/payments/checkout/client-view.tsx).
const SUCCESS_HEADING = 'สร้างรายการสำเร็จ รอชำระเงิน';
const FAILURE_HEADING = 'สร้างรายการชำระเงินไม่สำเร็จ';
const CONFLICT_409_TEXT =
  'มีรายการชำระเงินของงวดนี้กำลังดำเนินการอยู่แล้ว กรุณาเปิดหน้าชำระเงินเดิมหรือลองใหม่อีกครั้ง';
const SERVER_ERROR_FALLBACK_TEXT =
  'ไม่สามารถสร้างรายการชำระเงินได้ กรุณาลองใหม่ภายหลัง หรือกลับไปที่หน้ารายการชำระเงิน';
const TIMEOUT_TEXT = 'เชื่อมต่อกับระบบไม่สำเร็จ กรุณากดปุ่มลองใหม่อีกครั้ง';

// The verbatim total from the HAPPY fixture (5000 + 500 + 35 → 5,535). The UI
// renders the backend number as-is; this is what the human should SEE.
const HAPPY_TOTAL_TEXT = '5,535';

/**
 * A HEALTH session cookie shaped exactly as src/middleware.ts reads it: an
 * unsigned JWT whose payload carries role:'health'. normalizeRole('health')
 * === CANONICAL_ROLES.HEALTH, so decideHealthAccess returns 'allow'.
 */
function healthAuthCookie() {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ role: 'health' })}.e2e`;
  return { name: 'auth_token', value: token, domain: 'localhost', path: '/' };
}

async function grantHealthSession(context: BrowserContext): Promise<void> {
  await context.addCookies([healthAuthCookie()]);
}

function checkoutUrl(scenario: string): string {
  const params = new URLSearchParams({ app: 'APP-E2E-001', milestone: 'M1' });
  if (scenario) {
    params.set('mockScenario', scenario);
  }
  return `${CHECKOUT_PATH}?${params.toString()}`;
}

test.describe('W2-03 D3 — checkout visual evidence', () => {
  // ── Auth gate (documented, not assumed) ──────────────────────────────────
  test('auth gate — unauthenticated checkout redirects to health login', async ({ page }) => {
    // Fresh per-test context = no session cookie.
    await page.goto(checkoutUrl('happy'));
    await expect(page).toHaveURL(/\/auth\/health\/login/);
  });

  // ── happy → created (awaiting payment) ───────────────────────────────────
  test('happy — success heading + verbatim 5,535 total', async ({ page, context }) => {
    await grantHealthSession(context);
    await page.goto(checkoutUrl('happy'));

    const startButton = page.getByRole('button', { name: START_BUTTON_LABEL });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    await page.locator(TERMS_CHECKBOX).check();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Best-effort loading capture during the ~300ms mock latency. Non-blocking:
    // if the window has already elapsed the test still proceeds to the
    // terminal-state assertions below.
    try {
      await expect(page.getByRole('status')).toBeVisible({ timeout: 250 });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'happy-loading.png') });
    } catch {
      /* loading window elapsed — terminal state captured below */
    }

    await expect(page.getByRole('heading', { name: SUCCESS_HEADING })).toBeVisible();
    await expect(page.getByText(HAPPY_TOTAL_TEXT, { exact: false })).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'happy.png'), fullPage: true });
  });

  // ── conflict → 409 Thai copy ─────────────────────────────────────────────
  test('conflict — 409 Thai in-progress message', async ({ page, context }) => {
    await grantHealthSession(context);
    await page.goto(checkoutUrl('conflict'));

    const startButton = page.getByRole('button', { name: START_BUTTON_LABEL });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    await page.locator(TERMS_CHECKBOX).check();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.getByRole('heading', { name: FAILURE_HEADING })).toBeVisible();
    await expect(page.getByText(CONFLICT_409_TEXT, { exact: false })).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'conflict.png'), fullPage: true });
  });

  // ── server-error → Thai fallback ─────────────────────────────────────────
  test('server-error — Thai fallback message', async ({ page, context }) => {
    await grantHealthSession(context);
    await page.goto(checkoutUrl('server-error'));

    const startButton = page.getByRole('button', { name: START_BUTTON_LABEL });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    await page.locator(TERMS_CHECKBOX).check();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.getByRole('heading', { name: FAILURE_HEADING })).toBeVisible();
    await expect(page.getByText(SERVER_ERROR_FALLBACK_TEXT, { exact: false })).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'server-error.png'), fullPage: true });
  });

  // ── timeout → Thai copy + retry button ───────────────────────────────────
  test('timeout — Thai timeout copy + retry button', async ({ page, context }) => {
    await grantHealthSession(context);
    await page.goto(checkoutUrl('timeout'));

    const startButton = page.getByRole('button', { name: START_BUTTON_LABEL });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    await page.locator(TERMS_CHECKBOX).check();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.getByRole('heading', { name: FAILURE_HEADING })).toBeVisible();
    await expect(page.getByText(TIMEOUT_TEXT, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: RETRY_BUTTON_LABEL })).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'timeout.png'), fullPage: true });
  });
});
