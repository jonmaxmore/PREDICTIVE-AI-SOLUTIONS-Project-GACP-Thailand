/**
 * Bug 2.1 [HIGH] — Auto-expiry cron WIPES formData + workflowHistory.
 *
 * RED-first regression test.
 *
 * The revision-deadline cron's findMany `select` originally OMITTED
 * `formData` and `workflowHistory`, so on the EXPIRED write:
 *   - `app.formData` was `undefined` → the `{...app.formData, _autoExpired}`
 *     spread produced JUST `{_autoExpired}`, OVERWRITING all applicant/plot
 *     data.
 *   - `app.workflowHistory` was `undefined` → `buildTransitionUpdate`
 *     appended to an EMPTY array → the entire audit trail was reset to a
 *     single event.
 *
 * This test drives the REAL `buildTransitionUpdate` +
 * `writeApplicationStatus` merge path (only prisma / notifications /
 * tenant-context are mocked) and asserts that the persisted EXPIRED update:
 *   - STILL carries the applicant/plot keys in formData (not wiped), and
 *   - GREW workflowHistory to length 4 (3 real + 1 EXPIRED event), not 1.
 *
 * Plus a static assertion that the findMany select now includes both
 * columns.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---- Mocks (DB + side-effect deps; real workflow/status-writer logic) ----

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};
jest.mock('../../shared/logger', () => mockLogger);

// tenant-context: run the callbacks inline (no ALS).
jest.mock('../../services/tenant-context', () => ({
    runWithTenantContext: (_ctx, fn) => fn(),
    withoutTenantScope: (fn) => fn(),
}));

// notifications are best-effort / irrelevant to this bug — stub them out.
jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn(async () => undefined),
    NotifyType: {
        APPLICATION_EXPIRED: 'APPLICATION_EXPIRED',
        REVISION_DEADLINE_EXPIRED: 'REVISION_DEADLINE_EXPIRED',
    },
}));

// Force the deadline to be overdue so the EXPIRED path runs.
jest.mock('../../utils/working-days', () => ({
    getDeadlineStatus: jest.fn(() => ({ isOverdue: true })),
}));

// Capture every application.update the writer performs.
const applicationUpdateCalls = [];
const mockPrisma = {
    revisionDeadline: {
        findMany: jest.fn(),
        update: jest.fn(async () => ({})),
    },
    application: {
        update: jest.fn(async ({ data }) => {
            applicationUpdateCalls.push(data);
            return { id: 'app-1', ...data };
        }),
        // findUnique exists but MUST NOT be used for the H1 pre-read on this
        // path (the cron passes formData in additionalData → H1 sync skipped).
        findUnique: jest.fn(async () => ({ formData: {} })),
    },
    user: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
    },
    // NB: intentionally NO `workActivity` — the writer's terminal-status
    // activity-cancel block is guarded on `prisma.workActivity` and stays off.
    $transaction: async (fn) => fn(mockPrisma),
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

const { checkExpiredDeadlines } = require('../../jobs/revision-deadline-checker');

const REAL_FORMDATA = {
    applicantData: { firstName: 'สมชาย', lastName: 'ใจดี', nationalId: 'x' },
    plots: [{ id: 'plot-1', area: 5 }, { id: 'plot-2', area: 3 }],
    someOtherStep: { done: true },
};

// 3 pre-existing history entries (the audit trail that must be preserved).
const REAL_HISTORY = [
    { action: 'WORKFLOW_TRANSITION', toState: 'SUBMITTED', at: '2026-06-01T00:00:00.000Z' },
    { action: 'WORKFLOW_TRANSITION', toState: 'ASSIGNED_FOR_REVIEW', at: '2026-06-02T00:00:00.000Z' },
    { action: 'WORKFLOW_TRANSITION', toState: 'REVISION_REQUESTED', at: '2026-06-03T00:00:00.000Z' },
];

function seedOverdueDeadline() {
    applicationUpdateCalls.length = 0;
    // Mirror real Prisma: only columns present in the `select` come back on the
    // row. If the cron's findMany omits formData/workflowHistory from its
    // application select, those fields are UNDEFINED on the returned row — which
    // is exactly the condition that caused the wipe. The mock honours the
    // select so the RED test reproduces production behaviour.
    mockPrisma.revisionDeadline.findMany.mockImplementation(async (args) => {
        const appSelect = args?.include?.application?.select || {};
        const app = {
            id: 'app-1',
            applicationNumber: 'GACP-0001',
            status: 'REVISION_REQUESTED',
            healthId: 'token-abc',
            organizationId: 'org-1',
            applicant: { firstName: 'สมชาย', lastName: 'ใจดี' },
        };
        if (appSelect.formData) { app.formData = REAL_FORMDATA; }
        if (appSelect.workflowHistory) { app.workflowHistory = REAL_HISTORY; }
        return [
            {
                id: 'deadline-1',
                revisionDue: new Date('2026-06-10T00:00:00.000Z'),
                status: 'PENDING',
                application: app,
            },
        ];
    });
}

describe('Bug 2.1 — revision-deadline cron preserves formData + workflowHistory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        seedOverdueDeadline();
    });

    it('does NOT wipe applicant/plot formData on the EXPIRED write', async () => {
        await checkExpiredDeadlines();

        expect(applicationUpdateCalls.length).toBeGreaterThan(0);
        const data = applicationUpdateCalls[applicationUpdateCalls.length - 1];

        expect(data.status).toBe('EXPIRED');
        // Real applicant/plot data must survive.
        expect(data.formData).toBeDefined();
        expect(data.formData.applicantData).toEqual(REAL_FORMDATA.applicantData);
        expect(data.formData.plots).toEqual(REAL_FORMDATA.plots);
        expect(data.formData.someOtherStep).toEqual(REAL_FORMDATA.someOtherStep);
        // The expiry marker is added, not substituted for everything.
        expect(data.formData._autoExpired).toBeDefined();
    });

    it('APPENDS to workflowHistory (length 4), does NOT reset it to 1', async () => {
        await checkExpiredDeadlines();

        const data = applicationUpdateCalls[applicationUpdateCalls.length - 1];
        expect(Array.isArray(data.workflowHistory)).toBe(true);
        expect(data.workflowHistory).toHaveLength(4);
        // The three originals are still there, in order.
        expect(data.workflowHistory.slice(0, 3)).toEqual(REAL_HISTORY);
    });

    it('findMany select now includes formData + workflowHistory', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'jobs', 'revision-deadline-checker.js'),
            'utf8',
        );
        // Grab the application select block.
        expect(src).toMatch(/formData:\s*true/);
        expect(src).toMatch(/workflowHistory:\s*true/);
    });
});
