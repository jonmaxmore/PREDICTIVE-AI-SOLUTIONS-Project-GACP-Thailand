'use strict';

/**
 * SEC/LOGIC — POST /api/audits/schedule silently reverted its own state change.
 *
 * The handler builds a canonical transition to AUDIT_CONFIRMED via
 * buildTransitionUpdate(), then writes:
 *
 *     formData: {
 *         ...transition.updateData.formData,   // carries workflowState: AUDIT_CONFIRMED
 *         ...existingFormData,                 // <- puts the OLD workflowState back
 *         auditMode, meetingUrl, auditLocation,
 *     }
 *
 * The spread order is backwards. `transition.updateData.formData` is already
 * `{...application.formData, workflowState: nextState, workflowStateUpdatedAt}`,
 * so `existingFormData` contributes nothing EXCEPT undoing the two fields the
 * transition exists to set. It is not a merge — it is a revert.
 *
 * The result is a split brain, because the two halves of the write disagree:
 *   • the `status` COLUMN becomes AUDIT_CONFIRMED (from ...transition.updateData)
 *   • `formData.workflowState` stays on the PREVIOUS state
 *
 * and resolveStateFromApplication (workflow-transition-service.js:364-372)
 * reads formData.workflowState FIRST, falling back to `status` only when it is
 * absent. So the stale value is the one the state machine believes.
 *
 * Two consequences follow:
 *
 *  1. buildTransitionUpdate throws "already in workflow state" when
 *     fromState === nextState. Since fromState never advances to
 *     AUDIT_CONFIRMED, that guard never fires — POST /schedule can be replayed
 *     indefinitely, each call silently rewriting scheduledDate and auditorId on
 *     a confirmed audit.
 *  2. Every later transition computes its `fromState` from the stale value, so
 *     the legal edges out of AUDIT_CONFIRMED are unreachable and the ones out
 *     of the previous state are still open.
 *
 * The fix is to delete the `...existingFormData` spread. Nothing is lost:
 * the transition's formData is a superset of it by construction.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: { $transaction: jest.fn(async (cb) => cb({ __tx: true })) },
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'scheduler-1', role: 'dispatcher', canonicalRole: 'dispatcher', organizationId: 'org-1' };
        next();
    },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: { AUDIT_SCHEDULED: 'AUDIT_SCHEDULED' },
}));
jest.mock('../../services/farm-service', () => ({ updateFarmFromAudit: jest.fn() }));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/application-visibility', () => ({ withVisibility: (where) => where }));
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(), seedCarRevisionDeadline: jest.fn(),
}));
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: jest.fn(() => jest.fn()),
}));
jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
}));

const mockFindByIdOrNumber = jest.fn();
const mockUpdateApplicationColumns = jest.fn().mockResolvedValue({ id: 'APP-1' });
jest.mock('../../services/application-service', () => ({
    findByIdOrApplicationNumber: (...a) => mockFindByIdOrNumber(...a),
    updateApplicationColumns: (...a) => mockUpdateApplicationColumns(...a),
    findFirstWithWhere: jest.fn(),
    findAuditApplication: jest.fn(),
    getById: jest.fn(),
}));

// The REAL state machine — the whole point is what it believes afterwards.
const { resolveStateFromApplication } = require('../../services/workflow-transition-service');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/audits', require('../../routes/api/audit/audits'));
    return app;
}

// Round-2 fee settled: the state POST /schedule legitimately moves forward from.
const READY_TO_SCHEDULE = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0001',
    status: 'AUDIT_FEE_PAID',
    organizationId: 'org-1',
    healthId: 'applicant-canonical',
    auditorId: null,
    scheduledDate: null,
    formData: {
        workflowState: 'AUDIT_FEE_PAID',
        // Applicant/staff data that must survive the write untouched.
        applicantData: { firstName: 'สมชาย' },
        carDueAt: '2026-09-01T00:00:00.000Z',
    },
};

function writtenFormData() {
    return mockUpdateApplicationColumns.mock.calls[0][1].formData;
}

describe('SEC/LOGIC — POST /audits/schedule persists the state it transitions to', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindByIdOrNumber.mockResolvedValue(JSON.parse(JSON.stringify(READY_TO_SCHEDULE)));
        mockUpdateApplicationColumns.mockResolvedValue({ id: 'APP-1' });
        app = buildApp();
    });

    const post = (body = {}) => request(app).post('/audits/schedule').send({
        applicationId: 'APP-1', scheduledDate: '2026-09-15', scheduledTime: '10:00', ...body,
    });

    test('writes the NEW workflowState, not the stale one', async () => {
        const res = await post();

        expect(res.status).toBe(200);
        expect(writtenFormData().workflowState).toBe('AUDIT_CONFIRMED');
    });

    test('the status column and formData.workflowState agree (no split brain)', async () => {
        await post();

        const written = mockUpdateApplicationColumns.mock.calls[0][1];
        // resolveStateFromApplication reads formData.workflowState FIRST, so a
        // disagreement means the state machine follows the stale half.
        expect(resolveStateFromApplication({
            status: written.status,
            formData: written.formData,
        })).toBe('AUDIT_CONFIRMED');
    });

    test('stamps workflowStateUpdatedAt rather than reverting it', async () => {
        await post();

        expect(writtenFormData().workflowStateUpdatedAt).toBeTruthy();
    });

    test('still preserves the applicant and staff data already in formData', async () => {
        await post();

        const fd = writtenFormData();
        expect(fd.applicantData).toEqual({ firstName: 'สมชาย' });
        expect(fd.carDueAt).toBe('2026-09-01T00:00:00.000Z');
    });

    test('still records the scheduling inputs', async () => {
        await post({ auditMode: 'ONLINE', meetingUrl: 'https://meet.example/x' });

        const written = mockUpdateApplicationColumns.mock.calls[0][1];
        expect(written.auditorId).toBeNull();
        expect(written.scheduledDate).toBeInstanceOf(Date);
        expect(written.formData.auditMode).toBe('ONLINE');
        expect(written.formData.meetingUrl).toBe('https://meet.example/x');
    });

    test('a second schedule attempt on the now-confirmed application is refused', async () => {
        // Feed back what the FIRST call wrote — the real persisted shape.
        await post();
        const persisted = mockUpdateApplicationColumns.mock.calls[0][1];
        mockUpdateApplicationColumns.mockClear();
        mockFindByIdOrNumber.mockResolvedValue({
            ...READY_TO_SCHEDULE,
            status: persisted.status,
            formData: persisted.formData,
        });

        const res = await post();

        // buildTransitionUpdate throws "already in workflow state AUDIT_CONFIRMED".
        // With the stale write this replayed forever, silently rewriting the
        // date and auditor of a confirmed audit.
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(mockUpdateApplicationColumns).not.toHaveBeenCalled();
    });
});
