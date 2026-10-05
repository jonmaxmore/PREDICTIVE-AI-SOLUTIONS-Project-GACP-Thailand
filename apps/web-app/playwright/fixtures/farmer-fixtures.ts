/**
 * ============================================================================
 * W1-A Farmer Journey Fixtures — Iter W1 (Loop W)
 * ============================================================================
 * Helper module for the full 9-stage HEALTH farmer journey Playwright spec
 * (`farmer-full-journey.spec.ts`). Keeps the canonical `fixtures.ts` file
 * untouched per I-004 (file-boundary discipline) — W1-A and W1-B both ship
 * their helpers as NEW files instead of editing the shared fixtures module.
 *
 * Dual-mode design (per RFC Success Criterion):
 *   - DEFAULT (no env var)         → mock all backend responses via
 *                                     Playwright route interception. Seeds
 *                                     applicant + invoice + cert states.
 *   - `E2E_LIVE_BACKEND=1`         → no-op; tests hit the real backend at
 *                                     localhost (Docker-compose-provisioned).
 *                                     The cutover team flips a single env
 *                                     var to switch from CI to T-3 smoke.
 *
 * The mock chain is **idempotent** — every helper can be called multiple
 * times (Playwright's most-recently-added route wins, so callers can layer
 * state transitions on top of the baseline).
 *
 * Stages covered (see spec for the full state machine):
 *   1. Sign-up / login                              → makes JWT + user row
 *   2. Wizard 1→9 (DRAFT)                           → POST /applications
 *   3. Document upload + submit (SUBMITTED →
 *      DOCUMENT_REVIEW_PENDING)                     → PATCH .../status
 *   4. Reviewer approval (DOC_APPROVED)             → mock backend transition
 *   5. Phase 1 payment (invoice + slip upload)      → POST /payments/slip
 *   6. CAR flag + correct + resubmit                → PATCH /car-resubmit
 *   7. Auditor PASS decision                        → POST /audit/decision
 *   8. Phase 2 payment + slip                       → POST /payments/slip
 *   9. CERTIFIED → /health/certificates             → GET /certificates/my
 */

import type { Page, Route } from '@playwright/test';
import { loginAsHealthUser, mockApi } from '../fixtures';
import { installMockAssetRoutes } from './mock-assets';

// ────────────────────────────────────────────────────────────────────────────
// Canonical IDs used across all 9 stages — keep stable so mock chain can
// thread state through the journey (re-routing replaces older handlers but
// keeps the IDs consistent).
// ────────────────────────────────────────────────────────────────────────────

export const W1A_APP_ID = 'app-w1a-farmer-001';
export const W1A_APP_NUMBER = 'APP-2026-W1A-00001';
export const W1A_USER_ID = 'health-user-w1a';
export const W1A_HEALTH_ID = '1234567890999';
export const W1A_EMAIL = 'farmer.w1a@test.local';

export const W1A_PHASE1_STATE_INV_ID = 'inv-w1a-ph1-state';
export const W1A_PHASE1_PLATFORM_INV_ID = 'inv-w1a-ph1-platform';
export const W1A_PHASE2_STATE_INV_ID = 'inv-w1a-ph2-state';
export const W1A_PHASE2_PLATFORM_INV_ID = 'inv-w1a-ph2-platform';

export const W1A_AUDIT_ID = 'audit-w1a-001';
export const W1A_CERT_ID = 'cert-w1a-001';
export const W1A_CERT_NUMBER = 'GACP-TH-2026-W1A';

// ────────────────────────────────────────────────────────────────────────────
// Mode helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when E2E_LIVE_BACKEND=1 is set — used by helpers and tests
 * to short-circuit the mock chain and let the real backend respond. The
 * default (empty / "0" / undefined) returns FALSE so CI keeps using mocks.
 */
export function expectLiveBackend(): boolean {
    return process.env.E2E_LIVE_BACKEND === '1';
}

// ────────────────────────────────────────────────────────────────────────────
// Payload builders — kept tiny + composable so individual stages can
// override only the field that changes per state transition.
// ────────────────────────────────────────────────────────────────────────────

type ApplicationStatus =
    | 'DRAFT'
    | 'SUBMITTED'
    | 'DOCUMENT_REVIEW_PENDING'
    | 'DOC_APPROVED'
    | 'PHASE_1_PAYMENT_PENDING'
    | 'AUDIT_FEE_PAID'
    | 'CAR_PENDING'
    | 'CAR_RESUBMITTED'
    | 'AUDIT_SCHEDULED'
    | 'AUDIT_PASSED'
    | 'PHASE_2_PAYMENT_PENDING'
    | 'CERTIFIED';

export function buildApplicationPayload(opts: {
    status?: ApplicationStatus;
    carItems?: Array<{ id: string; issue: string; requirement: string }>;
} = {}) {
    const { status = 'DRAFT', carItems } = opts;
    return {
        success: true,
        data: {
            id: W1A_APP_ID,
            _id: W1A_APP_ID,
            applicationNumber: W1A_APP_NUMBER,
            status,
            stage: status,
            serviceType: 'new_application',
            plantCode: 'CANNABIS',
            plantType: 'กัญชา',
            farmName: 'สวนสมุนไพรลุงมานพ',
            applicantName: 'สมชาย ใจดี',
            formData: carItems ? { carItems } : undefined,
            carItems,
            submittedAt: '2026-05-16T03:00:00.000Z',
            createdAt: '2026-05-15T03:00:00.000Z',
            updatedAt: new Date().toISOString(),
        },
    };
}

export function buildPhase1InvoicePayload(opts: { stateIsPaid?: boolean; platformIsPaid?: boolean } = {}) {
    const { stateIsPaid = false, platformIsPaid = false } = opts;
    return {
        success: true,
        data: [
            {
                id: W1A_PHASE1_STATE_INV_ID,
                documentNumber: 'INV-W1A-PH1-STATE-00001',
                invoiceNumber: 'INV-W1A-PH1-STATE-00001',
                applicationId: W1A_APP_ID,
                application: { id: W1A_APP_ID, applicationNumber: W1A_APP_NUMBER },
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
                id: W1A_PHASE1_PLATFORM_INV_ID,
                documentNumber: 'INV-W1A-PH1-PLAT-00001',
                invoiceNumber: 'INV-W1A-PH1-PLAT-00001',
                applicationId: W1A_APP_ID,
                application: { id: W1A_APP_ID, applicationNumber: W1A_APP_NUMBER },
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

export function buildPhase2InvoicePayload(opts: { stateIsPaid?: boolean; platformIsPaid?: boolean } = {}) {
    const { stateIsPaid = false, platformIsPaid = false } = opts;
    return {
        success: true,
        data: [
            {
                id: W1A_PHASE2_STATE_INV_ID,
                documentNumber: 'INV-W1A-PH2-STATE-00001',
                invoiceNumber: 'INV-W1A-PH2-STATE-00001',
                applicationId: W1A_APP_ID,
                application: { id: W1A_APP_ID, applicationNumber: W1A_APP_NUMBER },
                amount: 25000,
                totalAmount: 25000,
                status: stateIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                erpStatus: stateIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                createdAt: '2026-05-18T03:00:00.000Z',
                serviceType: 'PHASE_2_STATE_FEE',
                lineItems: [
                    {
                        lineNumber: 1,
                        code: 'PHASE_2_STATE',
                        description: 'ค่าธรรมเนียมรัฐ (งวดที่ 2 — ออกใบรับรอง)',
                        quantity: 1,
                        unitPrice: 25000,
                        amount: 25000,
                        phase: 'PHASE_2',
                        isTaxable: false,
                    },
                ],
            },
            {
                id: W1A_PHASE2_PLATFORM_INV_ID,
                documentNumber: 'INV-W1A-PH2-PLAT-00001',
                invoiceNumber: 'INV-W1A-PH2-PLAT-00001',
                applicationId: W1A_APP_ID,
                application: { id: W1A_APP_ID, applicationNumber: W1A_APP_NUMBER },
                amount: 2675,
                totalAmount: 2675,
                status: platformIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                erpStatus: platformIsPaid ? 'PAID_PENDING_RECEIPT' : 'PENDING',
                createdAt: '2026-05-18T03:00:00.000Z',
                serviceType: 'PHASE_2_PLATFORM_FEE',
                lineItems: [
                    {
                        lineNumber: 1,
                        code: 'PHASE_2_PLATFORM',
                        description: 'ค่าบริการแพลตฟอร์ม (งวดที่ 2)',
                        quantity: 1,
                        unitPrice: 2500,
                        amount: 2500,
                        phase: 'PHASE_2',
                        isTaxable: true,
                    },
                    {
                        lineNumber: 2,
                        code: 'VAT',
                        description: 'ภาษีมูลค่าเพิ่ม 7%',
                        quantity: 1,
                        unitPrice: 175,
                        amount: 175,
                        phase: 'PHASE_2',
                        isTaxable: false,
                    },
                ],
            },
        ],
    };
}

export function buildCertificatePayload(opts: { issuedAt?: string } = {}) {
    const issuedDate = opts.issuedAt ?? new Date().toISOString();
    const expiryDate = new Date(
        new Date(issuedDate).getTime() + 3 * 365 * 86_400_000,
    ).toISOString();
    return {
        success: true,
        data: [
            {
                _id: W1A_CERT_ID,
                id: W1A_CERT_ID,
                certificateNumber: W1A_CERT_NUMBER,
                applicationId: W1A_APP_ID,
                farmId: 'farm-w1a-001',
                siteName: 'สวนสมุนไพรลุงมานพ',
                plantType: 'กัญชา',
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
                crops: ['กัญชา'],
                audit: {
                    score: 95,
                    auditorName: 'นาง สมศรี ใจดี',
                    lastAuditDate: issuedDate,
                },
            },
        ],
    };
}

const ISSUER_STATE_PH1 = {
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

const ISSUER_PLATFORM_PH1 = {
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

const ISSUER_STATE_PH2 = {
    ...ISSUER_STATE_PH1,
    data: { ...ISSUER_STATE_PH1.data, serviceType: 'PHASE_2_STATE_FEE' },
};

const ISSUER_PLATFORM_PH2 = {
    ...ISSUER_PLATFORM_PH1,
    data: { ...ISSUER_PLATFORM_PH1.data, serviceType: 'PHASE_2_PLATFORM_FEE' },
};

const BANK_ACTIVE_STATE_PH1 = {
    success: true,
    data: {
        bankCode: 'KTB',
        bankName: 'กรุงไทย',
        accountNumber: '059-0-12345-6',
        accountHolder: 'กรมการแพทย์แผนไทย',
        branchName: 'นนทบุรี',
        promptpayId: '0994000165340',
        promptpayQrPayload: ISSUER_STATE_PH1.data.bankAccount.promptpayQrPayload,
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Helper: ensure the farmer is "signed in" (mock mode — JWT seeded into
// localStorage; live mode — orchestrator assumes a pre-seeded test user via
// the standard `apps/backend/scripts/test/seed-test-users.js` pipeline).
// ────────────────────────────────────────────────────────────────────────────

export async function signInAsFarmer(page: Page): Promise<void> {
    if (expectLiveBackend()) {
        // Live mode: nothing to mock. The spec drives the real login screen
        // via UI interactions (typed in by Stage 1). We still set a baseline
        // localStorage so the wizard's auto-save hook doesn't fight us.
        return;
    }

    // loginAsHealthUser now delegates to the shared `applySession`
    // dual-write seeder in ../fixtures.ts — it writes BOTH storage-key
    // generations (canonical `accessToken`/`user` per STORAGE_KEYS in
    // src/lib/services/auth-service.types.ts, plus legacy
    // `auth_token`/`auth_user`) and BOTH middleware cookies. No local
    // re-seeding needed anymore.
    await loginAsHealthUser(page, {
        id: W1A_USER_ID,
        healthId: W1A_HEALTH_ID,
        email: W1A_EMAIL,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Master mock chain — registers every endpoint the 9-stage journey touches.
// Idempotent: tests can layer state-transition overrides on top by calling
// page.unroute(pattern) + re-routing with a fresh handler.
// ────────────────────────────────────────────────────────────────────────────

export async function farmerJourneyMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) {
        // Live mode is a strict no-op — the real backend services every
        // request. The spec is responsible for any state seeding (which it
        // does via the standard `applicationService.createDraft` API).
        return;
    }

    // ── Stage 2 gating fetches: wizard config + server-side draft ──────
    // The step shell (application-step-page.tsx) now fetches BOTH of
    // these before rendering any step; a 503/unmocked response renders
    // the amber "unavailable, retry" state instead of the wizard.
    //   - GET /api/applications/config?plantId=… → success with no
    //     `steps` array = "backend answered, no per-plant override" →
    //     the full default step list (resolveActiveSteps in
    //     wizard-load-outcome.ts).
    //   - GET /api/applications/draft → 200 {success:true,data:null} is
    //     the canonical "no draft" response (classifyDraftResponse →
    //     'empty' → blank form).
    await mockApi(page, {
        route: /\/api\/applications\/config(\?.*)?$/,
        body: { success: true, data: {} },
    });
    await mockApi(page, {
        route: /\/api\/applications\/draft(\?.*)?$/,
        body: { success: true, data: null },
    });

    // ── Stage 2: DRAFT creation + wizard auto-save ─────────────────────
    // The wizard issues POST /applications when the user advances out of
    // step 1 (consent). We return a fresh DRAFT with the canonical id.
    await page.route('**/api/applications', async (route) => {
        const method = route.request().method();
        if (method === 'POST') {
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify(buildApplicationPayload({ status: 'DRAFT' })),
            });
            return;
        }
        // GET /applications (list) — return single-row list with current
        // status, used by the dashboard sanity check.
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: [buildApplicationPayload().data],
                }),
            });
            return;
        }
        await route.fallback();
    });

    // Per-application detail + status updates.
    await page.route(`**/api/applications/${W1A_APP_ID}`, async (route) => {
        const method = route.request().method();
        if (method === 'GET' || method === 'PATCH' || method === 'PUT') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(buildApplicationPayload({ status: 'DRAFT' })),
            });
            return;
        }
        await route.fallback();
    });

    // Applications-my list (used by /health/dashboard + sidebar).
    await mockApi(page, {
        route: /\/api\/applications\/my(\?.*)?$/,
        body: { success: true, data: [buildApplicationPayload().data] },
    });

    // Draft-document upload (Stage 3) — wizard step 8.
    await page.route('**/api/applications/draft-documents', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                fileUrl: '/mock/farmer-doc.pdf',
                documentId: `doc-w1a-${Date.now()}`,
            }),
        });
    });

    // Submit step (Stage 3 final transition).
    await page.route(`**/api/applications/${W1A_APP_ID}/submit`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildApplicationPayload({ status: 'DOCUMENT_REVIEW_PENDING' }),
            ),
        });
    });

    // Status-transition catch-all (PATCH /applications/{id}/status).
    await page.route(`**/api/applications/${W1A_APP_ID}/status`, async (route) => {
        if (route.request().method() !== 'PATCH' && route.request().method() !== 'PUT') {
            return route.fallback();
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildApplicationPayload({ status: 'DOC_APPROVED' }),
            ),
        });
    });

    // ── Q4 payment-terms consent gate (slip-upload-modal.tsx) ──────────
    // GET /consent tells the modal whether a PAYMENT_TERMS consent is
    // already granted (consents keyed BY CATEGORY, not an array); POST
    // /consent records the acknowledgment on submit. Return "not yet
    // granted" so the journey exercises the real first-time checkbox act
    // before the slip submit button enables.
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

    // ── Stage 5/8: Phase 1 + Phase 2 invoices ──────────────────────────
    // /invoices/my returns BOTH phases. Tests override per-stage using
    // page.unroute + mockApi to flip stateIsPaid / phase visibility.
    await page.route('**/api/invoices/my**', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(buildPhase1InvoicePayload()),
        });
    });

    // Phase 1 issuer + bank metadata.
    await mockApi(page, {
        route: /\/api\/finance\/issuers\/by-service-type\/PHASE_1_STATE_FEE/,
        body: ISSUER_STATE_PH1,
    });
    await mockApi(page, {
        route: /\/api\/finance\/issuers\/by-service-type\/PHASE_1_PLATFORM_FEE/,
        body: ISSUER_PLATFORM_PH1,
    });
    await mockApi(page, {
        route: /\/api\/payments\/bank-accounts\/active\?phase=PHASE_1/,
        body: BANK_ACTIVE_STATE_PH1,
    });

    // Phase 2 issuer + bank metadata (post-audit).
    await mockApi(page, {
        route: /\/api\/finance\/issuers\/by-service-type\/PHASE_2_STATE_FEE/,
        body: ISSUER_STATE_PH2,
    });
    await mockApi(page, {
        route: /\/api\/finance\/issuers\/by-service-type\/PHASE_2_PLATFORM_FEE/,
        body: ISSUER_PLATFORM_PH2,
    });
    await mockApi(page, {
        route: /\/api\/payments\/bank-accounts\/active\?phase=PHASE_2/,
        body: { ...BANK_ACTIVE_STATE_PH1, data: { ...BANK_ACTIVE_STATE_PH1.data } },
    });

    // Slip history is empty until the farmer uploads.
    await mockApi(page, {
        route: new RegExp(`/api/payments/slip/by-application/${W1A_APP_ID}`),
        body: { success: true, data: [] },
    });

    // Slip upload (Phase 1 + Phase 2 share the same endpoint).
    await page.route('**/api/payments/slip/upload', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    id: `slip-w1a-${Date.now()}`,
                    applicationId: W1A_APP_ID,
                    invoiceId: W1A_PHASE1_STATE_INV_ID,
                    phase: 'PHASE_1',
                    status: 'PENDING_REVIEW',
                    fileUrl: '/mock/slip-w1a.png',
                    fileMimeType: 'image/png',
                    fileSizeBytes: 1024,
                    bankRef: 'TRX-W1A-001',
                    transferredAt: new Date().toISOString(),
                    amountClaimed: 5000,
                    uploadedBy: W1A_USER_ID,
                    uploadedAt: new Date().toISOString(),
                },
            }),
        });
    });

    // ── Stage 6: CAR (Corrective Action Request) ───────────────────────
    // CAR upload endpoint (the /health/applications/{id}/car page uses
    // POST /api/applications/{id}/car-resubmit to surface corrected docs).
    await page.route(`**/api/applications/${W1A_APP_ID}/car-resubmit`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildApplicationPayload({ status: 'CAR_RESUBMITTED' }),
            ),
        });
    });

    // Generic CAR document upload (multipart) — older route also exists
    // at /api/applications/{id}/upload-car-doc; cover both shapes.
    await page.route(`**/api/applications/${W1A_APP_ID}/upload-car-doc`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: { documentId: `car-doc-w1a-${Date.now()}`, fileUrl: '/mock/car.pdf' },
            }),
        });
    });

    // ── Stage 7: Audit decision (mock — Stage 7 simulates the AUDITOR
    // posting AUDIT_PASSED via the standard onsite-audit decision endpoint).
    await page.route(`**/api/audit/onsite/${W1A_AUDIT_ID}/decision`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    auditId: W1A_AUDIT_ID,
                    applicationId: W1A_APP_ID,
                    decision: 'PASS',
                    decidedAt: new Date().toISOString(),
                    summary: 'ฟาร์มผ่านเกณฑ์ทุกข้อ',
                },
            }),
        });
    });

    // Audit detail (Stage 6 surfaces the scheduled audit so the farmer
    // knows when the on-site inspection is).
    await mockApi(page, {
        route: new RegExp(`/api/audit/onsite/${W1A_AUDIT_ID}`),
        body: {
            success: true,
            data: {
                id: W1A_AUDIT_ID,
                applicationId: W1A_APP_ID,
                scheduledDate: '2026-05-23',
                scheduledTime: '09:00',
                auditorId: 'auditor-w1a',
                auditorName: 'นาง สมศรี ใจดี',
                status: 'SCHEDULED',
            },
        },
    });

    // ── Stage 9: Certificate list — initially empty (pre-CERTIFIED) ────
    await page.route(/\/api\/certificates\/my(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
        });
    });

    // Per-cert detail.
    await mockApi(page, {
        route: new RegExp(`/api/certificates/${W1A_CERT_ID}$`),
        body: buildCertificatePayload(),
    });
}

// ────────────────────────────────────────────────────────────────────────────
// State-transition helpers — call these from within tests to advance the
// mocked backend forward through the 9-stage journey. Each helper unroutes
// the relevant pattern and re-installs a handler that returns the next
// state. No-op in live mode (the real backend is responsible).
// ────────────────────────────────────────────────────────────────────────────

export async function advanceToDocApproved(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute(`**/api/applications/${W1A_APP_ID}`);
    await page.route(`**/api/applications/${W1A_APP_ID}`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(buildApplicationPayload({ status: 'DOC_APPROVED' })),
        });
    });
}

export async function advanceToPhase1Paid(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute('**/api/invoices/my**');
    await page.route('**/api/invoices/my**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildPhase1InvoicePayload({ stateIsPaid: true, platformIsPaid: true }),
            ),
        });
    });
}

export async function advanceToCarPending(
    page: Page,
    carItems: Array<{ id: string; issue: string; requirement: string }> = [
        {
            id: 'car-item-1',
            issue: 'เอกสารทะเบียนเกษตรกรหมดอายุ',
            requirement: 'ส่งสำเนาทะเบียนเกษตรกรล่าสุด (ภายใน 90 วัน)',
        },
    ],
): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute(`**/api/applications/${W1A_APP_ID}`);
    await page.route(`**/api/applications/${W1A_APP_ID}`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildApplicationPayload({ status: 'CAR_PENDING', carItems }),
            ),
        });
    });
}

export async function advanceToAuditScheduled(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute(`**/api/applications/${W1A_APP_ID}`);
    await page.route(`**/api/applications/${W1A_APP_ID}`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildApplicationPayload({ status: 'AUDIT_SCHEDULED' }),
            ),
        });
    });
}

export async function advanceToAuditPassed(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute(`**/api/applications/${W1A_APP_ID}`);
    await page.route(`**/api/applications/${W1A_APP_ID}`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildApplicationPayload({ status: 'AUDIT_PASSED' }),
            ),
        });
    });
    // Surface Phase 2 invoices now that audit passed.
    await page.unroute('**/api/invoices/my**');
    await page.route('**/api/invoices/my**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(buildPhase2InvoicePayload()),
        });
    });
}

export async function advanceToPhase2Paid(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute('**/api/invoices/my**');
    await page.route('**/api/invoices/my**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                buildPhase2InvoicePayload({ stateIsPaid: true, platformIsPaid: true }),
            ),
        });
    });
}

export async function advanceToCertified(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute(`**/api/applications/${W1A_APP_ID}`);
    await page.route(`**/api/applications/${W1A_APP_ID}`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(buildApplicationPayload({ status: 'CERTIFIED' })),
        });
    });
    // Surface the newly-issued certificate on /health/certificates.
    await page.unroute(/\/api\/certificates\/my(\?.*)?$/);
    await page.route(/\/api\/certificates\/my(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(buildCertificatePayload()),
        });
    });
}
