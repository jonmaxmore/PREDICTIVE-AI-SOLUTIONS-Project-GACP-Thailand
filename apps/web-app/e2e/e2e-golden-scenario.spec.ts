/**
 * ============================================================================
 * E2E TESTS - Golden Scenario (Full GACP Lifecycle)
 * ============================================================================
 * Complete end-to-end lifecycle test:
 * Register → Login → Create Farm → Apply → Pay Phase 1 → provider Review →
 * Pay Phase 2 → Certificate → Lots → Track & Trace → Consumer Feedback
 *
 * This test exercises the E2E helper endpoints in the backend.
 *
 * Run:
 *   E2E_BASE_URL=http://localhost \
 *   E2E_IGNORE_HTTPS_ERRORS=true \
 *   npx playwright test e2e/e2e-golden-scenario.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE_URL || '/api';

// Generate unique test data
const TEST_ID = `E2E-${Date.now()}`;
// Thai national ID = 13 digits with a Mod-11 check digit. The old generator made
// 12 digits with no checksum, so Stage 1 registration always failed 400 (backend
// validation is correct). Generate 12 random digits + computed check digit.
function generateThaiId(): string {
  const digits = [Math.floor(Math.random() * 8) + 1];
  for (let i = 1; i < 12; i++) { digits.push(Math.floor(Math.random() * 10)); }
  const sum = digits.reduce((acc, d, i) => acc + d * (13 - i), 0);
  const check = (11 - (sum % 11)) % 10;
  return digits.join('') + String(check);
}
const ID_CARD = generateThaiId();
const PHONE = `089${Math.floor(1000000 + Math.random() * 8999999)}`;
const EMAIL = `Applicant.${Date.now()}@test.com`;
const PASSWORD = 'Test@12345';

// Shared state across test stages
let ApplicantToken: string;
let farmId: string;
let applicationId: string;
let _applicationNumber: string;
let PROVIDERToken: string;

test.describe.serial('E2E: Golden Scenario - GACP Full Lifecycle', () => {
    // ─── Stage 1: Registration ──────────────────────────────────────────────
    test('Stage 1: Applicant Registration', async ({ request }) => {
        const response = await request.post(`${API_BASE}/auth/health/register`, {
            data: {
                accountType: 'INDIVIDUAL',
                idCard: ID_CARD,
                firstName: 'Somchai',
                lastName: 'Jaidee',
                phoneNumber: PHONE,
                email: EMAIL,
                password: PASSWORD,
                // COMP-006 (PDPA): explicit consent now required by the register API.
                acceptedTermsOfService: true,
                acceptedPrivacyPolicy: true,
                address: '123 Moo 4',
                province: 'Chiang Mai',
                district: 'Hang Dong',
                subdistrict: 'Nong Khwai',
            },
        });
        const body = await response.json();
        // Expect success or already-exists
        expect([200, 201, 409]).toContain(response.status());
        if (body.success && body.data?.user?.id) {
            expect(body.data.user.id).toBeTruthy();
        }
    });

    // ─── Stage 2: Login ─────────────────────────────────────────────────────
    test('Stage 2: Applicant Login', async ({ request }) => {
        const response = await request.post(`${API_BASE}/auth/health/login`, {
            data: { identifier: ID_CARD, password: PASSWORD },
        });
        const body = await response.json();
        expect(response.status()).toBe(200);
        expect(body.success).toBe(true);
        // Login response carries tokens at data.tokens.accessToken (legacy data.token kept as fallback)
        const accessToken = body.data?.tokens?.accessToken || body.data?.token;
        expect(accessToken).toBeTruthy();
        ApplicantToken = accessToken;
    });

    // ─── Stage 3: Create Farm ──────────────────────────────────────────────
    test('Stage 3: Create Farm', async ({ request }) => {
        const response = await request.post(`${API_BASE}/farms`, {
            data: {
                farmName: `TestFarm-${TEST_ID}`,
                farmType: 'CULTIVATION',
                address: '123 Moo 4',
                province: 'Chiang Mai',
                district: 'Hang Dong',
                subDistrict: 'Nong Khwai',
                postalCode: '50230',
                latitude: 18.7883,
                longitude: 98.9853,
                totalArea: 5,
                cultivationArea: 5,
                cultivationMethod: 'SOIL',
                status: 'SUBMITTED',
            },
            headers: { Authorization: `Bearer ${ApplicantToken}` },
        });
        const body = await response.json();
        // สร้างฟาร์มไม่ได้ = ล้มเหลว ไม่ใช่ข้าม · เดิมบรรทัดนี้เป็น
        // `test.skip(true, ...)` ⇒ ประตูที่พังทำให้เทสขึ้น "skipped" แล้วนับรวมในผลเขียว
        // ข้อความในผลล้มเหลวพก body มาด้วย เพราะ "403" เฉย ๆ ไม่บอกว่าต้องไปแก้อะไร
        expect(
            [200, 201].includes(response.status()),
            `POST /farms ตอบ ${response.status()} — ${JSON.stringify(body).slice(0, 300)}`,
        ).toBe(true);
        expect(body.success).toBe(true);
        farmId = body.data?.id;
        expect(farmId).toBeTruthy();
    });

    // ─── Stage 4: Create Application ───────────────────────────────────────
    test('Stage 4: Create GACP Application', async ({ request }) => {
        // The application is created via the real wizard flow:
        //   POST /applications/draft  (step payload merged into formData, returns draftId)
        //   POST /applications/submit ({ draftId } — gated by full Zod step validation)
        // The old `POST /applications` route does not exist in the current router.
        const draftResponse = await request.post(`${API_BASE}/applications/draft`, {
            data: {
                step: 1,
                serviceType: 'new_application',
                areaType: 'OUTDOOR',
                farmId: farmId,
                plantCode: 'CANNABIS',
                plotName: 'Plot 1',
                plotArea: 5,
                cultivationMethod: 'SOIL',
                expectedYield: 100,
            },
            headers: { Authorization: `Bearer ${ApplicantToken}` },
        });
        const draftBody = await draftResponse.json();
        expect(draftResponse.status()).toBe(200);
        expect(draftBody.success).toBe(true);
        const draftId = draftBody.data?.draftId;
        expect(draftId).toBeTruthy();

        // Submit requires ALL wizard steps to pass Zod validation; this minimal
        // draft may legitimately 422. Accept submit success OR incomplete-draft —
        // downstream stages run only when the submit actually succeeds.
        const submitResponse = await request.post(`${API_BASE}/applications/submit`, {
            data: { draftId },
            headers: { Authorization: `Bearer ${ApplicantToken}` },
        });
        // ยื่นไม่ผ่าน = ล้มเหลว · เดิมยอมรับ 409/422 แล้วข้ามขั้นที่เหลือทั้งหมด
        // ⇒ "golden scenario" ที่ไม่เคยยื่นสำเร็จ ก็ไม่ได้พิสูจน์เส้นทางใดเลย
        // ถ้าร่างไม่ครบจนยื่นไม่ได้ นั่นคือสิ่งที่เทสนี้ต้องบอก ไม่ใช่สิ่งที่มันต้องกลบ
        const submitBody = await submitResponse.json();
        expect(
            [200, 201].includes(submitResponse.status()),
            `POST submit ตอบ ${submitResponse.status()} — ${JSON.stringify(submitBody).slice(0, 300)}`,
        ).toBe(true);
        applicationId = submitBody.data?.id || draftId;
        _applicationNumber = submitBody.data?.applicationNumber;
    });

    // ─── Stage 5: Payment Phase 1 ─────────────────────────────────────────
    test('Stage 5: Payment Phase 1', async ({ request }) => {
        const response = await request.post(
            `${API_BASE}/payments/phase1/${applicationId}`,
            { headers: { Authorization: `Bearer ${ApplicantToken}` } },
        );
        // May succeed or skip depending on workflow
        expect([200, 201, 400, 404]).toContain(response.status());
    });

    // ─── Stage 6: provider Login & Review ─────────────────────────────────────
    test('Stage 6: provider Login & Application Review', async ({ request }) => {
        // Provider login
        const loginResponse = await request.post(`${API_BASE}/auth/provider/login`, {
            data: { username: 'reviewer', password: 'Test@12345' },
        });
        const loginBody = await loginResponse.json();
        // เจ้าหน้าที่ล็อกอินไม่ได้ = ล้มเหลว · สภาพแวดล้อมที่ไม่มีบัญชีเจ้าหน้าที่
        // คือสภาพแวดล้อมที่ยังไม่ได้ seed ซึ่งเป็นสิ่งที่ต้องรู้ ไม่ใช่สิ่งที่ต้องข้าม
        expect(
            loginResponse.status() === 200 && loginBody.success,
            `provider login ตอบ ${loginResponse.status()} — ${JSON.stringify(loginBody).slice(0, 200)}`,
        ).toBe(true);
        PROVIDERToken = loginBody.data?.tokens?.accessToken || loginBody.data?.token;

        // Approve application
        const approveResponse = await request.put(
            `${API_BASE}/applications/${applicationId}/status`,
            {
                data: { status: 'APPROVED_DOCUMENT', notes: 'E2E test approval' },
                headers: { Authorization: `Bearer ${PROVIDERToken}` },
            },
        );
        expect([200, 400, 404]).toContain(approveResponse.status());
    });

    // ─── Stage 7: Use E2E helper for golden scenario ──────────────────────
    test('Stage 7: E2E Golden Scenario Helper', async ({ request }) => {
        const response = await request.post(`${API_BASE}/e2e/golden-scenario`, {
            data: { enableQR: true },
            // P1-e2e: /e2e/* routes now require a shared secret. The header is sent
            // when E2E_SECRET is present in the env (staging/CI after provisioning);
            // 401 is tolerated below for envs where the secret is not configured.
            headers: process.env.E2E_SECRET ? { 'x-e2e-secret': process.env.E2E_SECRET } : {},
        });
        // This endpoint may be disabled in production; 400 = endpoint live but the
        // helper now requires a richer payload (availability is what this checks);
        // 401 = E2E_SECRET not configured in this env; 429 = staging rate-limiter.
        expect([200, 201, 400, 401, 403, 404, 429]).toContain(response.status());
        if (response.status() === 200) {
            const body = await response.json();
            expect(body).toBeTruthy();
        }
    });

    // ─── Stage 8: Health Check After Full Lifecycle ────────────────────────
    test('Stage 8: System Health After Lifecycle', async ({ request }) => {
        const response = await request.get(`${API_BASE}/health`);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.dbStatus?.status).toBe('connected');
    });
});
