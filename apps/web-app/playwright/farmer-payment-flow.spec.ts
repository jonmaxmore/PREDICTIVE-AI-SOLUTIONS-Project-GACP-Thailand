/**
 * ============================================================================
 * E2E — Farmer Phase 1 Payment Flow (Iter 23)
 * ============================================================================
 * First end-to-end test for the two-money-flow payment screen. Validates
 * the happy-path sequence:
 *
 *   1. HEALTH user lands on /health/applications/new and is redirected
 *      into the wizard (step 1).
 *   2. With a draft application "submitted", /health/payments renders
 *      TWO Phase 1 cards — STATE (5,000 บาท) and PLATFORM (535 บาท incl.
 *      VAT 35).
 *   3. Clicking "อัปโหลดสลิป" on the STATE card opens the slip-upload
 *      modal.
 *   4. Filling bankRef + transferredAt + attaching a PNG file + clicking
 *      "ส่งสลิปให้ตรวจสอบ" triggers a POST to /api/payments/slip/upload
 *      and surfaces the success toast.
 *   5. After mocking ACCOUNT_DTAM approval, the page refreshes and the
 *      STATE invoice flips to "ชำระแล้ว".
 *
 * Scope/limitations (documented in docs/qa/e2e-tests-2026-05-16.md):
 *   - Backend is fully mocked via Playwright route handlers — no real
 *     Postgres/Prisma/Redis required. This is intentional for the first
 *     E2E so it can run in CI without docker-compose.
 *   - The approval step does NOT exercise the real /approve route; we
 *     mock /invoices/my to return the post-approval payload.
 *   - Wizard form-filling is skipped (the test enters /health/payments
 *     directly with mocked invoices) — a follow-up Iter will exercise
 *     the wizard once it has stable data-testid attributes.
 *
 * Run:
 *   cd apps/web-app
 *   npx playwright test playwright/farmer-payment-flow.spec.ts --project=chromium
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsHealthUser, mockApi } from './fixtures';

const APP_ID = 'app-iter23-e2e';
const STATE_INVOICE_ID = 'inv-state-iter23';
const PLATFORM_INVOICE_ID = 'inv-platform-iter23';

function buildInvoicePayload(opts: { stateIsPaid?: boolean; platformIsPaid?: boolean } = {}) {
    const { stateIsPaid = false, platformIsPaid = false } = opts;
    return {
        success: true,
        data: [
            {
                id: STATE_INVOICE_ID,
                documentNumber: 'INV-PH1-STATE-2026-00001',
                invoiceNumber: 'INV-PH1-STATE-2026-00001',
                applicationId: APP_ID,
                application: { id: APP_ID, applicationNumber: 'APP-2026-00001' },
                amount: 5000,
                totalAmount: 5000,
                status: stateIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                erpStatus: stateIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                createdAt: '2026-05-16T03:00:00.000Z',
                serviceType: 'PHASE_1_STATE_FEE',
                lineItems: [
                    {
                        lineNumber: 1,
                        code: 'PHASE_1_STATE',
                        description: 'ค่าธรรมเนียมรัฐ (งวดที่ 1)',
                        quantity: 1,
                        unitPrice: 5000,
                        amount: 5000,
                        phase: 'PHASE_1',
                        isTaxable: false,
                    },
                ],
            },
            {
                id: PLATFORM_INVOICE_ID,
                documentNumber: 'INV-PH1-PLAT-2026-00001',
                invoiceNumber: 'INV-PH1-PLAT-2026-00001',
                applicationId: APP_ID,
                application: { id: APP_ID, applicationNumber: 'APP-2026-00001' },
                amount: 535,
                totalAmount: 535,
                status: platformIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                erpStatus: platformIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                createdAt: '2026-05-16T03:00:00.000Z',
                serviceType: 'PHASE_1_PLATFORM_FEE',
                lineItems: [
                    {
                        lineNumber: 1,
                        code: 'PHASE_1_PLATFORM',
                        description: 'ค่าบริการแพลตฟอร์ม (งวดที่ 1)',
                        quantity: 1,
                        unitPrice: 500,
                        amount: 500,
                        phase: 'PHASE_1',
                        isTaxable: true,
                    },
                    {
                        lineNumber: 2,
                        code: 'VAT',
                        description: 'ภาษีมูลค่าเพิ่ม 7%',
                        quantity: 1,
                        unitPrice: 35,
                        amount: 35,
                        phase: 'PHASE_1',
                        isTaxable: false,
                    },
                ],
            },
        ],
    };
}

const ISSUER_STATE = {
    success: true,
    data: {
        serviceType: 'PHASE_1_STATE_FEE',
        issuerType: 'DTAM',
        legalNameTH: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
        legalNameEN: 'Department of Thai Traditional and Alternative Medicine',
        taxId: '0994000165340',
        addressLine1: 'ถนนติวานนท์',
        addressLine2: 'อ.เมือง จ.นนทบุรี 11000',
        receiptDocumentType: 'TREASURY_RECEIPT',
        receiptDocumentTypeTH: 'ใบเสร็จรับเงินรายได้แผ่นดิน',
        chargesVat: false,
        vatRate: 0,
        collectedByPlatform: false,
        collectionAgentNoteTH: 'รับชำระโดยกรมบัญชีกลาง — เงินรายได้แผ่นดิน',
        bankAccount: {
            bankName: 'กรุงไทย',
            accountNumber: '059-0-12345-6',
            accountHolder: 'กรมการแพทย์แผนไทย',
            legacyAccountName: null,
            promptpayId: '0994000165340',
            promptpayQrPayload: '00020101021229370016A0000006770101110113099400016534053037645802TH6304ABCD',
            vatExempt: true,
            revenueCategoryTH: 'เงินรายได้แผ่นดิน',
        },
    },
};

const ISSUER_PLATFORM = {
    success: true,
    data: {
        serviceType: 'PHASE_1_PLATFORM_FEE',
        issuerType: 'PLATFORM',
        legalNameTH: 'บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด',
        legalNameEN: 'Predictive AI Solution Co., Ltd.',
        taxId: '0105566123456',
        addressLine1: '99/9 อาคารฮับ',
        addressLine2: 'กทม. 10110',
        receiptDocumentType: 'TAX_INVOICE',
        receiptDocumentTypeTH: 'ใบกำกับภาษี/ใบเสร็จ',
        chargesVat: true,
        vatRate: 0.07,
        collectedByPlatform: true,
        collectionAgentNoteTH: null,
        bankAccount: {
            bankName: 'กสิกรไทย',
            accountNumber: '123-4-56789-0',
            accountHolder: 'บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด',
            legacyAccountName: null,
            promptpayId: '0105566123456',
            promptpayQrPayload: '00020101021229370016A0000006770101110113010556612345653037645802TH6304WXYZ',
            vatExempt: false,
            revenueCategoryTH: null,
        },
    },
};

const BANK_ACTIVE_STATE = {
    success: true,
    data: {
        bankCode: 'KTB',
        bankName: 'กรุงไทย',
        accountNumber: '059-0-12345-6',
        accountHolder: 'กรมการแพทย์แผนไทย',
        branchName: 'นนทบุรี',
        promptpayId: '0994000165340',
        promptpayQrPayload: ISSUER_STATE.data.bankAccount.promptpayQrPayload,
    },
};

/**
 * Wire up the minimum set of /api mocks the payments screen + slip modal
 * touch. Tests can layer more on top of these.
 */
async function mockPaymentsBackend(page: Page) {
    // Wizard gating fetches (Step 3 sanity navigation) — the step shell
    // fetches config + draft before rendering; unmocked they 503 against
    // the (down) backend and the wizard renders the amber retry state.
    //   config: success with no `steps` = full default step list
    //   draft:  200 {success:true,data:null} = canonical "no draft"
    await mockApi(page, {
        route: /\/api\/applications\/config(\?.*)?$/,
        body: { success: true, data: {} },
    });
    await mockApi(page, {
        route: /\/api\/applications\/draft(\?.*)?$/,
        body: { success: true, data: null },
    });

    // Q4 payment-terms consent gate (slip-upload-modal.tsx): GET /consent
    // reports "not yet granted" so the spec exercises the first-time
    // checkbox act; POST /consent records the acknowledgment on submit.
    await page.route(/\/api\/consent(\?.*)?$/, async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { consents: {} } }),
            });
            return;
        }
        if (method === 'POST') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { category: 'PAYMENT_TERMS', granted: true },
                }),
            });
            return;
        }
        await route.fallback();
    });

    // /invoices/my — initially returns both invoices unpaid.
    await page.route('**/api/invoices/my**', async (route) => {
        // Tests can call page.unroute() and re-route to override this
        // baseline with the post-approval payload.
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(buildInvoicePayload()),
        });
    });

    await mockApi(page, {
        route: /\/api\/finance\/issuers\/by-service-type\/PHASE_1_STATE_FEE/,
        body: ISSUER_STATE,
    });
    await mockApi(page, {
        route: /\/api\/finance\/issuers\/by-service-type\/PHASE_1_PLATFORM_FEE/,
        body: ISSUER_PLATFORM,
    });

    await mockApi(page, {
        route: /\/api\/payments\/bank-accounts\/active\?phase=PHASE_1/,
        body: BANK_ACTIVE_STATE,
    });

    // Slip history is empty until upload.
    await mockApi(page, {
        route: new RegExp(`/api/payments/slip/by-application/${APP_ID}`),
        body: { success: true, data: [] },
    });

    // Slip upload mock — captures the FormData and returns a PENDING slip.
    await page.route('**/api/payments/slip/upload', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const slip = {
            success: true,
            data: {
                id: 'slip-iter23-001',
                applicationId: APP_ID,
                invoiceId: STATE_INVOICE_ID,
                phase: 'PHASE_1',
                status: 'PENDING_REVIEW',
                fileUrl: '/mock/slip.png',
                fileMimeType: 'image/png',
                fileSizeBytes: 1024,
                bankRef: 'TRX-IT23-001',
                transferredAt: '2026-05-16T10:00:00.000Z',
                amountClaimed: 5000,
                uploadedBy: 'health-user-iter23',
                uploadedAt: new Date().toISOString(),
            },
        };
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(slip),
        });
    });
}

test.describe.serial('E2E: Farmer Phase 1 Payment Flow (Iter 23)', () => {
    test('happy path: STATE + PLATFORM cards, slip upload, post-approval', async ({ page }) => {
        // ── Step 1 — Login as HEALTH user ────────────────────────────
        await loginAsHealthUser(page, { healthId: '1234567890123' });

        // ── Step 2 — Wire up API mocks BEFORE navigating ─────────────
        await mockPaymentsBackend(page);

        // ── Step 3 — Verify wizard entry resolves (sanity) ───────────
        // We don't drive the wizard end-to-end here — the existing
        // golden-scenario E2E does that via the API. This call just
        // confirms the redirect from /new → /new/step/1 still works,
        // which is the contract this test depends on.
        await page.goto('/health/applications/new');
        await expect(page).toHaveURL(/\/health\/applications\/new\/step\/\d+/, { timeout: 20_000 });

        // ── Step 4 — Navigate to /health/payments ────────────────────
        await page.goto('/health/payments');
        await page.waitForLoadState('domcontentloaded');

        // The Phase 1 section + two cards should render with the
        // amounts the owner directive specifies.
        const phase1Section = page.getByTestId('two-card-phase-งวดที่ 1');
        await expect(phase1Section).toBeVisible({ timeout: 15_000 });

        const stateCard = page.getByTestId('payment-invoice-card-STATE');
        const platformCard = page.getByTestId('payment-invoice-card-PLATFORM');
        await expect(stateCard).toBeVisible();
        await expect(platformCard).toBeVisible();

        // Amounts — 5,000 บาท on STATE, 535 บาท on PLATFORM. The
        // currency is rendered via Intl.NumberFormat('th-TH', THB) so
        // the literal text is "฿5,000" / "฿535".
        await expect(stateCard).toContainText(/5,000/);
        await expect(stateCard.getByText('ค่าธรรมเนียมรัฐ').first()).toBeVisible();

        await expect(platformCard).toContainText(/535/);
        await expect(platformCard.getByText('ค่าบริการแพลตฟอร์ม').first()).toBeVisible();
        // PLATFORM card surfaces the VAT split (500 + 35).
        await expect(platformCard).toContainText(/VAT/i);

        // ── Step 5 — Open slip-upload modal from STATE card ──────────
        await stateCard.getByRole('button', { name: /อัปโหลดสลิป/ }).click();

        // The modal title "ชำระเงินด้วยการโอนและแนบสลิป" should appear.
        await expect(
            page.getByRole('heading', { name: /ชำระเงินด้วยการโอนและแนบสลิป/ }),
        ).toBeVisible({ timeout: 10_000 });

        // Bank info should be the STATE side (กรมการแพทย์แผนไทย). Scope to
        // the modal's bank section — the invoice card now ALSO renders the
        // account number, so a bare text lookup double-matches.
        await expect(
            page.getByTestId('slip-upload-bank-section').getByText(/059-0-12345-6/),
        ).toBeVisible();

        // ── Step 6 — Fill bank ref + transfer time ───────────────────
        await page.getByPlaceholder(/TRX/).fill('TRX-IT23-001');
        await page.locator('input[type="datetime-local"]').fill('2026-05-16T10:00');

        // ── Step 7 — Attach a fake PNG file ──────────────────────────
        // Playwright's setInputFiles accepts an in-memory buffer so we
        // don't need to materialise a file on disk.
        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles({
            name: 'slip-iter23.png',
            mimeType: 'image/png',
            // 1×1 transparent PNG (smallest valid PNG)
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                'base64',
            ),
        });

        // ── Step 8 — Accept payment terms + submit slip ──────────────
        // Q4 gate: the submit button stays disabled until the payment
        // terms checkbox is ticked (or a granted consent already exists).
        await page.getByTestId('slip-upload-terms-checkbox').check();
        await page.getByRole('button', { name: /ส่งสลิปให้ตรวจสอบ/ }).click();

        // Success toast/inline message.
        await expect(
            page.getByText(/อัปโหลดสลิปสำเร็จ/),
        ).toBeVisible({ timeout: 10_000 });

        // ── Step 9 — Mock ACCOUNT_DTAM approval ──────────────────────
        // Re-route /invoices/my to return the STATE invoice as paid.
        // page.route handlers added later take precedence over earlier
        // ones that haven't been removed, so this override wins.
        await page.unroute('**/api/invoices/my**');
        await page.route('**/api/invoices/my**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(buildInvoicePayload({ stateIsPaid: true })),
            });
        });

        // ── Step 10 — Reload + verify STATE is "ชำระแล้ว" ────────────
        // Close the slip modal first so the refresh shows the cards. On
        // success the modal swaps to a dedicated success screen whose
        // close affordance is "เสร็จสิ้น" (ปิดหน้าต่าง only exists pre-submit).
        await page.getByRole('button', { name: /เสร็จสิ้น/ }).click();
        // Click the page-level "รีเฟรช" button to re-fetch invoices
        // without a full page reload.
        await page.getByRole('button', { name: /^รีเฟรช$/ }).click();

        // The STATE card status badge should now read "ชำระแล้ว".
        await expect(
            page.getByTestId('payment-invoice-card-STATE').getByText('ชำระแล้ว').first(),
        ).toBeVisible({ timeout: 10_000 });

        // The button should be disabled (no longer "อัปโหลดสลิป").
        const stateButton = page
            .getByTestId('payment-invoice-card-STATE')
            .getByRole('button', { name: /ชำระแล้ว/ });
        await expect(stateButton).toBeDisabled();
    });

    test('renders both Phase 1 cards with correct issuer names', async ({ page }) => {
        await loginAsHealthUser(page);
        await mockPaymentsBackend(page);
        await page.goto('/health/payments');

        const stateCard = page.getByTestId('payment-invoice-card-STATE');
        const platformCard = page.getByTestId('payment-invoice-card-PLATFORM');

        await expect(stateCard).toBeVisible({ timeout: 15_000 });
        // STATE card: account holder is the department.
        await expect(stateCard).toContainText('กรมการแพทย์แผนไทย');
        // PLATFORM card: account holder is Predictive AI Solution.
        await expect(platformCard).toContainText('Predictive AI Solution');

        // Footnote about two-money-flow rule is present once.
        await expect(page.getByText(/ทำไมต้องโอน 2 ครั้ง/).first()).toBeVisible();
    });
});
