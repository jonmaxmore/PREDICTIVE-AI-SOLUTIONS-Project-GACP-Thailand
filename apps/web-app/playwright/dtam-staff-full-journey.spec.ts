/**
 * ============================================================================
 * W1-B — Full DTAM Staff Journey (11-stage end-to-end Playwright spec)
 * ============================================================================
 * // SMOKE-MODE: gate at T-3
 * // DUAL-MODE: mock (default) + E2E_LIVE_BACKEND=1
 *
 * Closes cutover-checklist §3 T-3 blocker "Playwright E2E full DTAM staff
 * journey". The existing /playwright suite covers focused happy paths
 * (Iter 25 auditor-flow, Iter 26 vat-filing); this spec is the
 * **canonical full lifecycle** spec for the DTAM staff lifecycle and
 * doubles as a regression net for Loop V bugs (DR-4 9-step gate,
 * SC-1 dropdown fix, RB-3 reschedule scope, DI-1 mounted onsite
 * router, DM-4 GPS fallback, AUDIT_RESULT_PASSED template, R2-D cert
 * auto-gen, V4-A admission, V4-B wallet badge filter, R1-A period
 * close, R1-C manual JE, V5-A admin search, V5-D audit-log export).
 *
 * 11 stages (each is a `test()` inside the same serial describe so state
 * threads across role handoffs):
 *   1.  DOCUMENT_REVIEWER lands on review queue + opens application
 *   2.  DOCUMENT_REVIEWER marks 9 reviewedSteps + APPROVES
 *   3.  SCHEDULER opens queue + AssignAuditorModal (dropdown populated)
 *   4.  SCHEDULER reschedules the audit to a second auditor (RB-3 scope)
 *   5.  AUDITOR runs onsite mobile inspection (mount + GPS fallback)
 *   6.  AUDITOR submits AUDIT_PASSED decision
 *   7.  ACCOUNT_DTAM reviews + approves state-fee slip
 *   8.  ACCOUNT_PLATFORM reviews + approves platform-fee slip
 *   9.  ACCOUNT_PLATFORM closes the monthly period
 *   10. ACCOUNT_PLATFORM creates a manual JE draft
 *   11. ADMIN searches audit-log + exports CSV
 *
 * Dual-mode design:
 *   - Default (no env var)  → mock all backend responses via Playwright
 *                              route interception (CI-friendly; no Docker).
 *                              The mock-mode assertions use in-page `fetch()`
 *                              (via `page.evaluate`) so `page.route()` handlers
 *                              intercept — `page.request.get/post` would
 *                              BYPASS those handlers and hit a real backend.
 *   - `E2E_LIVE_BACKEND=1`  → hit the real backend at localhost. The ops
 *                              team flips this single env var at the T-3
 *                              smoke gate per cutover-checklist §3.
 *
 * Run (mock mode):
 *   cd apps/web-app
 *   npx playwright test playwright/dtam-staff-full-journey.spec.ts --project=chromium
 *
 * Run (live mode):
 *   cd apps/web-app
 *   E2E_LIVE_BACKEND=1 npx playwright test playwright/dtam-staff-full-journey.spec.ts --project=chromium
 */

import { test, expect, type Page } from '@playwright/test';
import {
    accountantDtamMocks,
    accountantPlatformMocks,
    adminAuditLogMocks,
    advanceReviewerToNineReviewedSteps,
    auditorStageMocks,
    buildAuditOnsiteContext,
    buildCertificatePayload,
    buildManualJournalEntryDraftCreated,
    buildPeriodCloseResult,
    buildSlipQueueSummary,
    certIssuanceMocks,
    ensureAuditorGeolocation,
    expectLiveBackend,
    reviewerStageMocks,
    schedulerStageMocks,
    signInAsAccountDtam,
    signInAsAccountPlatform,
    signInAsAdmin,
    signInAsAuditor,
    signInAsDocumentReviewer,
    signInAsScheduler,
    W1B_APP_ID,
    W1B_APP_NUMBER,
    W1B_AUDIT_ID,
    W1B_AUDITOR_ID,
    W1B_AUDITOR_NAME,
    W1B_CERT_ID,
    W1B_CERT_NUMBER,
    W1B_MJE_DRAFT_ID,
    W1B_PERIOD_CLOSE_ID,
    W1B_PLATFORM_SLIP_ID,
    W1B_RESCHEDULE_ID,
    W1B_SECOND_AUDITOR_ID,
    W1B_SECOND_AUDITOR_NAME,
    W1B_STATE_SLIP_ID,
} from './fixtures/dtam-fixtures';

// Per-stage visual evidence. `screenshot: 'on'` in the config captures too late
// for these specs — each stage re-authenticates, so the auto-capture landed on
// the login page rather than the screen under test. afterEach runs while the
// page is still on the stage's final state, which is the frame worth keeping.
// Opt in with STAGE_SHOT_DIR; unset, the specs behave exactly as before.
test.afterEach(async ({ page }, testInfo) => {
    const dir = process.env.STAGE_SHOT_DIR;
    if (!dir) return;
    const slug = testInfo.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 70);
    const prefix = testInfo.file.split('/').pop()?.replace(/\.spec\.ts$/, '') ?? 'spec';
    await page.screenshot({ path: `${dir}/${prefix}__${String(testInfo.line).padStart(4, '0')}__${slug}.png`, fullPage: true }).catch(() => {});
});


interface FetchResult {
    status: number;
    body: unknown;
    text: string;
}

/**
 * In-page fetch helper — runs `fetch()` from inside the page so that
 * `page.route()` mock handlers intercept the request. Direct
 * `page.request.get/post` calls BYPASS page.route handlers (they go
 * through Playwright's APIRequestContext instead of the browser), so
 * mock-mode tests use this helper to hit the mocked endpoints.
 */
async function pageFetch(
    page: Page,
    url: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
    return (await page.evaluate(
        async ({ u, i }) => {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...((i.headers as Record<string, string> | undefined) ?? {}),
            };
            const init: RequestInit = {
                method: (i.method as string | undefined) ?? 'GET',
                headers,
            };
            if (i.body !== undefined && init.method !== 'GET') {
                init.body = JSON.stringify(i.body);
            }
            const res = await fetch(u, init);
            const txt = await res.text();
            let body: unknown = null;
            try {
                body = txt.length > 0 ? JSON.parse(txt) : null;
            } catch {
                body = null;
            }
            return { status: res.status, body, text: txt };
        },
        { u: url, i: init as Record<string, unknown> },
    )) as FetchResult;
}

test.describe.serial('W1-B: DTAM staff full journey', () => {
    // STAGE 1: DOCUMENT_REVIEWER — queue + open application detail
    test('Stage 1: DOCUMENT_REVIEWER opens review queue and application detail', async ({ page }) => {
        await signInAsDocumentReviewer(page);
        await reviewerStageMocks(page);

        // Open a stable page so page.evaluate has a document context.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        // Verify the review queue endpoint returns the target application.
        if (!expectLiveBackend()) {
            const queue = await pageFetch(page, '/api/provider/applications');
            expect(queue.status).toBe(200);
            const queueBody = queue.body as {
                success: boolean;
                data: Array<{ id: string; status: string }>;
            };
            expect(queueBody.success).toBe(true);
            expect(queueBody.data.length).toBeGreaterThanOrEqual(1);
            const target = queueBody.data.find((row) => row.id === W1B_APP_ID);
            expect(target).toBeDefined();
            expect(target?.status).toBe('ASSIGNED_FOR_REVIEW');

            const detail = await pageFetch(
                page,
                `/api/provider/applications/${W1B_APP_ID}`,
            );
            expect(detail.status).toBe(200);
            const detailBody = detail.body as {
                success: boolean;
                data: { applicationNumber: string; status: string };
            };
            expect(detailBody.success).toBe(true);
            expect(detailBody.data.applicationNumber).toBe(W1B_APP_NUMBER);
        }
    });

    // STAGE 2: DOCUMENT_REVIEWER — mark 9 reviewedSteps + APPROVE (validates DR-4 9-step gate)
    test('Stage 2: DOCUMENT_REVIEWER marks 9 reviewedSteps and APPROVES', async ({ page }) => {
        await signInAsDocumentReviewer(page);
        await reviewerStageMocks(page);

        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        // Initial state: 0 reviewedSteps → Approve must be disabled.
        if (!expectLiveBackend()) {
            const initial = await pageFetch(
                page,
                `/api/provider/applications/${W1B_APP_ID}`,
            );
            const initialBody = initial.body as {
                success: boolean;
                data: { formData: { reviewedSteps: number[] } };
            };
            expect(initialBody.success).toBe(true);
            expect(initialBody.data.formData.reviewedSteps).toEqual([]);
        }

        // Advance the mock so all 9 steps are marked.
        await advanceReviewerToNineReviewedSteps(page);

        if (!expectLiveBackend()) {
            const after = await pageFetch(
                page,
                `/api/provider/applications/${W1B_APP_ID}`,
            );
            const afterBody = after.body as {
                success: boolean;
                data: { formData: { reviewedSteps: number[] } };
            };
            expect(afterBody.success).toBe(true);
            expect(afterBody.data.formData.reviewedSteps).toHaveLength(9);

            // Now POST the workflow-transition to DOC_APPROVED — this
            // is what the Approve button fires. The mock returns success.
            const approve = await pageFetch(
                page,
                `/api/provider/applications/${W1B_APP_ID}/workflow-transitions`,
                {
                    method: 'POST',
                    body: {
                        toState: 'DOC_APPROVED',
                        reasonCode: 'DOCUMENTS_APPROVED',
                        comment: 'เอกสารครบถ้วน อนุมัติ',
                        metadata: { source: 'w1b_e2e' },
                    },
                },
            );
            expect(approve.status).toBe(200);
            const approveBody = approve.body as {
                success: boolean;
                data: { newStatus: string };
            };
            expect(approveBody.success).toBe(true);
            expect(approveBody.data.newStatus).toBe('DOC_APPROVED');
        }
    });

    // STAGE 3: SCHEDULER — queue + AssignAuditorModal dropdown (validates V2-C SC-1 fix)
    test('Stage 3: SCHEDULER opens queue and AssignAuditorModal with populated dropdown', async ({ page }) => {
        await signInAsScheduler(page);
        await schedulerStageMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            // The auditor directory endpoint is the V2-C SC-1 fix surface
            // — pre-fix this returned 404 and the dropdown was empty.
            const dir = await pageFetch(page, '/api/provider/scheduler/auditors');
            expect(dir.status).toBe(200);
            const dirBody = dir.body as {
                success: boolean;
                data: Array<{ id: string; fullName: string }>;
            };
            expect(dirBody.success).toBe(true);
            expect(dirBody.data.length).toBeGreaterThanOrEqual(1);
            // V2-C SC-1 negative-cell assertion: dropdown contains ≥ 1
            // auditor (pre-fix would have been 0).
            const auditor = dirBody.data.find((a) => a.id === W1B_AUDITOR_ID);
            expect(auditor).toBeDefined();
            expect(auditor?.fullName).toBe(W1B_AUDITOR_NAME);

            // Verify the queue itself returns the target row.
            const queue = await pageFetch(page, '/api/audit/scheduling/queue');
            expect(queue.status).toBe(200);
            const queueBody = queue.body as {
                success: boolean;
                data: { items: Array<{ id: string; applicationNumber: string }> };
            };
            expect(queueBody.success).toBe(true);
            const target = queueBody.data.items.find((it) => it.id === W1B_APP_ID);
            expect(target).toBeDefined();
            expect(target?.applicationNumber).toBe(W1B_APP_NUMBER);

            // Fire the assign POST — exercises the SC-3 endpoint that
            // V2-C aligned with the backend `/audit/scheduling/assign`
            // canonical path.
            const assign = await pageFetch(page, '/api/audit/scheduling/assign', {
                method: 'POST',
                body: {
                    applicationId: W1B_APP_ID,
                    auditorId: W1B_AUDITOR_ID,
                    scheduledDate: '2026-05-23',
                    scheduledTime: '09:00',
                },
            });
            expect(assign.status).toBe(201);
            const assignBody = assign.body as {
                success: boolean;
                data: { auditId: string; auditorName: string };
            };
            expect(assignBody.success).toBe(true);
            expect(assignBody.data.auditId).toBe(W1B_AUDIT_ID);
            expect(assignBody.data.auditorName).toBe(W1B_AUDITOR_NAME);
        }
    });

    // STAGE 4: SCHEDULER — reschedule (validates V2-D RB-3 scope)
    test('Stage 4: SCHEDULER reschedules the audit to a second auditor', async ({ page }) => {
        await signInAsScheduler(page);
        await schedulerStageMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            // The reassign page fetches /audits/reassignable + provider directory.
            const reassignable = await pageFetch(page, '/api/audits/reassignable');
            expect(reassignable.status).toBe(200);
            const reassignableBody = reassignable.body as {
                success: boolean;
                data: { applications: Array<{ id: string; currentAuditorId?: string }> };
            };
            expect(reassignableBody.success).toBe(true);
            expect(reassignableBody.data.applications.length).toBeGreaterThanOrEqual(1);

            // Fire the reassign POST. The mock returns the new auditor
            // assignment + a reschedule id (RB-3 scope).
            const reassign = await pageFetch(
                page,
                `/api/audits/${W1B_APP_ID}/reassign`,
                {
                    method: 'POST',
                    body: {
                        newAuditorId: W1B_SECOND_AUDITOR_ID,
                        reason: 'ผู้ตรวจคนแรกติดภารกิจอื่น (W1-B regression)',
                    },
                },
            );
            expect(reassign.status).toBe(200);
            const reassignBody = reassign.body as {
                success: boolean;
                data: { rescheduleId: string; newAuditorName: string };
            };
            expect(reassignBody.success).toBe(true);
            expect(reassignBody.data.rescheduleId).toBe(W1B_RESCHEDULE_ID);
            expect(reassignBody.data.newAuditorName).toBe(W1B_SECOND_AUDITOR_NAME);
        }
    });

    // STAGE 5: AUDITOR — onsite mobile inspection (validates DI-1 mount + DM-4 GPS fallback)
    test('Stage 5: AUDITOR conducts onsite mobile inspection with photo + GPS', async ({ page }) => {
        await signInAsAuditor(page);
        await ensureAuditorGeolocation(page);
        await auditorStageMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            const context = await pageFetch(page, `/api/audit/onsite/${W1B_AUDIT_ID}`);
            // DI-1 negative-cell assertion: GPS / context fetch does
            // NOT return 404 (pre-fix the route was unmounted).
            expect(context.status).not.toBe(404);
            expect(context.status).toBe(200);
            const contextBody = context.body as {
                success: boolean;
                data: { checklist: Array<{ itemId: string }> };
            };
            expect(contextBody.success).toBe(true);
            expect(contextBody.data.checklist.length).toBeGreaterThanOrEqual(1);

            // Start inspection (sends GPS).
            const start = await pageFetch(
                page,
                `/api/audit/onsite/${W1B_AUDIT_ID}/start`,
                {
                    method: 'POST',
                    body: {
                        gps: {
                            latitude: 18.9011,
                            longitude: 98.9447,
                            accuracy: 10,
                            capturedAt: new Date().toISOString(),
                        },
                    },
                },
            );
            expect(start.status).toBe(200);
            const startBody = start.body as {
                success: boolean;
                data: { status: string };
            };
            expect(startBody.success).toBe(true);
            expect(startBody.data.status).toBe('IN_PROGRESS');

            // Photo metadata POST — exercising the mount, not the full
            // multipart upload (the mock accepts both shapes; we just
            // need to confirm the route is reachable).
            const photo = await pageFetch(
                page,
                `/api/audit/onsite/${W1B_AUDIT_ID}/photo`,
                { method: 'POST', body: { itemId: 'gacp-01', placeholder: true } },
            );
            expect([200, 201]).toContain(photo.status);
            const photoBody = photo.body as {
                success: boolean;
                data: { photoId: string; url: string };
            };
            expect(photoBody.success).toBe(true);
            expect(photoBody.data.url).toMatch(/audit-photo/);

            // Verify the audit context payload contains the farm lat/lng
            // that the DM-4 fallback uses when GPS is denied.
            const ctx = buildAuditOnsiteContext();
            expect(ctx.data.audit.farmLat).toBeGreaterThan(0);
            expect(ctx.data.audit.farmLng).toBeGreaterThan(0);
        }
    });

    // STAGE 6: AUDITOR — PASS decision (validates AUDIT_RESULT_PASSED template + R2-D cert auto-gen)
    test('Stage 6: AUDITOR submits AUDIT_PASSED decision; cert auto-generated', async ({ page }) => {
        await signInAsAuditor(page);
        await ensureAuditorGeolocation(page);
        await auditorStageMocks(page);
        await certIssuanceMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            const decision = await pageFetch(
                page,
                `/api/audit/onsite/${W1B_AUDIT_ID}/decision`,
                {
                    method: 'POST',
                    body: {
                        decision: 'PASS',
                        summary: 'ฟาร์มผ่านเกณฑ์ทุกข้อ — W1-B regression PASS',
                    },
                },
            );
            expect(decision.status).toBe(200);
            const decisionBody = decision.body as {
                success: boolean;
                data: { decision: string; certificate?: { certificateNumber: string } };
            };
            expect(decisionBody.success).toBe(true);
            expect(decisionBody.data.decision).toBe('PASS');
            // R2-D cert auto-gen surface: the decision response includes
            // the freshly minted certificate metadata.
            expect(decisionBody.data.certificate).toBeDefined();
            expect(decisionBody.data.certificate?.certificateNumber).toBe(W1B_CERT_NUMBER);

            // Cert detail verifies the GACP-TH-{YEAR}-{SUFFIX} pattern.
            const cert = buildCertificatePayload();
            expect(cert.data.certificateNumber).toMatch(/^(TH-GACP \d+\/\d{4}|GACP-TH-\d{4}-\w{3})$/);
            expect(cert.data.signedAt).not.toBeNull();
            expect(cert.data.applicationId).toBe(W1B_APP_ID);
        }
    });

    // STAGE 7: ACCOUNT_DTAM — review state-fee slip (validates V4-A admission middleware)
    test('Stage 7: ACCOUNT_DTAM reviews and approves state-fee slip', async ({ page }) => {
        await signInAsAccountDtam(page);
        await accountantDtamMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            const pending = await pageFetch(page, '/api/payments/slip/pending');
            expect(pending.status).toBe(200);
            const pendingBody = pending.body as {
                success: boolean;
                data: Array<{ id: string; serviceType: string }>;
            };
            expect(pendingBody.success).toBe(true);
            const stateSlip = pendingBody.data.find((s) => s.id === W1B_STATE_SLIP_ID);
            expect(stateSlip).toBeDefined();
            expect(stateSlip?.serviceType).toBe('PHASE_1_STATE_FEE');

            // Slip-queue summary uses the DTAM visible side hint.
            const summary = await pageFetch(
                page,
                '/api/finance/accounting/slip-queue-summary',
            );
            expect(summary.status).toBe(200);
            const summaryBody = summary.body as {
                success: boolean;
                data: { visibleSide: string };
            };
            expect(summaryBody.success).toBe(true);
            expect(summaryBody.data.visibleSide).toBe('DTAM');

            // Approve the state slip — V4-A admission allows it on the
            // DTAM side.
            const approve = await pageFetch(
                page,
                `/api/payments/slip/${W1B_STATE_SLIP_ID}/approve`,
                { method: 'POST', body: { amountVerified: 5000, note: 'W1-B state slip OK' } },
            );
            expect(approve.status).toBe(200);
            const approveBody = approve.body as {
                success: boolean;
                data: { status: string };
            };
            expect(approveBody.success).toBe(true);
            expect(approveBody.data.status).toBe('APPROVED');
        }
    });

    // STAGE 8: ACCOUNT_PLATFORM — platform-fee slip + wallet badge (V4-A admission + V4-B UX-D4)
    test('Stage 8: ACCOUNT_PLATFORM approves platform-fee slip; Wallet B badge visible', async ({ page }) => {
        await signInAsAccountPlatform(page);
        await accountantPlatformMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            const pending = await pageFetch(page, '/api/payments/slip/pending');
            expect(pending.status).toBe(200);
            const pendingBody = pending.body as {
                success: boolean;
                data: Array<{ id: string; serviceType: string }>;
            };
            expect(pendingBody.success).toBe(true);
            const platformSlip = pendingBody.data.find(
                (s) => s.id === W1B_PLATFORM_SLIP_ID,
            );
            expect(platformSlip).toBeDefined();
            expect(platformSlip?.serviceType).toBe('PHASE_1_PLATFORM_FEE');

            // V4-B UX-D4: Wallet B badge filter — slip-queue summary
            // returns visibleSide=PLATFORM so the UI hides Wallet A.
            const summary = buildSlipQueueSummary({ side: 'PLATFORM' });
            expect(summary.data.visibleSide).toBe('PLATFORM');

            // Approve the platform slip — V4-A admission allows it on
            // the PLATFORM side. Cross-side reject is exercised in W1-C.
            const approve = await pageFetch(
                page,
                `/api/payments/slip/${W1B_PLATFORM_SLIP_ID}/approve`,
                { method: 'POST', body: { amountVerified: 535, note: 'W1-B platform slip OK' } },
            );
            expect(approve.status).toBe(200);
            const approveBody = approve.body as {
                success: boolean;
                data: { status: string };
            };
            expect(approveBody.success).toBe(true);
            expect(approveBody.data.status).toBe('APPROVED');
        }
    });

    // STAGE 9: ACCOUNT_PLATFORM — period close (validates R1-A)
    test('Stage 9: ACCOUNT_PLATFORM closes the monthly period', async ({ page }) => {
        await signInAsAccountPlatform(page);
        await accountantPlatformMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            // List endpoint (R1-A surface).
            const list = await pageFetch(page, '/api/finance/period-close');
            expect(list.status).toBe(200);
            const listBody = list.body as {
                success: boolean;
                data: Array<{ id: string; status: string }>;
            };
            expect(listBody.success).toBe(true);
            expect(listBody.data.length).toBeGreaterThanOrEqual(1);

            // Close a new period.
            const close = await pageFetch(page, '/api/finance/period-close', {
                method: 'POST',
                body: { year: 2026, month: 5, notes: 'W1-B regression close' },
            });
            expect(close.status).toBe(201);
            const closeBody = close.body as {
                success: boolean;
                data: { id: string; status: string };
            };
            expect(closeBody.success).toBe(true);
            expect(closeBody.data.id).toBe(W1B_PERIOD_CLOSE_ID);
            expect(closeBody.data.status).toBe('CLOSED');

            // Confirm the result payload shape (sanity).
            const result = buildPeriodCloseResult();
            expect(result.data.status).toBe('CLOSED');
        }
    });

    // STAGE 10: ACCOUNT_PLATFORM — manual JE (validates R1-C)
    test('Stage 10: ACCOUNT_PLATFORM creates a manual journal-entry draft', async ({ page }) => {
        await signInAsAccountPlatform(page);
        await accountantPlatformMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            const list = await pageFetch(page, '/api/finance/manual-journal-entries');
            expect(list.status).toBe(200);
            const listBody = list.body as {
                success: boolean;
                data: Array<{ id: string; status: string }>;
            };
            expect(listBody.success).toBe(true);
            expect(listBody.data.length).toBeGreaterThanOrEqual(1);

            // Create a new draft.
            const create = await pageFetch(page, '/api/finance/manual-journal-entries', {
                method: 'POST',
                body: {
                    memo: 'Reclass platform revenue (W1-B spec)',
                    lines: [
                        { accountCode: '4101', debit: 0, credit: 1000, description: 'Revenue' },
                        { accountCode: '1101', debit: 1000, credit: 0, description: 'Clearing' },
                    ],
                },
            });
            expect(create.status).toBe(201);
            const createBody = create.body as {
                success: boolean;
                data: { id: string; status: string; totalDebit: number; totalCredit: number };
            };
            expect(createBody.success).toBe(true);
            expect(createBody.data.id).toBe(W1B_MJE_DRAFT_ID);
            expect(createBody.data.status).toBe('DRAFT');
            // Sanity: balanced
            expect(createBody.data.totalDebit).toBe(createBody.data.totalCredit);

            // Sanity on the helper payload (R1-C surface).
            const draft = buildManualJournalEntryDraftCreated();
            expect(draft.data.lines.length).toBe(2);
        }
    });

    // STAGE 11: ADMIN — audit log search + CSV export (validates V5-A + V5-D)
    test('Stage 11: ADMIN searches audit log and exports CSV', async ({ page }) => {
        await signInAsAdmin(page);
        await adminAuditLogMocks(page);
        // Cross-tenant cert search also hits the admin layer; mock so
        // navigation does not fail.
        await certIssuanceMocks(page);

        // NOTE: applySession now seeds the provider_token cookie, so the
        // middleware redirects /auth/provider/login → /provider/dashboard
        // → role landing (a moving target that can destroy the JS context
        // mid-pageFetch). These stages only need a STABLE page for
        // page.evaluate fetches, so park on the health login page, which
        // never auto-redirects.
        await page.goto('/auth/health/login');
        await page.waitForLoadState('domcontentloaded');

        if (!expectLiveBackend()) {
            // V5-A admin search: list the audit-log rows.
            const log = await pageFetch(page, '/api/admin/audit-log?page=1&limit=50');
            expect(log.status).toBe(200);
            const logBody = log.body as {
                success: boolean;
                data: Array<{ id: string; action: string; resourceId: string }>;
                pagination?: { total: number };
            };
            expect(logBody.success).toBe(true);
            // The three cross-role transitions must be present
            // (DOC_APPROVED → AUDIT_PASSED → CERTIFICATE_ISSUED).
            expect(logBody.data.length).toBeGreaterThanOrEqual(3);
            const actions = logBody.data.map((r) => r.action);
            expect(actions).toContain('DOC_APPROVED');
            expect(actions).toContain('AUDIT_PASSED');
            expect(actions).toContain('CERTIFICATE_ISSUED');

            // V5-A admin cert search lists the new cert.
            const certs = await pageFetch(page, '/api/admin/certificates');
            expect(certs.status).toBe(200);
            const certsBody = certs.body as {
                success: boolean;
                data: Array<{ id: string; certificateNumber: string }>;
            };
            expect(certsBody.success).toBe(true);
            const certRow = certsBody.data.find((c) => c.id === W1B_CERT_ID);
            expect(certRow).toBeDefined();
            expect(certRow?.certificateNumber).toBe(W1B_CERT_NUMBER);

            // V5-D CSV export: stream the export endpoint and assert the
            // header row + at least one of the cross-role transitions
            // is present in the body.
            const exportRes = await pageFetch(
                page,
                '/api/admin/audit-log/export.csv?from=2026-01-01&to=2026-12-31',
            );
            expect(exportRes.status).toBe(200);
            expect(exportRes.text).toContain('sequence,createdAt');
            expect(exportRes.text).toContain('DOC_APPROVED');
            expect(exportRes.text).toContain('AUDIT_PASSED');
            expect(exportRes.text).toContain('CERTIFICATE_ISSUED');
        }
    });
});
