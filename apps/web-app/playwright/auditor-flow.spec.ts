/**
 * ============================================================================
 * E2E — Auditor Flow (Iter 25)
 * ============================================================================
 * Second mocked end-to-end spec, covering the scheduler-to-auditor hand-off:
 *
 *   1. SCHEDULER user lands on /provider/scheduler/queue, sees a list of
 *      applications with AUDIT_FEE_PAID status, opens the "จัดตาราง"
 *      modal on a row, picks date+time+auditor, and submits. The row
 *      then disappears from the queue.
 *
 *   2. AUDITOR user lands on /provider/audits/:id/inspect, the field
 *      app records a GPS check-in (geolocation is mocked to Bangkok),
 *      fills 3 checklist items as "ใช่", attaches a photo, submits a
 *      PASS decision with summary text, and lands on the "ส่งผลการตรวจ
 *      เรียบร้อย" success screen.
 *
 * Scope: Both backends (B25-A scheduler queue + assign route, B25-B
 * onsite audit start/checklist/photo/decision routes) are fully mocked
 * via page.route() handlers. Frontend B25-C is the only real code in
 * the loop. Iter 23 established this pattern in
 * `farmer-payment-flow.spec.ts`; this spec follows it.
 *
 * Run:
 *   cd apps/web-app
 *   npx playwright test playwright/auditor-flow.spec.ts --project=chromium
 */

import { test, expect, type Page } from '@playwright/test';
import {
    loginAsScheduler,
    loginAsAuditor,
    mockApi,
    mockGeolocation,
} from './fixtures';

// ────────────────────────────────────────────────────────────────────────────
// Shared test data
// ────────────────────────────────────────────────────────────────────────────

/**
 * Queue rows in the CURRENT SchedulingQueueItem shape consumed by
 * `src/app/provider/scheduler/queue/client-view.tsx` via
 * `AuditService.getSchedulingQueue()` — the queue endpoint is
 * GET /api/audit/scheduling/queue and the payload is `{ items, summary }`
 * (see SchedulingQueueResponse in src/lib/services/audit-service.ts).
 * `farmAddress` matters: the AssignAuditorModal prefills its required
 * "สถานที่ตรวจ" field from it.
 */
const QUEUE_ITEMS = [
    {
        applicationId: 'app-iter25-q1',
        applicationNumber: 'APP-2026-00011',
        applicantName: 'มานพ ปลูกดี',
        applicantNameMasked: 'มานพ ปลูกดี',
        plantType: 'กัญชา',
        status: 'AUDIT_FEE_PAID',
        region: 'NORTH',
        scope: 'GACP_FULL',
        paymentDate: '2026-05-15T03:00:00.000Z',
        ageDays: 3,
        farmAddress: '99 หมู่ 5 ต.แม่ริม อ.แม่ริม จ.เชียงใหม่ 50180',
    },
    {
        applicationId: 'app-iter25-q2',
        applicationNumber: 'APP-2026-00012',
        applicantName: 'สุภาพ สมุนไพร',
        applicantNameMasked: 'สุภาพ สมุนไพร',
        plantType: 'ขมิ้นชัน',
        status: 'AUDIT_FEE_PAID',
        region: 'NORTHEAST',
        scope: 'GACP_FULL',
        paymentDate: '2026-05-15T04:00:00.000Z',
        ageDays: 2,
        farmAddress: '12 หมู่ 1 ต.ในเมือง อ.เมือง จ.นครพนม 48000',
    },
    {
        applicationId: 'app-iter25-q3',
        applicationNumber: 'APP-2026-00013',
        applicantName: 'วันดี รักษ์สมุนไพร',
        applicantNameMasked: 'วันดี รักษ์สมุนไพร',
        plantType: 'กระชายดำ',
        status: 'AUDIT_FEE_PAID',
        region: 'NORTHEAST',
        scope: 'GACP_FULL',
        paymentDate: '2026-05-15T05:00:00.000Z',
        ageDays: 1,
        farmAddress: '55 หมู่ 3 ต.วารินชำราบ อ.วารินชำราบ จ.อุบลราชธานี 34190',
    },
];

function buildQueueResponse(items: typeof QUEUE_ITEMS) {
    return {
        success: true,
        data: {
            items,
            summary: {
                totalPending: items.length,
                oldestPendingDays: items.reduce((max, it) => Math.max(max, it.ageDays), 0),
                byRegion: Object.entries(
                    items.reduce<Record<string, number>>((acc, it) => {
                        acc[it.region] = (acc[it.region] || 0) + 1;
                        return acc;
                    }, {}),
                ).map(([region, count]) => ({ region, count })),
            },
        },
    };
}

/**
 * Auditor directory in the shape of GET /api/provider/scheduler/auditors
 * (AuditService.getAuditors) — the modal renders `fullName` in its
 * native <select>.
 */
const AUDITOR_DIRECTORY = [
    {
        id: 'auditor-iter25',
        providerId: 'auditor-iter25',
        firstName: 'สมศรี',
        lastName: 'ใจดี',
        fullName: 'นาง สมศรี ใจดี',
        role: 'AUDITOR',
        canonicalRole: 'AUDITOR',
        workload: 2,
    },
    {
        id: 'auditor-iter25-2',
        providerId: 'auditor-iter25-2',
        firstName: 'มานะ',
        lastName: 'อดทน',
        fullName: 'นาย มานะ อดทน',
        role: 'AUDITOR',
        canonicalRole: 'AUDITOR',
        workload: 4,
    },
];

function requireFixture<T>(value: T | undefined, name: string): T {
    if (value === undefined) {
        throw new Error(`auditor-flow.spec fixture ${name} must be defined`);
    }
    return value;
}

const PRIMARY_QUEUE_ITEM = requireFixture(QUEUE_ITEMS[0], 'QUEUE_ITEMS[0]');
const PRIMARY_AUDITOR = requireFixture(AUDITOR_DIRECTORY[0], 'AUDITOR_DIRECTORY[0]');

const AUDIT_ID = 'audit-iter25-001';
const APP_ID = 'app-iter25-q1';

/**
 * Onsite-audit context in the CURRENT shape consumed by the field-app
 * island `src/app/provider/audits/[id]/inspect/client-view.tsx` via
 * `AuditService.getOnsiteContext()` — GET /api/audit/onsite/:id/context
 * returning `{ audit, checklist, startedAt, savedAnswers }` with
 * checklist rows keyed `itemId` + `title` + `description`.
 */
const ONSITE_CONTEXT = {
    success: true,
    data: {
        audit: {
            id: AUDIT_ID,
            applicationId: APP_ID,
            applicationNumber: 'APP-2026-00011',
            applicantName: 'มานพ ปลูกดี',
            farmAddress: '99 หมู่ 5 ต.แม่ริม อ.แม่ริม จ.เชียงใหม่ 50180',
            farmLat: 13.7563,
            farmLng: 100.5018,
            scope: 'GACP_FULL',
        },
        checklist: [
            {
                itemId: 'item-1',
                title: 'พื้นที่ปลูก',
                description: 'พื้นที่ปลูกอยู่ห่างจากแหล่งปนเปื้อนอย่างน้อย 30 เมตร',
                category: 'พื้นที่ปลูก',
                required: true,
            },
            {
                itemId: 'item-2',
                title: 'การจัดการศัตรูพืช',
                description: 'มีการบันทึกการใช้สารชีวภัณฑ์ครบถ้วน',
                category: 'การจัดการศัตรูพืช',
                required: true,
            },
            {
                itemId: 'item-3',
                title: 'การเก็บเกี่ยว',
                description: 'มีพื้นที่จัดเก็บผลผลิตที่ปลอดภัยและสะอาด',
                category: 'การเก็บเกี่ยว',
                required: true,
            },
        ],
        startedAt: null,
        savedAnswers: [],
    },
};

// 7 days from "today" (2026-05-16) → 2026-05-23
const SCHEDULE_DATE = '2026-05-23';

// ────────────────────────────────────────────────────────────────────────────
// Mock setup helpers
// ────────────────────────────────────────────────────────────────────────────

async function mockSchedulerBackend(page: Page) {
    // The CURRENT scheduler queue page (client-view.tsx) fetches:
    //  - GET /api/audit/scheduling/queue?status=…       → { items, summary }
    //  - GET /api/provider/scheduler/auditors           → auditor dropdown
    //  - GET /api/audit/scheduling/auditor-availability/:id?from&to
    //  - POST /api/audit/scheduling/assign              → submit
    await mockApi(page, {
        route: /\/api\/audit\/scheduling\/queue(\?.*)?$/,
        body: buildQueueResponse(QUEUE_ITEMS),
    });
    await mockApi(page, {
        route: /\/api\/provider\/scheduler\/auditors(\?.*)?$/,
        body: { success: true, data: AUDITOR_DIRECTORY },
    });
    await mockApi(page, {
        route: /\/api\/audit\/scheduling\/auditor-availability\/[^/?]+(\?.*)?$/,
        body: {
            success: true,
            data: {
                auditorId: PRIMARY_AUDITOR.id,
                auditorName: PRIMARY_AUDITOR.fullName,
                busySlots: [],
                overCapDays: [],
                cap: 2,
            },
        },
    });

    // POST /api/audit/scheduling/assign — canonical B25-A backend route
    // (AuditService.assignAuditor). Returns the freshly-created
    // inspection so the modal can toast + close.
    await page.route('**/api/audit/scheduling/assign', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    inspectionId: AUDIT_ID,
                    auditId: AUDIT_ID,
                    applicationId: APP_ID,
                    scheduledDate: SCHEDULE_DATE,
                    scheduledSlot: 'AM',
                    auditorId: PRIMARY_AUDITOR.id,
                    auditorName: PRIMARY_AUDITOR.fullName,
                },
            }),
        });
    });
}

async function mockAuditorBackend(page: Page) {
    // The auditor field-app screen expects:
    //  - GET /api/audit/onsite/:id/context  → audit + checklist + drafts
    //  - POST /api/audit/onsite/:id/start   → marks audit as IN_PROGRESS
    //  - POST /api/audit/onsite/:id/checklist → per-item draft upsert
    //  - POST /api/audit/onsite/:id/photo   → multipart upload
    //  - POST /api/audit/onsite/:id/decision → final PASS/FAIL submission
    // Task 12 carried requirement (Ruling 9): the context route is keyed by
    // applicationId, not auditId — intercept the request the FE will
    // actually make (APP_ID), distinct from AUDIT_ID below. Previously both
    // constants were the SAME string here, which made "FE correctly reads
    // ctx.audit.id" and "FE regressed to reusing the route param as the
    // auditId" produce an identical, indistinguishable green.
    await mockApi(page, {
        route: new RegExp(`/api/audit/onsite/application/${APP_ID}/context$`),
        body: ONSITE_CONTEXT,
    });

    await page.route(`**/api/audit/onsite/${AUDIT_ID}/start`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    auditId: AUDIT_ID,
                    status: 'IN_PROGRESS',
                    startedAt: new Date().toISOString(),
                },
            }),
        });
    });

    await page.route(`**/api/audit/onsite/${AUDIT_ID}/checklist`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: { auditId: AUDIT_ID, itemsSaved: 3 },
            }),
        });
    });

    await page.route(`**/api/audit/onsite/${AUDIT_ID}/photo`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    photoId: 'photo-iter25-001',
                    auditId: AUDIT_ID,
                    fileUrl: '/mock/audit-photo.png',
                    fileMimeType: 'image/png',
                    fileSizeBytes: 2048,
                    capturedAt: new Date().toISOString(),
                },
            }),
        });
    });

    await page.route(`**/api/audit/onsite/${AUDIT_ID}/decision`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    auditId: AUDIT_ID,
                    decision: 'PASS',
                    decidedAt: new Date().toISOString(),
                    decidedBy: 'auditor-iter25',
                    summary: 'ฟาร์มผ่านเกณฑ์ทุกข้อ',
                },
            }),
        });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Test 1 — Scheduler assigns auditor
// ────────────────────────────────────────────────────────────────────────────

test.describe.serial('E2E: Auditor Flow (Iter 25)', () => {
    test('scheduler picks audit slot + auditor; row removed from queue', async ({ page }) => {
        // ── Step 1 — Login as SCHEDULER ──────────────────────────────
        await loginAsScheduler(page);

        // ── Step 2 — Wire scheduler-side mocks BEFORE navigation ─────
        await mockSchedulerBackend(page);

        // ── Step 3 — Navigate to /provider/scheduler/queue ───────────
        await page.goto('/provider/scheduler/queue');
        await page.waitForLoadState('domcontentloaded');

        // ── Step 4 — Verify 3 rows render ────────────────────────────
        // The queue is a shared finance <DataTable> (real <table>/<tr>
        // markup, no per-row testid) — assert on the application numbers.
        await expect(page.getByText('APP-2026-00011')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('APP-2026-00012')).toBeVisible();
        await expect(page.getByText('APP-2026-00013')).toBeVisible();

        // ── Step 5 — Open assignment modal on the first row ──────────
        // Scope to the <tr> containing the application number, then click
        // its "จัดตาราง" action button.
        const firstRowScope = page
            .locator('tr')
            .filter({ hasText: 'APP-2026-00011' })
            .first();
        await firstRowScope.getByRole('button', { name: /จัดตาราง/ }).click();

        // The AssignAuditorModal title appears.
        await expect(
            page.getByRole('heading', { name: /จัดตารางตรวจประเมินภาคสนาม/ }),
        ).toBeVisible({ timeout: 10_000 });

        // ── Step 6 — Pick date + slot + auditor ──────────────────────
        // Date input is #assign-date inside the modal (the page-level
        // FilterBar also has bare type=date inputs — do NOT use .first()
        // on input[type=date]). Slot is a 09:00/13:00 toggle (AM default);
        // click AM explicitly for determinism.
        await page.locator('#assign-date').fill(SCHEDULE_DATE);
        await page.getByRole('button', { name: '09:00 น.' }).click();

        // Auditor dropdown — native <select id="assign-auditor"> whose
        // options render the directory's `fullName`.
        await page.locator('#assign-auditor').selectOption({ label: 'นาง สมศรี ใจดี' });

        // Location — prefilled from the queue row's farmAddress; re-fill
        // so the required-field validation can never trip.
        await page.locator('#assign-location').fill(PRIMARY_QUEUE_ITEM.farmAddress);

        // ── Step 7 — Submit ──────────────────────────────────────────
        await page.getByRole('button', { name: /ยืนยันจัดตาราง/ }).click();

        // ── Step 8 — Verify success toast (sonner) + modal close ─────
        await expect(
            page.getByText(/จัดตารางเรียบร้อย/).first(),
        ).toBeVisible({ timeout: 10_000 });

        // ── Step 9 — Re-mock the queue to return 2 items ─────────────
        // (the assigned application has left the queue).
        await page.unroute(/\/api\/audit\/scheduling\/queue(\?.*)?$/);
        await mockApi(page, {
            route: /\/api\/audit\/scheduling\/queue(\?.*)?$/,
            body: buildQueueResponse(QUEUE_ITEMS.slice(1)),
        });

        // Some implementations refresh implicitly after the modal closes;
        // others expose a "รีเฟรช" button. Try both.
        const refreshButton = page.getByRole('button', { name: /^รีเฟรช$/ });
        if (await refreshButton.isVisible().catch(() => false)) {
            await refreshButton.click();
        } else {
            await page.reload();
        }

        // ── Step 10 — Assigned row no longer visible ─────────────────
        // Scope to table rows: the success toast ("มอบหมาย APP-2026-00011
        // ให้ผู้ตรวจแล้ว") may still be on screen, so a bare text lookup
        // would double-match while the toast auto-dismisses.
        await expect(
            page.locator('tr').filter({ hasText: 'APP-2026-00011' }),
        ).toHaveCount(0, { timeout: 10_000 });
        await expect(page.getByText('APP-2026-00012')).toBeVisible();
        await expect(page.getByText('APP-2026-00013')).toBeVisible();
    });

    // ────────────────────────────────────────────────────────────────────
    // Test 2 — Auditor conducts inspection
    // ────────────────────────────────────────────────────────────────────

    test('auditor inspects farm: GPS check-in, checklist PASS, photo, decision', async ({ page }) => {
        // ── Step 1 — Login as AUDITOR ────────────────────────────────
        await loginAsAuditor(page, { id: 'auditor-1' });

        // ── Step 2 — Mock GPS to Bangkok (13.7563, 100.5018) ─────────
        await mockGeolocation(page, { lat: 13.7563, lng: 100.5018, accuracy: 10 });

        // ── Step 3 — Wire auditor-side mocks BEFORE navigation ───────
        await mockAuditorBackend(page);

        // ── Step 4 — Navigate to /provider/audits/{id}/inspect ───────
        // The route [id] is the applicationId (Tasks 4/5/11) — navigate with
        // APP_ID, distinct from AUDIT_ID (see the context-mock comment in
        // mockAuditorBackend above). client-view.tsx reads route [id] as
        // applicationId, calls getOnsiteContext(applicationId), and resolves
        // the real auditId from the response's `context.audit.id` — the
        // start/checklist/photo/decision mocks below stay keyed on AUDIT_ID
        // on purpose, so a regression that reused the route param instead of
        // ctx.audit.id would now request an unmocked path and fail loudly.
        await page.goto(`/provider/audits/${APP_ID}/inspect`);
        await page.waitForLoadState('domcontentloaded');

        // The applicant name should render so we know the context loaded.
        await expect(page.getByText(/มานพ ปลูกดี/)).toBeVisible({ timeout: 15_000 });

        // ── Step 5 — Click "เริ่มตรวจ" ────────────────────────────────
        await page.getByRole('button', { name: /^เริ่มตรวจ$/ }).click();

        // POST /audit/onsite/:id/start mock returns IN_PROGRESS — the UI
        // advances to the checklist stage (progress header renders
        // "ความคืบหน้า 0/3").
        await expect(
            page.getByText(/ความคืบหน้า/).first(),
        ).toBeVisible({ timeout: 10_000 });

        // ── Step 6 — Mark all 3 checklist items as "ใช่" ─────────────
        // Each ChecklistItem card is an <article data-checklist-id={itemId}>
        // whose answer buttons carry role="radio" (see
        // src/components/audit/ChecklistItem.tsx).
        for (const item of ONSITE_CONTEXT.data.checklist) {
            await page
                .locator(`article[data-checklist-id="${item.itemId}"]`)
                .getByRole('radio', { name: 'ใช่', exact: true })
                .click();
        }

        // ── Step 7 — Upload 1 photo (mocked PNG buffer) ──────────────
        // One sr-only file input per checklist card; .first() targets
        // item-1. On success the card appends a pill with the file name.
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles({
            name: 'audit-photo-iter25.png',
            mimeType: 'image/png',
            // Same 1×1 transparent PNG used in Iter 23 (valid file)
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                'base64',
            ),
        });

        // Wait for the photo upload mock to be invoked + acknowledged —
        // the uploaded file's name renders in the photo pill.
        await expect(page.getByText('audit-photo-iter25.png').first()).toBeVisible({
            timeout: 10_000,
        });

        // ── Step 8 — Review → decision → submit PASS ─────────────────
        // The field-app is a staged flow: checklist → review → decision.
        // All 3 items answered enables "ทบทวนผลการตรวจ".
        await page.getByRole('button', { name: /ทบทวนผลการตรวจ/ }).click();
        await expect(page.getByText(/สรุปผลการตรวจ/).first()).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: /ไปที่หน้าตัดสินผล/ }).click();

        // Decision screen: PASS toggle + summary textarea + submit.
        await expect(
            page.getByRole('heading', { name: /ตัดสินผลการตรวจ/ }),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: 'ผ่าน', exact: true }).click();
        await page
            .getByPlaceholder('สรุปผลการตรวจประเมินภาคสนาม')
            .fill('ฟาร์มผ่านเกณฑ์ทุกข้อ พบการจัดการที่ดี');
        await page.getByRole('button', { name: /^ส่งผลการตรวจ$/ }).click();

        // ── Step 9 — Verify success screen ───────────────────────────
        await expect(
            page.getByText(/ส่งผลการตรวจเรียบร้อย/),
        ).toBeVisible({ timeout: 15_000 });
    });
});
