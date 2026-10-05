/**
 * dashboard-overdue-tiles.test.js — Wave-3 P1-H SLA/overdue visibility.
 *
 * Proves the ADDITIVE overdue metrics the auditor + scheduler dashboards
 * now surface (previously only the reviewer dashboard exposed overdue):
 *
 *   1. Auditor dashboard `kpi.overdue` counts an onsite that is PAST DUE
 *      (scheduledDate < now) AND still in AUDIT_CONFIRMED (confirmed but
 *      not yet inspected) — and does NOT count a future onsite nor a
 *      non-AUDIT_CONFIRMED item (e.g. AUDIT_PASSED, CAR_REVIEWING).
 *
 *   2. Scheduler dashboard `kpi.overdue` counts scheduler-group work
 *      activities that are overdue (dueAt < now) or breached
 *      (breachedAt != null), read via the work-activity service; a
 *      read failure fails-closed to 0 (never breaks the dashboard).
 *
 * Shape — the dashboard handlers are `[authenticateProvider, gate, fn]`
 * arrays. We mock the deps modules (so no Prisma/auth boot) and invoke
 * the terminal handler `fn(req, res)` directly with a fake res that
 * captures the JSON body. This mirrors how the reviewer/queue helpers
 * are unit-tested without a full supertest mount.
 */

const path = require('path');

const HANDLERS_DIR = path.join(
    __dirname, '..', '..', 'routes', 'api', 'provider', 'handlers',
);

// ── Shared fakes ──────────────────────────────────────────────────────────
function makeRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

const FIXED_NOW = new Date('2026-07-02T12:00:00Z');
const PAST = new Date('2026-07-01T09:00:00Z').toISOString();   // yesterday
const FUTURE = new Date('2026-07-05T09:00:00Z').toISOString(); // in the future

describe('P1-H auditor dashboard — overdue onsite metric', () => {
    let auditorDashboardHandler;
    const mockListApps = jest.fn();

    beforeEach(() => {
        jest.resetModules();

        jest.doMock(path.join(HANDLERS_DIR, 'auditor-handler-deps.js'), () => ({
            authenticateProvider: (_req, _res, next) => next(),
            requireCanonicalPermission: () => (_req, _res, next) => next(),
            logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
            PERMISSIONS: { APPLICATION_AUDIT_RECORD: 'APPLICATION_AUDIT_RECORD' },
            normalizeRole: (r) => String(r || '').toLowerCase(),
            CANONICAL_ROLES: { ADMIN: 'admin' },
            toInt: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
            dt: (v) => (v ? new Date(v) : null),
            computePhaseSettlement: () => ({ phasePaid: false, phaseReceiptIssued: false }),
            // Real queue-item builder shape — the metric keys off scheduledDate +
            // workflowState which the builder derives from the raw application.
            buildAuditorQueueItem: (application) => ({
                id: application.id,
                applicationId: application.id,
                applicationNumber: application.applicationNumber || application.id,
                applicantName: 'x',
                workflowState: application.status,
                status: application.status,
                scheduledDate: application.scheduledDate || null,
                inspectionMode: 'ONSITE',
                receiptIssued: false,
                updatedAt: application.updatedAt || FIXED_NOW.toISOString(),
                isMinorFollowup: false,
                isMajorRescheduleRequired: false,
                canStartInspection: false,
            }),
            applicationService: {
                listAuditorDashboardApplications: (...a) => mockListApps(...a),
                listAuditorsByIds: async () => [],
            },
            invoiceService: {
                listSettlementsByApplicationIds: async () => [],
            },
        }));

        ({ auditorDashboard: auditorDashboardHandler } = require(
            path.join(HANDLERS_DIR, 'auditor-dashboard-handler.js'),
        ));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    async function runAuditor(applications) {
        mockListApps.mockResolvedValue(applications);
        const fn = auditorDashboardHandler[auditorDashboardHandler.length - 1];
        const req = { query: {}, user: { id: 'auditor-1', role: 'auditor' } };
        const res = makeRes();
        // Freeze "now" so the past/future fixtures are deterministic.
        const RealDate = Date;
        global.Date = class extends RealDate {
            constructor(...args) {
                if (args.length === 0) { return new RealDate(FIXED_NOW); }
                return new RealDate(...args);
            }
            static now() { return FIXED_NOW.getTime(); }
        };
        try {
            await fn(req, res);
        } finally {
            global.Date = RealDate;
        }
        return res;
    }

    it('counts a past-due AUDIT_CONFIRMED onsite as overdue', async () => {
        const res = await runAuditor([
            { id: 'a1', status: 'AUDIT_CONFIRMED', scheduledDate: PAST },
        ]);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.kpi.overdue).toBe(1);
    });

    it('does NOT count a FUTURE AUDIT_CONFIRMED onsite', async () => {
        const res = await runAuditor([
            { id: 'a2', status: 'AUDIT_CONFIRMED', scheduledDate: FUTURE },
        ]);
        expect(res.body.data.kpi.overdue).toBe(0);
    });

    it('does NOT count a past-due item that has left AUDIT_CONFIRMED', async () => {
        const res = await runAuditor([
            { id: 'a3', status: 'AUDIT_PASSED', scheduledDate: PAST },
            { id: 'a4', status: 'CAR_REVIEWING', scheduledDate: PAST },
        ]);
        expect(res.body.data.kpi.overdue).toBe(0);
    });

    it('mixes: counts only the past-due AUDIT_CONFIRMED rows', async () => {
        const res = await runAuditor([
            { id: 'a5', status: 'AUDIT_CONFIRMED', scheduledDate: PAST },
            { id: 'a6', status: 'AUDIT_CONFIRMED', scheduledDate: FUTURE },
            { id: 'a7', status: 'AUDIT_CONFIRMED', scheduledDate: PAST },
            { id: 'a8', status: 'AUDIT_PASSED', scheduledDate: PAST },
        ]);
        expect(res.body.data.kpi.overdue).toBe(2);
    });
});

describe('P1-H scheduler dashboard — overdue/breached work-activity metric', () => {
    let schedulerDashboardHandler;
    const mockListApps = jest.fn();
    const mockCountOverdue = jest.fn();

    beforeEach(() => {
        jest.resetModules();

        jest.doMock(path.join(HANDLERS_DIR, 'scheduler-handler-deps.js'), () => ({
            authenticateProvider: (_req, _res, next) => next(),
            requireCanonicalPermission: () => (_req, _res, next) => next(),
            logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
            PERMISSIONS: { APPLICATION_SCHEDULE: 'APPLICATION_SCHEDULE' },
            toInt: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
            dt: (v) => (v ? new Date(v) : null),
            computePhaseSettlement: () => ({ phasePaid: false, phaseReceiptIssued: false }),
            buildSchedulerQueueItem: (application) => ({
                id: application.id,
                applicationId: application.id,
                applicationNumber: application.applicationNumber || application.id,
                applicantName: 'x',
                workflowState: application.status,
                status: application.status,
                scheduledDate: application.scheduledDate || null,
                inspectionMode: 'ONSITE',
                phase2Paid: false,
                receiptIssued: false,
                auditorId: null,
                auditorName: null,
                reviewerId: null,
                reviewerName: null,
                isRescheduleRequired: false,
                createdAt: application.createdAt || FIXED_NOW.toISOString(),
                updatedAt: application.updatedAt || FIXED_NOW.toISOString(),
            }),
            applicationService: {
                listSchedulerDashboardApplications: (...a) => mockListApps(...a),
                listAuditorsByIds: async () => [],
            },
            invoiceService: {
                listSettlementsByApplicationIds: async () => [],
            },
            workActivityService: {
                countOverdueForGroup: (...a) => mockCountOverdue(...a),
            },
        }));

        ({ schedulerDashboard: schedulerDashboardHandler } = require(
            path.join(HANDLERS_DIR, 'scheduler-dashboard-handler.js'),
        ));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    async function runScheduler(overdueCount) {
        mockListApps.mockResolvedValue([]);
        mockCountOverdue.mockResolvedValue(overdueCount);
        const fn = schedulerDashboardHandler[schedulerDashboardHandler.length - 1];
        const req = {
            query: {},
            user: { id: 'sched-1', role: 'dispatcher', organizationId: 'org-1' },
        };
        const res = makeRes();
        await fn(req, res);
        return res;
    }

    it('exposes the scheduler-group overdue/breached count in kpi.overdue', async () => {
        const res = await runScheduler(3);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.kpi.overdue).toBe(3);
        // scoped to the caller's org + the scheduler candidate group
        expect(mockCountOverdue).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'dispatcher', organizationId: 'org-1' }),
        );
    });

    it('fails closed to 0 when the work-activity read throws (never breaks the dashboard)', async () => {
        mockListApps.mockResolvedValue([]);
        mockCountOverdue.mockRejectedValue(new Error('db down'));
        const fn = schedulerDashboardHandler[schedulerDashboardHandler.length - 1];
        const req = {
            query: {},
            user: { id: 'sched-1', role: 'dispatcher', organizationId: 'org-1' },
        };
        const res = makeRes();
        await fn(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.kpi.overdue).toBe(0);
    });
});
