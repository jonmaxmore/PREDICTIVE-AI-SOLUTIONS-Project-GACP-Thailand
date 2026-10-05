/**
 * ============================================================================
 * Playwright Fixtures — W1-C: ACCOUNT_DTAM + ACCOUNT_PLATFORM dual-flow
 * ============================================================================
 * Helpers for the finance-one-view-journey.spec.ts spec. Per RFC §W1-C and
 * I-004 file boundary discipline, these helpers live in a NEW file —
 * `fixtures.ts` is NOT touched (byte-checksum unchanged).
 *
 * What this file ships:
 *   - DTAM_PENDING_SLIPS / PLATFORM_PENDING_SLIPS — canonical mock rows
 *     for the slip-review queue, side-segregated. STATE_FEE serviceType
 *     classifies as DTAM; PLATFORM_FEE + SUBSCRIPTION* classify as
 *     PLATFORM (the backend classifier services/finance/invoice-side.js).
 *
 *   - DTAM_RECEIPTS / PLATFORM_RECEIPTS — mock rows for the /provider/receipts
 *     page. Both sides are included and both finance roles must see both rows
 *     (the per-role receipts filter was removed 2026-09-27).
 *
 *   - accountDtamMocks(page) — wires the full /api/** surface a DTAM
 *     reviewer touches: slip-queue summary (DTAM-only), pending slips
 *     (DTAM-only), receipts pending (BOTH sides — the receipts page shows
 *     both rows to both finance roles; no per-role filter since 2026-09-27).
 *
 *   - accountPlatformMocks(page) — same surface for PLATFORM reviewer.
 *
 *   - crossSideRejectAttemptMocks(page) — wires a deliberate cross-side
 *     reject attempt so the V4 RB-1 / TM-1 surface (`/api/payments/slip
 *     /:id/reject` returning 403 with `INVALID_REVIEWER_SIDE` code) can
 *     be exercised end-to-end. The frontend never opens this URL in
 *     normal flow — the test drives `apiClient`-shaped POST directly to
 *     prove the route enforces side segregation.
 *
 *   - expectLiveBackend() — sentinel for the dual-mode contract. Returns
 *     true when E2E_LIVE_BACKEND=1, so the spec can `test.skip` mock-
 *     only assertions during live-backend smoke runs.
 *
 * I-002 compliance: every unused destructure / catch is prefixed with `_`.
 * I-004 compliance: this file is the ONLY new helper file W1-C ships;
 * `fixtures.ts` is read-only for W1-C (loginAsAccountDtam +
 * loginAsAccountPlatform imported as-is).
 *
 * SMOKE-MODE: gate at T-3
 * DUAL-MODE: mock (default) + E2E_LIVE_BACKEND=1
 */

import type { Page, Route } from '@playwright/test';
import { installMockAssetRoutes } from './fixtures/mock-assets';

// ────────────────────────────────────────────────────────────────────────────
// Sentinel — dual-mode toggle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the spec should target a live backend (Docker
 * compose / smoke env) instead of the mock layer. Set by ops at T-3
 * per cutover-checklist §3 T-3.
 */
export function expectLiveBackend(): boolean {
    return process.env.E2E_LIVE_BACKEND === '1';
}

// ────────────────────────────────────────────────────────────────────────────
// Provider-token cookie helper (server-side middleware gate)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The Next.js middleware at `apps/web-app/src/middleware.ts:171` reads
 * `provider_token` (cookie) to gate `/provider/**` and `/admin/**` routes.
 * Existing `loginAsAccountDtam` / `loginAsAccountPlatform` fixtures in
 * `fixtures.ts` only seed localStorage `auth_token` + `auth_user` — they
 * do NOT set the server-visible `provider_token` cookie. Per I-004 file
 * boundary discipline (W1-C must not modify `fixtures.ts`; byte-checksum
 * pinned), this helper layers the cookie on TOP of the existing login
 * fixture so the middleware admits the page.
 *
 * The token encodes `{ role, sub, exp }` as a JWT-shaped string (HS256
 * header + base64 payload + dummy signature) because
 * `decodeProviderRoleFromToken` in the middleware only base64-decodes the
 * payload — signature is verified server-side via the backend API, not in
 * the middleware. This mirrors the existing `makeFakeJwt()` pattern in
 * `fixtures.ts` line 145.
 *
 * Must be called AFTER the role-specific login fixture (so the localStorage
 * + auth state is also set) AND BEFORE the first `page.goto()` so the
 * cookie is in the very first request the middleware sees.
 */
export async function seedProviderTokenCookie(
    page: Page,
    role: 'ACCOUNT_DTAM' | 'ACCOUNT_PLATFORM',
    overrides: { sub?: string; baseURL?: string } = {},
): Promise<void> {
    if (expectLiveBackend()) return;

    const sub = overrides.sub
        ?? (role === 'ACCOUNT_DTAM' ? 'dtam-account-iter23' : 'platform-account-iter26');

    const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
        JSON.stringify({
            sub,
            role,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 60 * 60,
        }),
    ).toString('base64url');
    const token = `${header}.${payload}.signature-not-verified-middleware-side`;

    // Use a URL with the page's baseURL so the cookie is bound to the
    // origin Playwright is testing. If page.url() is still about:blank,
    // fall back to the explicit baseURL (Playwright's first goto() will
    // then carry the cookie regardless of port).
    const url = overrides.baseURL
        ?? (page.url() && page.url() !== 'about:blank'
            ? page.url()
            : (process.env.E2E_BASE_URL || 'http://localhost'));

    await page.context().addCookies([
        {
            name: 'provider_token',
            value: token,
            url,
        },
    ]).catch(() => {
        // ignore — non-fatal; the page-load may still surface the cookie
        // via initScript or test-time injection
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Canonical IDs — kept short so failure messages stay readable
// ────────────────────────────────────────────────────────────────────────────

export const DTAM_APP_ID = 'app-w1c-dtam-001';
export const PLATFORM_APP_ID = 'app-w1c-plat-001';

export const DTAM_INVOICE_ID = 'inv-w1c-dtam-001';
export const PLATFORM_INVOICE_ID = 'inv-w1c-plat-001';
export const SUBSCRIPTION_INVOICE_ID = 'inv-w1c-sub-001';

export const DTAM_SLIP_ID = 'slip-w1c-dtam-001';
export const PLATFORM_SLIP_ID = 'slip-w1c-plat-001';

export const DTAM_RECEIPT_INVOICE_ID = 'rcpt-w1c-dtam-001';
export const PLATFORM_RECEIPT_INVOICE_ID = 'rcpt-w1c-plat-001';

// ────────────────────────────────────────────────────────────────────────────
// Side-segregated pending slips (slip-review queue payload)
// ────────────────────────────────────────────────────────────────────────────

/**
 * DTAM-only pending slips — STATE_FEE serviceType (legacy slip-flow fixture;
 * the slip flow itself is retired).
 */
export const DTAM_PENDING_SLIPS = [
    {
        id: DTAM_SLIP_ID,
        applicationId: DTAM_APP_ID,
        invoiceId: DTAM_INVOICE_ID,
        phase: 'PHASE_1',
        status: 'PENDING_REVIEW',
        fileUrl: '/mock/slip-dtam.png',
        fileMimeType: 'image/png',
        fileSizeBytes: 1024,
        bankRef: 'TRX-W1C-DTAM-001',
        transferredAt: '2026-05-17T08:00:00.000Z',
        amountClaimed: 5000,
        uploadedBy: 'health-w1c-001',
        uploadedAt: '2026-05-17T08:30:00.000Z',
        application: {
            id: DTAM_APP_ID,
            applicationNumber: 'APP-2026-W1C-001',
            healthId: '1100800000123',
            status: 'PAYMENT_PENDING',
        },
        invoice: {
            id: DTAM_INVOICE_ID,
            invoiceNumber: 'INV-PH1-STATE-2026-00001',
            totalAmount: 5000,
            serviceType: 'PHASE_1_STATE_FEE',
        },
    },
];

/**
 * PLATFORM-only pending slips — includes BOTH a PLATFORM_FEE row AND a
 * SUBSCRIPTION_MONTHLY row, exercising the canonical contract that
 * subscriptions default to PLATFORM (DTAM does not sell subscriptions).
 */
export const PLATFORM_PENDING_SLIPS = [
    {
        id: PLATFORM_SLIP_ID,
        applicationId: PLATFORM_APP_ID,
        invoiceId: PLATFORM_INVOICE_ID,
        phase: 'PHASE_1',
        status: 'PENDING_REVIEW',
        fileUrl: '/mock/slip-plat.png',
        fileMimeType: 'image/png',
        fileSizeBytes: 1024,
        bankRef: 'TRX-W1C-PLAT-001',
        transferredAt: '2026-05-17T09:00:00.000Z',
        amountClaimed: 535,
        uploadedBy: 'health-w1c-002',
        uploadedAt: '2026-05-17T09:30:00.000Z',
        application: {
            id: PLATFORM_APP_ID,
            applicationNumber: 'APP-2026-W1C-002',
            healthId: '1100800000456',
            status: 'PAYMENT_PENDING',
        },
        invoice: {
            id: PLATFORM_INVOICE_ID,
            invoiceNumber: 'INV-PH1-PLAT-2026-00001',
            totalAmount: 535,
            serviceType: 'PHASE_1_PLATFORM_FEE',
        },
    },
    {
        id: 'slip-w1c-sub-001',
        applicationId: PLATFORM_APP_ID,
        invoiceId: SUBSCRIPTION_INVOICE_ID,
        phase: 'SUBSCRIPTION',
        status: 'PENDING_REVIEW',
        fileUrl: '/mock/slip-sub.png',
        fileMimeType: 'image/png',
        fileSizeBytes: 1024,
        bankRef: 'TRX-W1C-SUB-001',
        transferredAt: '2026-05-17T10:00:00.000Z',
        amountClaimed: 1500,
        uploadedBy: 'health-w1c-002',
        uploadedAt: '2026-05-17T10:30:00.000Z',
        application: {
            id: PLATFORM_APP_ID,
            applicationNumber: 'APP-2026-W1C-002',
            healthId: '1100800000456',
            status: 'PAYMENT_PENDING',
        },
        invoice: {
            id: SUBSCRIPTION_INVOICE_ID,
            invoiceNumber: 'INV-SUB-2026-00001',
            totalAmount: 1500,
            serviceType: 'SUBSCRIPTION_MONTHLY',
        },
    },
];

// ────────────────────────────────────────────────────────────────────────────
// Receipts page payload (V6-A — receipts page filters by side client-side)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Receipts pending list shipped by the backend for BOTH sides. The
 * /provider/receipts page receives both — and since 2026-09-27
 * that BOTH finance roles see both rows (the per-role receipts filter was
 * removed 2026-09-27 — operator 2026-09-11 "finance ต้องเห็นเหมือนกัน").
 */
export const DTAM_RECEIPT_ROW = {
    id: DTAM_RECEIPT_INVOICE_ID,
    invoiceNumber: 'INV-PH1-STATE-2026-00010',
    applicationNumber: 'APP-2026-W1C-010',
    applicantName: 'มานพ ทดสอบรัฐ',
    totalAmount: 5000,
    paidAt: '2026-05-17T05:00:00.000Z',
    serviceType: 'PHASE_1_STATE_FEE',
};

export const PLATFORM_RECEIPT_ROW = {
    id: PLATFORM_RECEIPT_INVOICE_ID,
    invoiceNumber: 'INV-PH1-PLAT-2026-00010',
    applicationNumber: 'APP-2026-W1C-011',
    applicantName: 'สุภาพ ทดสอบบริษัท',
    totalAmount: 535,
    paidAt: '2026-05-17T05:30:00.000Z',
    serviceType: 'PHASE_1_PLATFORM_FEE',
};

/**
 * Combined backend response — receipts page always receives BOTH sides
 * from the backend route, and both finance roles render both rows.
 */
export const COMBINED_RECEIPTS_RESPONSE = {
    success: true,
    data: {
        invoices: [DTAM_RECEIPT_ROW, PLATFORM_RECEIPT_ROW],
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Side-segregated slip-queue summary payloads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Slip-queue summary returned by the DTAM-side backend slice. Per
 * V4-B UX-D4 contract, `visibleSide: 'DTAM'` is included so the
 * SlipQueueSummaryCards component renders only Wallet A. Backend zeros
 * out platformRevenue (info-hiding) — the W1-C spec verifies the UI
 * never accidentally exposes a zero-platform number to a DTAM reviewer
 * (would mislead them about platform's intake).
 */
export const DTAM_SLIP_QUEUE_SUMMARY = {
    success: true,
    data: {
        pending: { total: 1, overSla: 0, slaHours: 24 },
        today: { approved: 0, rejected: 0 },
        monthly: {
            slipsApproved: 5,
            stateRevenue: 25000,
            platformRevenue: 0,
            totalRevenue: 25000,
            currency: 'THB',
        },
        visibleSide: 'DTAM',
    },
};

/**
 * Slip-queue summary returned by the PLATFORM-side backend slice. Same
 * pattern as DTAM but with the wallets swapped — stateRevenue zeroed,
 * platformRevenue populated.
 */
export const PLATFORM_SLIP_QUEUE_SUMMARY = {
    success: true,
    data: {
        pending: { total: 2, overSla: 0, slaHours: 24 },
        today: { approved: 0, rejected: 0 },
        monthly: {
            slipsApproved: 7,
            stateRevenue: 0,
            platformRevenue: 36245,
            totalRevenue: 36245,
            currency: 'THB',
        },
        visibleSide: 'PLATFORM',
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Empty defaults — kept for the misc endpoints the dashboard touches
// ────────────────────────────────────────────────────────────────────────────

const EMPTY_INVOICES_LIST = {
    success: true,
    data: { invoices: [] },
};

const EMPTY_EXCEPTIONS_LIST = {
    success: true,
    data: { exceptions: [] },
};

const EMPTY_PAYMENT_SUMMARY = {
    success: true,
    data: {
        totalRevenue: 0,
        pendingAmount: 0,
        overdueAmount: 0,
        monthlyRevenue: 0,
        invoiceCount: { paid: 0, pending: 0, overdue: 0 },
    },
};

const EMPTY_REVENUE_SUMMARY = {
    success: true,
    data: {
        platformRevenue: 0,
        stateRevenue: 0,
        totalRevenue: 0,
    },
};

const EMPTY_SUBSCRIPTIONS_LIST = {
    success: true,
    data: [],
};

// ────────────────────────────────────────────────────────────────────────────
// Mock wiring — DTAM side
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wire the full DTAM-reviewer mock surface. Idempotent — caller may
 * call once per test. In live mode (`expectLiveBackend()` true) this is
 * a no-op so the real backend serves the data.
 */
export async function accountDtamMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;

    // Slip-queue summary — DTAM-only (Wallet B hidden via visibleSide).
    await page.route('**/api/finance/accounting/slip-queue-summary**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(DTAM_SLIP_QUEUE_SUMMARY),
        });
    });

    // Pending slips — DTAM-only. Backend filters by reviewer role; the
    // mock pre-filters so the UI receives only what it would have seen.
    await page.route('**/api/payments/slip/pending**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: DTAM_PENDING_SLIPS }),
        });
    });

    // Receipts pending — backend returns BOTH sides to both finance roles.
    await page.route('**/api/invoices/receipts/pending**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(COMBINED_RECEIPTS_RESPONSE),
        });
    });

    // Approve mock — returns the approved slip with status updated.
    await page.route(`**/api/payments/slip/${DTAM_SLIP_ID}/approve`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    ...DTAM_PENDING_SLIPS[0],
                    status: 'APPROVED',
                    amountVerified: 5000,
                    reviewedBy: 'dtam-account-iter23',
                    reviewedAt: '2026-05-17T11:00:00.000Z',
                },
            }),
        });
    });

    await wireSharedAccountMocks(page);
}

// ────────────────────────────────────────────────────────────────────────────
// Mock wiring — PLATFORM side
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wire the full PLATFORM-reviewer mock surface. Same structure as
 * `accountDtamMocks` but with the slip queue + summary slewed to the
 * platform side.
 */
export async function accountPlatformMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;

    await page.route('**/api/finance/accounting/slip-queue-summary**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(PLATFORM_SLIP_QUEUE_SUMMARY),
        });
    });

    await page.route('**/api/payments/slip/pending**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: PLATFORM_PENDING_SLIPS }),
        });
    });

    await page.route('**/api/invoices/receipts/pending**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(COMBINED_RECEIPTS_RESPONSE),
        });
    });

    await page.route(`**/api/payments/slip/${PLATFORM_SLIP_ID}/approve`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    ...PLATFORM_PENDING_SLIPS[0],
                    status: 'APPROVED',
                    amountVerified: 535,
                    reviewedBy: 'platform-account-iter26',
                    reviewedAt: '2026-05-17T11:30:00.000Z',
                },
            }),
        });
    });

    await wireSharedAccountMocks(page);
}

// ────────────────────────────────────────────────────────────────────────────
// Cross-side reject attempt (V4 RB-1 / TM-1 surface)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wire a deliberate cross-side reject failure. The spec drives a fetch
 * POST to `/api/payments/slip/<opposite-side-slip>/reject` as the
 * logged-in reviewer; the backend (V4 RB-1) returns 403 with
 * `INVALID_REVIEWER_SIDE` error code.
 *
 * The mock recreates the backend's error envelope so the test can pin
 * the contract end-to-end (status + body shape) without depending on a
 * live backend connection.
 */
export async function crossSideRejectAttemptMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;

    // ACCOUNT_DTAM attempting to reject a PLATFORM slip → 403.
    await page.route(`**/api/payments/slip/${PLATFORM_SLIP_ID}/reject`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
                success: false,
                error: {
                    code: 'INVALID_REVIEWER_SIDE',
                    messageTH:
                        'คุณไม่มีสิทธิ์ปฏิเสธสลิปฝั่งแพลตฟอร์ม (ผู้ใช้งานปัจจุบันเป็นผู้ตรวจฝั่ง DTAM)',
                    messageEN:
                        'You do not have permission to reject a PLATFORM-side slip (current user is a DTAM-side reviewer)',
                },
            }),
        });
    });

    // ACCOUNT_PLATFORM attempting to reject a DTAM slip → 403 (mirror).
    await page.route(`**/api/payments/slip/${DTAM_SLIP_ID}/reject`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
                success: false,
                error: {
                    code: 'INVALID_REVIEWER_SIDE',
                    messageTH:
                        'คุณไม่มีสิทธิ์ปฏิเสธสลิปฝั่งรัฐ (ผู้ใช้งานปัจจุบันเป็นผู้ตรวจฝั่งแพลตฟอร์ม)',
                    messageEN:
                        'You do not have permission to reject a DTAM-side slip (current user is a PLATFORM-side reviewer)',
                },
            }),
        });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — shared no-op-ish mocks for the accounting dashboard misc routes
// ────────────────────────────────────────────────────────────────────────────

async function wireSharedAccountMocks(page: Page): Promise<void> {
    const empty = async (route: Route, payload: unknown) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });
    };

    await page.route('**/api/invoices/summary**', (route) => empty(route, EMPTY_PAYMENT_SUMMARY));
    await page.route('**/api/invoices/revenue-summary**', (route) => empty(route, EMPTY_REVENUE_SUMMARY));
    await page.route('**/api/invoices**', async (route) => {
        // /api/invoices is the broader "list invoices" path — only mock
        // GETs on the exact path (not deeper paths like
        // /api/invoices/receipts/pending which are already wired).
        const url = new URL(route.request().url());
        if (url.pathname !== '/api/invoices') return route.fallback();
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(EMPTY_INVOICES_LIST),
        });
    });
    await page.route('**/api/invoices/receipts/exceptions**', (route) => empty(route, EMPTY_EXCEPTIONS_LIST));
    await page.route('**/api/subscriptions/my**', (route) => empty(route, EMPTY_SUBSCRIPTIONS_LIST));
}
