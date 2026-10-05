/**
 * ============================================================================
 * W1-B DTAM Staff Journey Fixtures — Iter W1 (Loop W)
 * ============================================================================
 * Helper module for the full 11-stage DTAM staff Playwright spec
 * (`dtam-staff-full-journey.spec.ts`). Keeps the canonical `fixtures.ts` file
 * untouched per I-004 (file-boundary discipline) — W1-A and W1-B both ship
 * their helpers as NEW files instead of editing the shared fixtures module.
 *
 * Dual-mode design (per RFC Success Criterion):
 *   - DEFAULT (no env var)         → mock all backend responses via
 *                                     Playwright route interception. Seeds
 *                                     a single canonical application that
 *                                     threads from reviewer to admin handoff.
 *   - `E2E_LIVE_BACKEND=1`         → no-op; tests hit the real backend at
 *                                     localhost (Docker-compose-provisioned)
 *                                     so cutover ops can re-run the spec at
 *                                     T-3 against a seeded smoke env.
 *
 * The mock chain is **idempotent** — every helper can be called multiple
 * times (Playwright's most-recently-added route wins, so callers can layer
 * cross-role state transitions on top of the baseline).
 *
 * Stages covered (see spec for the full state machine):
 *   1.  DOC_REVIEWER opens review queue + application detail
 *   2.  DOC_REVIEWER marks 9 reviewedSteps and APPROVES (DR-4 gate)
 *   3.  SCHEDULER opens queue + AssignAuditorModal (SC-1 dropdown)
 *   4.  SCHEDULER reschedule scope (RB-3)
 *   5.  AUDITOR onsite mobile inspection with photo + GPS fallback
 *       (DI-1 mount + DM-4 fallback)
 *   6.  AUDITOR PASS decision (AUDIT_RESULT_PASSED template; R2-D cert auto)
 *   7.  ACCOUNT_DTAM reviews state-fee slip (V4-A admission)
 *   8.  ACCOUNT_PLATFORM reviews platform-fee slip (V4-B wallet badge filter)
 *   9.  ACCOUNT_PLATFORM closes period (R1-A)
 *   10. ACCOUNT_PLATFORM creates manual JE draft (R1-C)
 *   11. ADMIN searches audit log + triggers CSV export (V5-A + V5-D)
 *
 * I-002 compliance: any helper-local `catch (err)` / unused destructure
 * variables use `_` prefix. I-017 deferrals (if any during build) are
 * surfaced in the W1-B handoff doc's "## Out of scope" section.
 */

import type { Page, Route } from '@playwright/test';
import {
    applySession,
    loginAsScheduler,
    loginAsAuditor,
    loginAsAccountDtam,
    loginAsAccountPlatform,
    loginAsAdmin,
    mockApi,
    mockGeolocation,
} from '../fixtures';
import { installMockAssetRoutes } from './mock-assets';

// ────────────────────────────────────────────────────────────────────────────
// Canonical IDs — stable across the 11-stage chain so cross-role handoffs
// share the same application / audit / cert / user identifiers.
// ────────────────────────────────────────────────────────────────────────────

export const W1B_APP_ID = 'app-w1b-dtam-001';
export const W1B_APP_NUMBER = 'APP-2026-W1B-00001';
export const W1B_HEALTH_ID = '1234567890888';
export const W1B_HEALTH_USER_ID = 'health-user-w1b';
export const W1B_HEALTH_NAME = 'มานพ ปลูกดี';

export const W1B_REVIEWER_USER_ID = 'doc-reviewer-w1b';
export const W1B_REVIEWER_USERNAME = 'doc-reviewer-1';
export const W1B_REVIEWER_NAME = 'นาง สมหญิง ตรวจดี';

export const W1B_AUDITOR_ID = 'auditor-w1b';
export const W1B_AUDITOR_USERNAME = 'auditor-w1b-1';
export const W1B_AUDITOR_NAME = 'นาง สมศรี ใจดี';

export const W1B_SECOND_AUDITOR_ID = 'auditor-w1b-2';
export const W1B_SECOND_AUDITOR_NAME = 'นาย มานะ อดทน';

export const W1B_AUDIT_ID = 'audit-w1b-001';
export const W1B_RESCHEDULE_ID = 'reschedule-w1b-001';

export const W1B_CERT_ID = 'cert-w1b-001';
export const W1B_CERT_NUMBER = 'GACP-TH-2026-W1B';

export const W1B_STATE_SLIP_ID = 'slip-w1b-state-001';
export const W1B_PLATFORM_SLIP_ID = 'slip-w1b-platform-001';
export const W1B_STATE_INVOICE_ID = 'inv-w1b-state-001';
export const W1B_PLATFORM_INVOICE_ID = 'inv-w1b-platform-001';

export const W1B_PERIOD_CLOSE_ID = 'period-close-w1b-001';
export const W1B_MJE_DRAFT_ID = 'mje-draft-w1b-001';
export const W1B_AUDIT_LOG_ID = 'audit-log-w1b-001';

// ────────────────────────────────────────────────────────────────────────────
// Mode helper — mirrors farmer-fixtures.ts `expectLiveBackend()`.
// ────────────────────────────────────────────────────────────────────────────

export function expectLiveBackend(): boolean {
    return process.env.E2E_LIVE_BACKEND === '1';
}

// ────────────────────────────────────────────────────────────────────────────
// Payload builders — small, composable, idempotent.
// ────────────────────────────────────────────────────────────────────────────

type ApplicationStatus =
    | 'ASSIGNED_FOR_REVIEW'
    | 'DOC_APPROVED'
    | 'AUDIT_FEE_PAID'
    | 'AUDIT_SCHEDULED'
    | 'AUDIT_PASSED'
    | 'CERTIFIED';

export function buildApplicationDetail(opts: {
    status?: ApplicationStatus;
    reviewedSteps?: number[];
} = {}) {
    const { status = 'ASSIGNED_FOR_REVIEW', reviewedSteps = [] } = opts;
    return {
        success: true,
        data: {
            id: W1B_APP_ID,
            _id: W1B_APP_ID,
            applicationNumber: W1B_APP_NUMBER,
            status,
            stage: status,
            serviceType: 'new_application',
            plantCode: 'CANNABIS',
            plantType: 'กัญชา',
            farmName: 'สวนสมุนไพรลุงมานพ',
            applicantName: W1B_HEALTH_NAME,
            createdAt: '2026-05-10T03:00:00.000Z',
            updatedAt: new Date().toISOString(),
            health: {
                firstName: 'มานพ',
                lastName: 'ปลูกดี',
                phone: '081-234-5678',
                email: 'manop.w1b@test.local',
                accountType: 'INDIVIDUAL',
            },
            applicant: {
                firstName: 'มานพ',
                lastName: 'ปลูกดี',
                phone: '081-234-5678',
                email: 'manop.w1b@test.local',
            },
            formData: {
                farmData: {
                    farmName: 'สวนสมุนไพรลุงมานพ',
                    address: '99 หมู่ 5 ต.ดอนแก้ว อ.แม่ริม จ.เชียงใหม่',
                    latitude: 18.9011,
                    longitude: 98.9447,
                },
                farmAddress: '99 หมู่ 5 ต.ดอนแก้ว อ.แม่ริม จ.เชียงใหม่',
                plantName: 'กัญชา',
                areaType: 'organic',
                productionData: {},
                harvestData: {},
                // The reviewer's whole job is reading these. Without them every
                // row in the documents tab rendered "ไม่มี", no Preview button
                // existed, and the preview pane could never be opened — so the
                // pane a reviewer works in had no coverage while the journey
                // spec still reported 11 green stages. Keys match DOCUMENT_FIELDS
                // in provider-application-detail-config.ts; the URLs are served
                // by installMockAssetRoutes.
                documents: {
                    idCardDoc: '/mock/doc-id-card.png',
                    houseRegDoc: '/mock/doc-house-reg.png',
                    criminalBgDoc: '/mock/doc-criminal-bg.png',
                    LICENCE_PT11: '/mock/doc-license-pt11.png',
                    LAND_TITLE: '/mock/doc-land-title.png',
                    SITE_MAP: '/mock/doc-site-map.png',
                    WATER_TEST: '/mock/doc-water-test.png',
                    SOIL_TEST: '/mock/doc-soil-test.png',
                    SOP_MANUAL: '/mock/doc-sop-manual.png',
                },
                reviewedSteps,
                reviewProgress: {},
                workflowState: status,
            },
            workflowHistory: [],
        },
    };
}

export function buildSchedulerQueue(opts: { includeTarget?: boolean } = {}) {
    const { includeTarget = true } = opts;
    const items = [
        ...(includeTarget
            ? [
                  {
                      id: W1B_APP_ID,
                      applicationNumber: W1B_APP_NUMBER,
                      applicantName: W1B_HEALTH_NAME,
                      plantType: 'กัญชา',
                      status: 'AUDIT_FEE_PAID',
                      province: 'เชียงใหม่',
                      district: 'แม่ริม',
                      region: 'NORTH',
                      auditFeePaidAt: '2026-05-15T03:00:00.000Z',
                  },
              ]
            : []),
        {
            id: 'app-w1b-q2',
            applicationNumber: 'APP-2026-W1B-00002',
            applicantName: 'สุภาพ สมุนไพร',
            plantType: 'ขมิ้นชัน',
            status: 'AUDIT_FEE_PAID',
            province: 'นครพนม',
            district: 'เมือง',
            region: 'NORTHEAST',
            auditFeePaidAt: '2026-05-15T04:00:00.000Z',
        },
    ];
    return {
        success: true,
        data: {
            items,
            summary: {
                totalItems: items.length,
                slaBreachedItems: 0,
                slaHours: 72,
                regionBreakdown: [
                    { region: 'NORTH', count: includeTarget ? 1 : 0 },
                    { region: 'NORTHEAST', count: 1 },
                ],
            },
        },
    };
}

export const W1B_AUDITOR_DIRECTORY = {
    success: true,
    data: [
        {
            id: W1B_AUDITOR_ID,
            providerId: W1B_AUDITOR_ID,
            firstName: 'สมศรี',
            lastName: 'ใจดี',
            fullName: W1B_AUDITOR_NAME,
            role: 'AUDITOR',
            canonicalRole: 'AUDITOR',
            workload: 2,
        },
        {
            id: W1B_SECOND_AUDITOR_ID,
            providerId: W1B_SECOND_AUDITOR_ID,
            firstName: 'มานะ',
            lastName: 'อดทน',
            fullName: W1B_SECOND_AUDITOR_NAME,
            role: 'AUDITOR',
            canonicalRole: 'AUDITOR',
            workload: 4,
        },
    ],
};

export const W1B_AUDITOR_AVAILABILITY = {
    success: true,
    data: {
        auditorId: W1B_AUDITOR_ID,
        slots: [
            { date: '2026-05-23', time: '09:00', available: true },
            { date: '2026-05-24', time: '13:00', available: true },
        ],
        conflicts: [],
    },
};

export function buildAuditOnsiteContext() {
    return {
        success: true,
        data: {
            audit: {
                id: W1B_AUDIT_ID,
                applicationId: W1B_APP_ID,
                applicationNumber: W1B_APP_NUMBER,
                applicantName: W1B_HEALTH_NAME,
                farmAddress: '99 หมู่ 5 ต.ดอนแก้ว อ.แม่ริม จ.เชียงใหม่ 50180',
                farmLat: 18.9011,
                farmLng: 98.9447,
                scope: 'GACP_FULL',
            },
            checklist: [
                {
                    itemId: 'gacp-01',
                    title: 'พื้นที่ปลูก',
                    description: 'พื้นที่ปลูกอยู่ห่างจากแหล่งปนเปื้อนอย่างน้อย 30 เมตร',
                    category: 'SITE',
                    required: true,
                },
                {
                    itemId: 'gacp-02',
                    title: 'การจัดการศัตรูพืช',
                    description: 'มีการบันทึกการใช้สารชีวภัณฑ์ครบถ้วน',
                    category: 'PEST',
                    required: true,
                },
                {
                    itemId: 'gacp-03',
                    title: 'การเก็บเกี่ยว',
                    description: 'มีพื้นที่จัดเก็บผลผลิตที่ปลอดภัยและสะอาด',
                    category: 'HARVEST',
                    required: true,
                },
            ],
            startedAt: null,
            savedAnswers: [],
        },
    };
}

export function buildCertificatePayload() {
    const issuedDate = new Date().toISOString();
    const expiryDate = new Date(
        new Date(issuedDate).getTime() + 3 * 365 * 86_400_000,
    ).toISOString();
    return {
        success: true,
        data: {
            id: W1B_CERT_ID,
            _id: W1B_CERT_ID,
            certificateNumber: W1B_CERT_NUMBER,
            applicationId: W1B_APP_ID,
            farmId: 'farm-w1b-001',
            siteName: 'สวนสมุนไพรลุงมานพ',
            plantType: 'กัญชา',
            issuedDate,
            expiryDate,
            status: 'ACTIVE',
            signedAt: issuedDate,
        },
    };
}

export function buildStateFeeSlip(opts: { approved?: boolean } = {}) {
    const { approved = false } = opts;
    return {
        id: W1B_STATE_SLIP_ID,
        invoiceId: W1B_STATE_INVOICE_ID,
        applicationId: W1B_APP_ID,
        phase: 'PHASE_1',
        serviceType: 'PHASE_1_STATE_FEE',
        status: approved ? 'APPROVED' : 'PENDING_REVIEW',
        amountClaimed: 5000,
        bankRef: 'TRX-W1B-STATE',
        transferredAt: '2026-05-16T05:00:00.000Z',
        uploadedAt: '2026-05-16T05:05:00.000Z',
        fileUrl: '/mock/slip-w1b-state.png',
        application: {
            id: W1B_APP_ID,
            applicationNumber: W1B_APP_NUMBER,
        },
    };
}

export function buildPlatformFeeSlip(opts: { approved?: boolean } = {}) {
    const { approved = false } = opts;
    return {
        id: W1B_PLATFORM_SLIP_ID,
        invoiceId: W1B_PLATFORM_INVOICE_ID,
        applicationId: W1B_APP_ID,
        phase: 'PHASE_1',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        status: approved ? 'APPROVED' : 'PENDING_REVIEW',
        amountClaimed: 535,
        bankRef: 'TRX-W1B-PLAT',
        transferredAt: '2026-05-16T05:30:00.000Z',
        uploadedAt: '2026-05-16T05:35:00.000Z',
        fileUrl: '/mock/slip-w1b-platform.png',
        application: {
            id: W1B_APP_ID,
            applicationNumber: W1B_APP_NUMBER,
        },
    };
}

export function buildSlipQueueSummary(opts: { side?: 'DTAM' | 'PLATFORM' | 'BOTH' } = {}) {
    const { side = 'BOTH' } = opts;
    return {
        success: true,
        data: {
            pending: { total: 1, overSla: 0, slaHours: 24 },
            today: { approved: 0, rejected: 0 },
            monthly: {
                totalRevenue: side === 'PLATFORM' ? 535 : 5000,
                stateRevenue: 5000,
                platformRevenue: 535,
                slipsApproved: 0,
            },
            visibleSide: side,
        },
    };
}

export function buildPeriodCloseList() {
    return {
        success: true,
        data: [
            {
                id: 'period-close-w1b-april',
                year: 2026,
                month: 4,
                status: 'CLOSED',
                closedAt: '2026-05-01T03:00:00.000Z',
                closedBy: 'platform-finance',
                reopenedAt: null,
                reopenedBy: null,
                reopenReason: null,
                notes: 'ปิดงวดเมษายน 2026 หลังตรวจสลิปครบถ้วน',
            },
        ],
    };
}

export function buildPeriodCloseResult() {
    return {
        success: true,
        data: {
            id: W1B_PERIOD_CLOSE_ID,
            year: 2026,
            month: 5,
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            closedBy: 'platform-finance',
            notes: 'ปิดงวด W1-B regression spec',
        },
    };
}

export function buildManualJournalEntryList() {
    return {
        success: true,
        data: [
            {
                id: W1B_MJE_DRAFT_ID,
                draftNumber: 'MJE-2026-W1B-001',
                postedAt: null,
                memo: 'Reclass platform revenue (W1-B spec)',
                status: 'DRAFT',
                totalDebit: 1000,
                totalCredit: 1000,
                createdAt: new Date().toISOString(),
                createdBy: 'platform-finance',
                lines: [],
            },
        ],
    };
}

export function buildManualJournalEntryDraftCreated() {
    return {
        success: true,
        data: {
            id: W1B_MJE_DRAFT_ID,
            draftNumber: 'MJE-2026-W1B-001',
            postedAt: null,
            memo: 'Reclass platform revenue (W1-B spec)',
            status: 'DRAFT',
            totalDebit: 1000,
            totalCredit: 1000,
            createdAt: new Date().toISOString(),
            createdBy: 'platform-finance',
            lines: [
                { accountCode: '4101', debit: 0, credit: 1000, description: 'Platform revenue reclass' },
                { accountCode: '1101', debit: 1000, credit: 0, description: 'Platform clearing' },
            ],
        },
    };
}

export function buildAuditLogList() {
    const rows = [
        {
            id: W1B_AUDIT_LOG_ID,
            sequenceNumber: 1,
            createdAt: new Date().toISOString(),
            category: 'APPLICATION',
            action: 'DOC_APPROVED',
            severity: 'INFO',
            actorId: W1B_REVIEWER_USER_ID,
            actorEmail: 'reviewer.w1b@test.local',
            actorRole: 'DOCUMENT_REVIEWER',
            resourceType: 'Application',
            resourceId: W1B_APP_ID,
            result: 'SUCCESS',
        },
        {
            id: 'audit-log-w1b-002',
            sequenceNumber: 2,
            createdAt: new Date().toISOString(),
            category: 'AUDIT',
            action: 'AUDIT_PASSED',
            severity: 'INFO',
            actorId: W1B_AUDITOR_ID,
            actorEmail: 'auditor.w1b@test.local',
            actorRole: 'AUDITOR',
            resourceType: 'Application',
            resourceId: W1B_APP_ID,
            result: 'SUCCESS',
        },
        {
            id: 'audit-log-w1b-003',
            sequenceNumber: 3,
            createdAt: new Date().toISOString(),
            category: 'CERTIFICATE',
            action: 'CERTIFICATE_ISSUED',
            severity: 'INFO',
            actorId: 'system',
            actorEmail: 'system@gacpth.com',
            actorRole: 'SYSTEM',
            resourceType: 'Certificate',
            resourceId: W1B_CERT_ID,
            result: 'SUCCESS',
        },
    ];
    return {
        success: true,
        data: rows,
        pagination: { total: rows.length, totalPages: 1, page: 1, limit: 50 },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Login helpers — wrap fixtures.ts loginAs* with W1-B-specific overrides.
// Each helper short-circuits in live mode (the spec drives real login UI).
// ────────────────────────────────────────────────────────────────────────────

export async function signInAsDocumentReviewer(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    // No dedicated loginAsDocumentReviewer helper exists in fixtures.ts —
    // seed via the shared applySession dual-write helper with
    // role=DOCUMENT_REVIEWER so the /provider/applications/[id] page
    // exposes the Approve / Request Revision affordances.
    await applySession(page, {
        user: {
            id: W1B_REVIEWER_USER_ID,
            username: W1B_REVIEWER_USERNAME,
            firstName: 'สมหญิง',
            lastName: 'ตรวจดี',
            email: 'reviewer.w1b@test.local',
            role: 'DOCUMENT_REVIEWER',
        },
        tokenPayload: {
            sub: W1B_REVIEWER_USER_ID,
            username: W1B_REVIEWER_USERNAME,
            email: 'reviewer.w1b@test.local',
            role: 'DOCUMENT_REVIEWER',
        },
    });
}

export async function signInAsScheduler(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await loginAsScheduler(page, {
        id: 'scheduler-w1b',
        username: 'scheduler-w1b-1',
        email: 'scheduler.w1b@test.local',
    });
}

export async function signInAsAuditor(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await loginAsAuditor(page, {
        id: W1B_AUDITOR_ID,
        username: W1B_AUDITOR_USERNAME,
        email: 'auditor.w1b@test.local',
        auditorName: W1B_AUDITOR_NAME,
    });
}

export async function signInAsAccountDtam(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await loginAsAccountDtam(page, {
        id: 'dtam-account-w1b',
        username: 'dtam-finance-w1b',
        email: 'dtam.finance.w1b@test.local',
    });
}

export async function signInAsAccountPlatform(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await loginAsAccountPlatform(page, {
        id: 'platform-account-w1b',
        username: 'platform-finance-w1b',
        email: 'platform.finance.w1b@test.local',
    });
}

export async function signInAsAdmin(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await loginAsAdmin(page, {
        id: 'admin-w1b',
        username: 'admin-w1b-1',
        email: 'admin.w1b@test.local',
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Master mock chain helpers — one helper per stage cluster so the spec can
// register only the mocks it needs at that moment. All helpers are
// idempotent and no-ops in live mode.
// ────────────────────────────────────────────────────────────────────────────

export async function reviewerStageMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;

    // Review queue (DOCUMENT_REVIEWER landing — list of ASSIGNED_FOR_REVIEW).
    await mockApi(page, {
        route: /\/api\/provider\/applications(\?.*)?$/,
        body: {
            success: true,
            data: [
                {
                    id: W1B_APP_ID,
                    applicationNumber: W1B_APP_NUMBER,
                    status: 'ASSIGNED_FOR_REVIEW',
                    applicantName: W1B_HEALTH_NAME,
                    plantType: 'กัญชา',
                    createdAt: '2026-05-10T03:00:00.000Z',
                    health: {
                        firstName: 'มานพ',
                        lastName: 'ปลูกดี',
                    },
                },
            ],
        },
    });

    // Application detail — initial state has 0 reviewedSteps so the
    // Approve button is disabled (DR-4 9-step gate). The spec advances
    // it through `advanceReviewerToNineReviewedSteps()`.
    await page.route(`**/api/provider/applications/${W1B_APP_ID}`, async (route: Route) => {
        const method = route.request().method();
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(buildApplicationDetail({ status: 'ASSIGNED_FOR_REVIEW' })),
            });
            return;
        }
        await route.fallback();
    });

    // Workflow-transitions POST (Approve / Request Revision target).
    await page.route(
        `**/api/provider/applications/${W1B_APP_ID}/workflow-transitions`,
        async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        applicationId: W1B_APP_ID,
                        newStatus: 'DOC_APPROVED',
                        transitionedAt: new Date().toISOString(),
                    },
                }),
            });
        },
    );
}

/**
 * Stage 2 helper — flip the application-detail mock to expose all 9
 * reviewedSteps so the Approve button enables. The spec uses this to
 * validate the DR-4 9-step gate end-to-end.
 */
export async function advanceReviewerToNineReviewedSteps(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    await page.unroute(`**/api/provider/applications/${W1B_APP_ID}`);
    await page.route(`**/api/provider/applications/${W1B_APP_ID}`, async (route: Route) => {
        const method = route.request().method();
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(
                    buildApplicationDetail({
                        status: 'ASSIGNED_FOR_REVIEW',
                        reviewedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
                    }),
                ),
            });
            return;
        }
        await route.fallback();
    });
}

export async function schedulerStageMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;

    // Scheduler queue (SC-1 surface — must return the target application
    // AND ≥1 row total so the queue table renders).
    await mockApi(page, {
        route: /\/api\/audit\/scheduling\/queue(\?.*)?$/,
        body: buildSchedulerQueue(),
    });

    // Auditor directory dropdown (V2 SC-1 fix — re-pointed from the legacy
    // `/audit/scheduling/auditors` 404 to the working
    // `/provider/scheduler/auditors`).
    await mockApi(page, {
        route: /\/api\/provider\/scheduler\/auditors(\?.*)?$/,
        body: W1B_AUDITOR_DIRECTORY,
    });

    // Auditor availability calendar (SC-2).
    await mockApi(page, {
        route: new RegExp(`/api/audit/scheduling/auditor-availability/${W1B_AUDITOR_ID}`),
        body: W1B_AUDITOR_AVAILABILITY,
    });

    // Assign POST (SC-3) — returns the freshly-created audit so the modal
    // can advance to "success".
    await page.route('**/api/audit/scheduling/assign', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    inspectionId: W1B_AUDIT_ID,
                    auditId: W1B_AUDIT_ID,
                    applicationId: W1B_APP_ID,
                    scheduledDate: '2026-05-23',
                    scheduledTime: '09:00',
                    auditorId: W1B_AUDITOR_ID,
                    auditorName: W1B_AUDITOR_NAME,
                },
            }),
        });
    });

    // Reschedule list (RB-3 surface) — /audits/reassignable.
    await mockApi(page, {
        route: /\/api\/audits\/reassignable(\?.*)?$/,
        body: {
            success: true,
            data: {
                applications: [
                    {
                        id: W1B_APP_ID,
                        applicationNumber: W1B_APP_NUMBER,
                        applicantName: W1B_HEALTH_NAME,
                        plantType: 'กัญชา',
                        status: 'AUDIT_CONFIRMED',
                        currentAuditor: W1B_AUDITOR_NAME,
                        currentAuditorId: W1B_AUDITOR_ID,
                        scheduledDate: '2026-05-23',
                        daysOverdue: 0,
                    },
                ],
            },
        },
    });

    // Provider directory (REVIEWER_AUDITOR pool used by reassign page).
    await mockApi(page, {
        route: /\/api\/provider\/directory(\?.*role=REVIEWER_AUDITOR.*)?$/,
        body: W1B_AUDITOR_DIRECTORY,
    });

    // POST /audits/{id}/reassign endpoint.
    await page.route(`**/api/audits/${W1B_APP_ID}/reassign`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    rescheduleId: W1B_RESCHEDULE_ID,
                    applicationId: W1B_APP_ID,
                    newAuditorId: W1B_SECOND_AUDITOR_ID,
                    newAuditorName: W1B_SECOND_AUDITOR_NAME,
                    rescheduledAt: new Date().toISOString(),
                },
            }),
        });
    });
}

export async function auditorStageMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;

    // Onsite-audit context (DI-1 surface — the route was previously
    // unmounted; ensuring it returns a 200 with checklist data proves
    // the mount works).
    await mockApi(page, {
        route: new RegExp(`/api/audit/onsite/application/${W1B_APP_ID}/context$`),
        body: buildAuditOnsiteContext(),
    });
    await mockApi(page, {
        route: new RegExp(`/api/audit/onsite/${W1B_AUDIT_ID}$`),
        body: buildAuditOnsiteContext(),
    });

    // Start inspection (GPS check-in).
    await page.route(`**/api/audit/onsite/${W1B_AUDIT_ID}/start`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    sessionId: `${W1B_AUDIT_ID}-session`,
                    auditId: W1B_AUDIT_ID,
                    status: 'IN_PROGRESS',
                    startedAt: new Date().toISOString(),
                },
            }),
        });
    });

    // Checklist save (per-item upsert).
    await page.route(`**/api/audit/onsite/${W1B_AUDIT_ID}/checklist`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: { auditId: W1B_AUDIT_ID, itemsSaved: 1 },
            }),
        });
    });

    // Photo upload (multipart).
    await page.route(`**/api/audit/onsite/${W1B_AUDIT_ID}/photo`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    photoId: `photo-w1b-${Date.now()}`,
                    url: '/mock/audit-photo-w1b.png',
                    auditId: W1B_AUDIT_ID,
                    fileMimeType: 'image/png',
                    fileSizeBytes: 2048,
                    capturedAt: new Date().toISOString(),
                },
            }),
        });
    });

    // Decision POST — Stage 6 PASS submission. The R2-D hook auto-creates
    // the certificate on AUDIT_PASSED, which the spec verifies via a
    // /certificates GET in Stage 7.
    await page.route(`**/api/audit/onsite/${W1B_AUDIT_ID}/decision`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    auditId: W1B_AUDIT_ID,
                    applicationId: W1B_APP_ID,
                    decision: 'PASS',
                    decidedAt: new Date().toISOString(),
                    decidedBy: W1B_AUDITOR_ID,
                    summary: 'ฟาร์มผ่านเกณฑ์ทุกข้อ',
                    certificate: {
                        id: W1B_CERT_ID,
                        certificateNumber: W1B_CERT_NUMBER,
                    },
                },
            }),
        });
    });
}

export async function ensureAuditorGeolocation(page: Page): Promise<void> {
    if (expectLiveBackend()) return;
    // Default to Bangkok ground-truth so the GPS check-in succeeds. The
    // DM-4 fallback button is verified separately in the spec by forcing
    // a geolocation rejection (also a no-op in live mode).
    await mockGeolocation(page, { lat: 18.9011, lng: 98.9447, accuracy: 10 });
}

export async function certIssuanceMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;
    // Admin certificate search (cross-tenant — V5-A surface).
    await mockApi(page, {
        route: /\/api\/admin\/certificates(\?.*)?$/,
        body: {
            success: true,
            data: [
                {
                    id: W1B_CERT_ID,
                    _id: W1B_CERT_ID,
                    certificateNumber: W1B_CERT_NUMBER,
                    applicationId: W1B_APP_ID,
                    applicationNumber: W1B_APP_NUMBER,
                    siteName: 'สวนสมุนไพรลุงมานพ',
                    plantType: 'กัญชา',
                    status: 'ACTIVE',
                    issuedDate: new Date().toISOString(),
                },
            ],
            pagination: { total: 1, totalPages: 1, page: 1, limit: 50 },
        },
    });
    await mockApi(page, {
        route: new RegExp(`/api/admin/certificates/${W1B_CERT_ID}$`),
        body: buildCertificatePayload(),
    });
    await mockApi(page, {
        route: new RegExp(`/api/certificates/${W1B_CERT_ID}$`),
        body: buildCertificatePayload(),
    });
}

export async function accountantDtamMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;
    // ACCOUNT_DTAM lands on /provider/accounting → pending slip list +
    // summary cards. The middleware-admission gate (V4-A) ensures DTAM
    // sees the state-fee slip ONLY.
    await mockApi(page, {
        route: /\/api\/payments\/slip\/pending(\?.*)?$/,
        body: { success: true, data: [buildStateFeeSlip()] },
    });
    await mockApi(page, {
        route: /\/api\/finance\/accounting\/slip-queue-summary(\?.*)?$/,
        body: buildSlipQueueSummary({ side: 'DTAM' }),
    });
    await mockApi(page, {
        route: /\/api\/invoices\/summary(\?.*)?$/,
        body: {
            success: true,
            data: {
                totalInvoices: 1,
                paidInvoices: 0,
                pendingInvoices: 1,
                totalRevenue: 5000,
            },
        },
    });
    await mockApi(page, {
        route: /\/api\/invoices(\?.*)?$/,
        body: { success: true, data: { invoices: [] } },
    });
    await mockApi(page, {
        route: /\/api\/invoices\/receipts\/exceptions(\?.*)?$/,
        body: { success: true, data: { exceptions: [] } },
    });
    await mockApi(page, {
        route: /\/api\/invoices\/revenue-summary(\?.*)?$/,
        body: {
            success: true,
            data: {
                totalRevenue: 0,
                monthlyRevenue: 0,
                stateRevenue: 0,
                platformRevenue: 0,
            },
        },
    });
    await mockApi(page, {
        route: /\/api\/subscriptions\/my-orders(\?.*)?$/,
        body: { success: true, data: [] },
    });

    // Approve POST (state-fee slip approval).
    await page.route(`**/api/payments/slip/${W1B_STATE_SLIP_ID}/approve`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: buildStateFeeSlip({ approved: true }),
            }),
        });
    });
}

export async function accountantPlatformMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;
    // ACCOUNT_PLATFORM landing — pending PLATFORM-fee slip only.
    await page.unroute(/\/api\/payments\/slip\/pending(\?.*)?$/).catch(() => {
        /* noop — first call has no prior route */
    });
    await mockApi(page, {
        route: /\/api\/payments\/slip\/pending(\?.*)?$/,
        body: { success: true, data: [buildPlatformFeeSlip()] },
    });
    await page.unroute(/\/api\/finance\/accounting\/slip-queue-summary(\?.*)?$/).catch(() => {
        /* noop */
    });
    await mockApi(page, {
        route: /\/api\/finance\/accounting\/slip-queue-summary(\?.*)?$/,
        body: buildSlipQueueSummary({ side: 'PLATFORM' }),
    });

    // Approve POST (PLATFORM slip).
    await page.route(`**/api/payments/slip/${W1B_PLATFORM_SLIP_ID}/approve`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: buildPlatformFeeSlip({ approved: true }),
            }),
        });
    });

    // Period close list (R1-A surface).
    await mockApi(page, {
        route: /\/api\/finance\/period-close(\?.*)?$/,
        body: buildPeriodCloseList(),
    });
    await page.route('**/api/finance/period-close', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(buildPeriodCloseResult()),
        });
    });

    // Manual journal entries list (R1-C surface).
    await mockApi(page, {
        route: /\/api\/finance\/manual-journal-entries(\?.*)?$/,
        body: buildManualJournalEntryList(),
    });
    await page.route('**/api/finance/manual-journal-entries', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(buildManualJournalEntryDraftCreated()),
        });
    });
    await mockApi(page, {
        route: new RegExp(`/api/finance/manual-journal-entries/${W1B_MJE_DRAFT_ID}$`),
        body: buildManualJournalEntryDraftCreated(),
    });
}

export async function adminAuditLogMocks(page: Page): Promise<void> {
    // Preview assets (slips, documents, audit photos) — without these every
    // preview box in this flow renders a broken image while the spec still passes.
    await installMockAssetRoutes(page);
    if (expectLiveBackend()) return;
    // /api/admin/audit-log — V5-D structured filter surface.
    await mockApi(page, {
        route: /\/api\/admin\/audit-log(\?.*)?$/,
        body: buildAuditLogList(),
    });
    // CSV export endpoint — the page calls window.open() to stream it.
    // We intercept GET on the export.csv path and fulfill with a stub CSV.
    await page.route('**/api/admin/audit-log/export.csv**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const csv = [
            'sequence,createdAt,category,action,actorEmail,actorRole,resourceId,result',
            `1,${new Date().toISOString()},APPLICATION,DOC_APPROVED,reviewer.w1b@test.local,DOCUMENT_REVIEWER,${W1B_APP_ID},SUCCESS`,
            `2,${new Date().toISOString()},AUDIT,AUDIT_PASSED,auditor.w1b@test.local,AUDITOR,${W1B_APP_ID},SUCCESS`,
            `3,${new Date().toISOString()},CERTIFICATE,CERTIFICATE_ISSUED,system@gacpth.com,SYSTEM,${W1B_CERT_ID},SUCCESS`,
        ].join('\n');
        await route.fulfill({
            status: 200,
            contentType: 'text/csv; charset=utf-8',
            headers: {
                'content-disposition': 'attachment; filename="audit-log-w1b.csv"',
            },
            body: csv,
        });
    });
}
