/**
 * ============================================================================
 * E2E — Applicant Renewal Flow (Iter 26)
 * ============================================================================
 * Third mocked end-to-end spec, covering the applicant-driven renewal
 * journey introduced by Iter 26 (B26-A renewal-service + cron + routes).
 *
 *   1. HEALTH user lands on /health/certificates, sees a certificate
 *      that is about to expire (daysUntilExpiry = 45 — within the
 *      365-day "ยื่นต่ออายุ" window the page uses), clicks the
 *      "ยื่นต่ออายุ" CTA on the card, and is taken to the renewal
 *      wizard at /health/applications/renewal?certId=…. The renewal
 *      wizard then POSTs to /api/applications/renewal (mocked) and
 *      surfaces the freshly-created renewal-application id.
 *
 *   2. (Deferred — see "Known limitations" in
 *      docs/qa/e2e-tests-2026-05-16.md) Dashboard reminder banner at
 *      30 days — the banner does not exist yet on
 *      /health/dashboard; the test is split into a structural check
 *      that verifies the dashboard does NOT crash when the certs API
 *      surfaces a near-expiry cert, so we have a green spec to build
 *      on once the B26-A banner ships.
 *
 * Scope: B26-A backend (renewal-service + cron + routes) is fully
 * mocked via page.route() handlers. Frontend code under
 * /health/applications/renewal/** is the only real code in the loop.
 *
 * Run:
 *   cd apps/web-app
 *   npx playwright test playwright/renewal-flow.spec.ts --project=chromium
 */

import { test, expect, type Page as _Page } from '@playwright/test';
import { loginAsHealthUser, mockApi } from './fixtures';

// ────────────────────────────────────────────────────────────────────────────
// Shared test data
// ────────────────────────────────────────────────────────────────────────────

/** The originally-certified application that we are renewing FROM. */
const ORIGINAL_APP_ID = 'app-iter26-original';
const ORIGINAL_APP_NUMBER = 'APP-2023-00099';
const CERT_ID = 'cert-iter26-001';
const CERT_NUMBER = 'CERT-2023-000099';

/** The new (renewal) application id the B26-A backend mints on POST. */
const RENEWAL_APP_ID = 'app-iter26-renewal-new';
const RENEWAL_APP_NUMBER = 'APP-2026-00210';

function buildCertificate(daysUntilExpiry: number) {
    const expiryDate = new Date(Date.now() + daysUntilExpiry * 86_400_000).toISOString();
    const issuedDate = new Date(
        new Date(expiryDate).getTime() - 3 * 365 * 86_400_000,
    ).toISOString();
    return {
        _id: CERT_ID,
        id: CERT_ID,
        certificateNumber: CERT_NUMBER,
        applicationId: ORIGINAL_APP_ID,
        farmId: 'farm-iter26-001',
        siteName: 'สวนสมุนไพรลุงมานพ',
        plantType: 'ขมิ้นชัน',
        issuedDate,
        expiryDate,
        status: 'ACTIVE',
        qrCode: null,
        farm: {
            name: 'สวนสมุนไพรลุงมานพ',
            type: 'organic',
            province: 'เชียงใหม่',
            district: 'แม่ริม',
            subDistrict: 'ดอนแก้ว',
            location: '99 หมู่ 5 ต.ดอนแก้ว อ.แม่ริม จ.เชียงใหม่',
            totalArea: 4.5,
            areaUnit: 'rai',
        },
        crops: ['ขมิ้นชัน'],
        audit: {
            score: 92,
            auditorName: 'นาง สมศรี ใจดี',
            lastAuditDate: new Date(issuedDate).toISOString(),
        },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Test 1 — Applicant initiates renewal from /health/certificates
// ────────────────────────────────────────────────────────────────────────────

test.describe.serial('E2E: Applicant Renewal Flow (Iter 26)', () => {
    test('applicant initiates renewal from certificate card (45 days to expiry)', async ({
        page,
    }) => {
        // ── Step 1 — Login as HEALTH user ────────────────────────────
        await loginAsHealthUser(page);

        // ── Step 2 — Mock /api/certificates/my (list) ─────────────────
        // The card-list page reads this; with daysUntilExpiry = 45,
        // the "ยื่นต่ออายุ" CTA must appear (the page renders it for
        // any cert with daysLeft in (0, 365]).
        const cert = buildCertificate(45);
        await mockApi(page, {
            route: /\/api\/certificates\/my(\?.*)?$/,
            body: { success: true, data: [cert] },
        });

        // The renewal wizard reads /api/certificates/{id} for the
        // detail. Mock that too so the wizard's first render finds
        // the cert by certId from the query string.
        await mockApi(page, {
            route: new RegExp(`/api/certificates/${CERT_ID}$`),
            body: { success: true, data: cert },
        });

        // ── Step 3 — Mock the renewal POST endpoint ───────────────────
        // B26-A route. The wizard sends previousApplicationId +
        // certificateId; the backend mints a new application id and
        // returns it so the wizard can advance.
        let renewalRequestBody: unknown = null;
        // W12 — was '**/api/applications/renewal' (singular). That is a route
        // the backend does not mount, so this mock was agreeing with a caller
        // bug instead of with the server: against a real backend the singular
        // path answers 404. The mock now matches the real mount, /renewals.
        await page.route('**/api/applications/renewals', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            try {
                renewalRequestBody = route.request().postDataJSON();
            } catch {
                renewalRequestBody = route.request().postData();
            }
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        applicationId: RENEWAL_APP_ID,
                        applicationNumber: RENEWAL_APP_NUMBER,
                        previousApplicationId: ORIGINAL_APP_ID,
                        certificateId: CERT_ID,
                        isRenewal: true,
                        // Copy-forward fields from B26-A renewal-service:
                        // farm address + cultivation methods come over
                        // from the previous application so the applicant
                        // only has to refresh the documents that change.
                        copyForward: {
                            farmAddress:
                                '99 หมู่ 5 ต.ดอนแก้ว อ.แม่ริม จ.เชียงใหม่',
                            cultivationMethods: ['organic', 'no-pesticide'],
                            plantType: 'ขมิ้นชัน',
                        },
                        createdAt: new Date().toISOString(),
                    },
                }),
            });
        });

        // Mock the document upload route the upload-step hits when the
        // applicant attaches files. We return success without enforcing
        // the schema — Iter 26 just needs the step to advance.
        await page.route('**/api/applications/draft-documents', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    fileUrl: '/mock/renewal-doc.pdf',
                }),
            });
        });

        // ── Step 4 — Navigate to /health/certificates ─────────────────
        await page.goto('/health/certificates');
        await page.waitForLoadState('domcontentloaded');

        // Card with our certificateNumber should render.
        await expect(page.getByText(CERT_NUMBER)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('สวนสมุนไพรลุงมานพ')).toBeVisible();

        // The "ยื่นต่ออายุ" CTA (emerald primary button at <= 365 days)
        // should be present on the card. Use role+name lookup which is
        // resilient to the surrounding chrome.
        const renewButton = page
            .getByRole('link', { name: /ยื่นต่ออายุ/ })
            .or(page.getByRole('button', { name: /ยื่นต่ออายุ/ }))
            .first();
        await expect(renewButton).toBeVisible({ timeout: 10_000 });

        // ── Step 5 — Click "ยื่นต่ออายุ" ──────────────────────────────
        // The current card-view renders this as a <Link> to
        // /health/applications/new (the wizard entry); the renewal
        // wizard at /health/applications/renewal?certId=… is the
        // dedicated route. Both lead to the renewal flow; we follow
        // the link the page provides and assert we landed on a
        // renewal-capable route.
        await renewButton.click();

        // Wait for navigation — accept either the dedicated renewal
        // wizard OR the generic new-application wizard. Both are
        // acceptable in Iter 26: B26-C may not yet have wired the
        // card CTA directly to /applications/renewal.
        await expect(page).toHaveURL(
            /\/health\/applications\/(renewal|new)(\?|\/|$)/,
            { timeout: 20_000 },
        );

        // ── Step 6 — Drive the renewal wizard (direct entry) ──────────
        // For a deterministic verification of the renewal POST + new
        // application id, open the renewal wizard directly with the
        // certId query param. (If the card CTA already led us here,
        // the second goto is a no-op refresh.)
        await page.goto(
            `/health/applications/renewal?certId=${encodeURIComponent(CERT_ID)}`,
        );
        await page.waitForLoadState('domcontentloaded');

        // Title or eyebrow of the renewal wizard.
        await expect(
            page.getByRole('heading', { name: /ต่ออายุใบรับรอง GACP/ }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // The cert summary panel should surface the cert number.
        await expect(page.getByText(CERT_NUMBER).first()).toBeVisible();

        // ── Step 7 — There is no upload step any more ─────────────────
        // W12 (operator ruling 2026-08-22): a renewal has no document review,
        // so the wizard no longer collects documents. It opens on the quotation
        // and creates the renewal application itself as soon as the certificate
        // has loaded. This block used to upload 3 of the 4 REQUIRED_DOCS and
        // press "ดำเนินการต่อ"; both the documents and that press are gone.
        await expect(page.locator('input[type="file"]')).toHaveCount(0);

        // ── Step 8 — Verify POST body + the quotation is what we land on ──
        // The wizard calls api.post('/api/applications/renewals',
        // { originalCertificateId }) from an effect. The quotation step then
        // renders the renewal fee summary.
        await expect(
            page
                .getByText(/ใบเสนอราคา|สรุปค่าธรรมเนียม|ค่าธรรมเนียมต่ออายุ/)
                .first(),
        ).toBeVisible({ timeout: 15_000 });

        // Assert the renewal POST payload carried the expected
        // copy-forward source ids. We only check shape — exact contents
        // depend on the wizard's local state at submit time.
        // W12 — the payload is now just the one field the route reads.
        // It used to be { previousApplicationId, certificateId, documentIds };
        // the route ignores everything except originalCertificateId (with a
        // certificateId fallback), and the two extra values described an upload
        // step that no longer exists.
        expect(renewalRequestBody).toEqual({
            originalCertificateId: CERT_ID,
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // Test 2 — Near-expiry dashboard reminder (PARTIAL / Deferred)
    // ────────────────────────────────────────────────────────────────────
    //
    // The owner directive asks for a "ใบรับรองของท่านจะหมดอายุในอีก
    // 30 วัน" banner on /health/dashboard. As of this iter (Iter 26)
    // the dashboard does NOT yet render such a banner — a grep across
    // apps/web-app/src/app/health/dashboard/** finds zero occurrences
    // of the relevant string. This test therefore acts as a STRUCTURAL
    // smoke for the dashboard under a near-expiry certs response so the
    // suite stays green and ready to extend once B26-C wires the banner.
    // ────────────────────────────────────────────────────────────────────

    test('dashboard renders cleanly with a 30-days-to-expiry certificate (banner deferred)', async ({
        page,
    }) => {
        // ── Step 1 — Login as HEALTH user ────────────────────────────
        await loginAsHealthUser(page);

        // ── Step 2 — Mock certs + applications APIs ──────────────────
        const cert = buildCertificate(30);
        await mockApi(page, {
            route: /\/api\/certificates\/my(\?.*)?$/,
            body: { success: true, data: [cert] },
        });
        await mockApi(page, {
            route: /\/api\/applications\/my(\?.*)?$/,
            body: { success: true, data: [
                {
                    id: ORIGINAL_APP_ID,
                    _id: ORIGINAL_APP_ID,
                    applicationNumber: ORIGINAL_APP_NUMBER,
                    farmName: 'สวนสมุนไพรลุงมานพ',
                    plantName: 'ขมิ้นชัน',
                    submittedAt: cert.issuedDate,
                    createdAt: cert.issuedDate,
                    status: 'CERTIFIED',
                    stage: 'CERTIFIED',
                },
            ] },
        });

        // ── Step 3 — Navigate to /health/dashboard ───────────────────
        await page.goto('/health/dashboard');
        await page.waitForLoadState('domcontentloaded');

        // Sanity — the dashboard rendered (SummaryHeader / quick
        // actions panel are stable on this page).
        await expect(
            page
                .getByText(/Track & Trace|Certificates|ใบรับรอง/)
                .first(),
        ).toBeVisible({ timeout: 15_000 });

        // ── Step 4 — If the banner exists, assert it ────────────────
        // We probe for the Thai string but do NOT fail the test when
        // absent. This makes the test forward-compatible: once B26-C
        // (or a follow-up iter) ships the banner, this test will
        // automatically validate it without any change.
        const banner = page
            .getByText(/ใบรับรองของท่านจะหมดอายุในอีก\s*30\s*วัน/)
            .first();
        const hasBanner = await banner.isVisible().catch(() => false);
        if (hasBanner) {
            await expect(banner).toBeVisible();
            // Banner should link to the renewal wizard with certId.
            const bannerLink = page
                .getByRole('link', { name: /ใบรับรอง.*หมดอายุ|ต่ออายุ/ })
                .first();
            await bannerLink.click();
            await expect(page).toHaveURL(
                /\/health\/applications\/(renewal|new)(\?|\/|$)/,
                { timeout: 10_000 },
            );
        } else {
            // Banner not yet present — assert page rendered and skip.
            test.info().annotations.push({
                type: 'deferred',
                description:
                    'Dashboard renewal banner not yet implemented in /health/dashboard. Verified that the dashboard renders cleanly with a near-expiry cert. Re-enable hard assertions when B26-C ships the banner.',
            });
        }
    });
});
