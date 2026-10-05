'use strict';

/**
 * The scheduler's "today" counts are Bangkok days (operator 2026-09-26,
 * "เวลาไทยทั้งหมด"). Both handlers used `when.toDateString() ===
 * now.toDateString()`, which compares days on the process clock — UTC in the
 * containers. At 06:30 on 17 Sep in Bangkok the UTC clock still reads 16 Sep,
 * so the 10:00 audit that morning was not "today" and yesterday afternoon's was.
 *
 * The difference only shows when this process runs outside Asia/Bangkok, so the
 * port report runs this file under TZ=UTC and TZ=America/Los_Angeles too.
 */

const path = require('path');

const HANDLERS_DIR = path.resolve(__dirname, '../../routes/api/provider/handlers');

// 06:30 on 17 Sep 2569 in Bangkok (still 16 Sep on a UTC clock).
const NOW = '2026-09-16T23:30:00.000Z';
const APPS = [
    // Four audits on 17 Sep in Bangkok (today): 08:00, 10:00, 14:00, 19:00.
    { id: 'today-8am', status: 'AUDIT_CONFIRMED', scheduledDate: '2026-09-17T01:00:00.000Z', auditorId: 'a-1' },
    { id: 'today-10am', status: 'AUDIT_CONFIRMED', scheduledDate: '2026-09-17T03:00:00.000Z', auditorId: 'a-1' },
    { id: 'today-2pm', status: 'AUDIT_CONFIRMED', scheduledDate: '2026-09-17T07:00:00.000Z', auditorId: 'a-1' },
    { id: 'today-7pm', status: 'AUDIT_CONFIRMED', scheduledDate: '2026-09-17T12:00:00.000Z', auditorId: 'a-1' },
    // 17:00 on 16 Sep in Bangkok — yesterday, though it is the same UTC day as NOW.
    { id: 'yesterday-5pm', status: 'AUDIT_CONFIRMED', scheduledDate: '2026-09-16T10:00:00.000Z', auditorId: 'a-1' },
];
// The process-clock comparison counts 1 of these on UTC and 3 in Los Angeles;
// the Bangkok day is 4, whatever the process zone.

function queueItem(application) {
    return {
        id: application.id,
        applicationId: application.id,
        applicationNumber: application.id,
        applicantName: 'x',
        workflowState: application.status,
        status: application.status,
        scheduledDate: application.scheduledDate,
        inspectionMode: 'ONSITE',
        phase2Paid: true,
        receiptIssued: true,
        auditorId: application.auditorId,
        auditorName: null,
        isRescheduleRequired: false,
        createdAt: NOW,
        updatedAt: NOW,
    };
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

function mockDeps() {
    jest.doMock(path.join(HANDLERS_DIR, 'scheduler-handler-deps.js'), () => ({
        authenticateProvider: (_req, _res, next) => next(),
        requireCanonicalPermission: () => (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
        PERMISSIONS: { APPLICATION_SCHEDULE: 'APPLICATION_SCHEDULE' },
        PROVIDERRoles: [],
        toInt: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
        dt: (v) => (v ? new Date(v) : null),
        computePhaseSettlement: () => ({ phasePaid: true, phaseReceiptIssued: true }),
        buildSchedulerQueueItem: (application) => queueItem(application),
        applicationService: {
            listSchedulerDashboardApplications: async () => APPS,
            listAuditorsByIds: async () => [],
        },
        invoiceService: { listSettlementsByApplicationIds: async () => [] },
        workActivityService: { countOverdueForGroup: async () => 0 },
    }));
    jest.doMock('../../services/application-service', () => ({
        listSchedulerScheduleApplications: async () => APPS,
    }));
    jest.doMock('../../services/provider-user-service', () => ({
        listAuditorsByIdsForScheduler: async () => [],
    }));
}

beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date(NOW));
    mockDeps();
});

afterEach(() => {
    jest.useRealTimers();
});

async function run(handlerArray, query = {}) {
    const fn = handlerArray[handlerArray.length - 1];
    const res = makeRes();
    await fn({ query, user: { id: 's-1', role: 'dispatcher', organizationId: 'org-1' } }, res);
    return res;
}

describe('scheduler "today" counts are Bangkok days', () => {
    it('the dashboard counts the four audits on 17 Sep as today at 06:30 on 17 Sep in Bangkok', async () => {
        const { schedulerDashboard } = require(path.join(HANDLERS_DIR, 'scheduler-dashboard-handler.js'));
        const res = await run(schedulerDashboard);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.kpi.scheduledToday).toBe(4);
    });

    it('the audit-schedules summary counts the same four audits as today', async () => {
        const { schedulerAuditSchedulesGet } = require(path.join(HANDLERS_DIR, 'scheduler-audit-schedules-get-handler.js'));
        const res = await run(schedulerAuditSchedulesGet, { queue: 'scheduled_upcoming' });
        expect(res.statusCode).toBe(200);
        expect(res.body.summary.today).toBe(4);
    });
});
