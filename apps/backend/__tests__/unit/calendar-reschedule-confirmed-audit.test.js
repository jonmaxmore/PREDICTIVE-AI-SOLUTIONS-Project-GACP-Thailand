'use strict';

/**
 * Defect batch B item 1 — the calendar "เลื่อนนัด" button.
 *
 * The button posts to POST /api/provider/scheduler/audits/schedules, which accepted ONLY
 * AUDIT_FEE_PAID. An application that was already AUDIT_CONFIRMED (the only state where a
 * reschedule is meaningful) got a 400, so a reschedule could not be done from the screen.
 *
 * One door now does both. For an already-confirmed audit it keeps the same guards as a first
 * booking (future working day, <= AUDITOR_MAX_PER_DAY per inspector per day, no clash,
 * inspector of the same organisation and the inspector role), writes the new date without a
 * status transition (AUDIT_CONFIRMED -> AUDIT_CONFIRMED is not a legal edge), keeps the
 * evidence row's auditor in step, and tells the farmer and the inspector in Thai.
 */

const path = require('path');

const HANDLER = path.resolve(__dirname, '../../routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js');

function futureWorkingDay(offsetDays = 10, hourUtc = 3) {
    const { isWorkingDay } = jest.requireActual('../../utils/working-days');
    const d = new Date(Date.now() + offsetDays * 24 * 3600 * 1000);
    d.setUTCHours(hourUtc, 0, 0, 0);
    while (!isWorkingDay(d)) { d.setUTCDate(d.getUTCDate() + 1); }
    return d;
}
function nextSaturday() {
    const d = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    d.setUTCHours(3, 0, 0, 0);
    while (new Date(d.getTime() + 7 * 3600 * 1000).getUTCDay() !== 6) { d.setUTCDate(d.getUTCDate() + 1); }
    return d;
}

function build({ app, auditor, others = [], collisionCandidates = [], reviewerId = null } = {}) {
    jest.resetModules();
    const confirmedDate = futureWorkingDay(6, 2);
    const baseApp = {
        id: 'app-1',
        applicationNumber: 'GACP-2569-0001',
        healthId: 'health-1',
        status: 'AUDIT_CONFIRMED',
        phase2Status: 'PAID',
        auditorId: 'insp-old',
        reviewerId,
        organizationId: 'org-1',
        scheduledDate: confirmedDate,
        formData: {
            workflowState: 'AUDIT_CONFIRMED',
            auditSchedule: { scheduledDate: confirmedDate.toISOString(), auditorId: 'insp-old', inspectionMode: 'ONSITE', estimatedDuration: 120 },
        },
        workflowHistory: [],
        ...(app || {}),
    };
    const insp = auditor === undefined
        ? { id: 'insp-new', role: 'field_inspector', firstName: 'สมหญิง', lastName: 'ตรวจดี', email: 'x@example.test' }
        : auditor;

    const txCalls = { appUpdate: [], checklistUpdateMany: [] };
    const tx = {
        application: {
            update: jest.fn(async (args) => { txCalls.appUpdate.push(args); return { ...baseApp, ...args.data }; }),
            findUnique: jest.fn(async () => ({ formData: baseApp.formData })),
            findMany: jest.fn(async () => others),
        },
        auditChecklist: {
            findFirst: jest.fn(async () => ({ id: 'chk-1' })),
            updateMany: jest.fn(async (args) => { txCalls.checklistUpdateMany.push(args); return { count: 1 }; }),
            update: jest.fn(),
            create: jest.fn(),
        },
    };
    const prisma = {
        ...tx,
        application: { ...tx.application, findMany: jest.fn(async () => others) },
        $transaction: jest.fn(async (cb) => cb(tx)),
    };

    const writeApplicationStatus = jest.fn().mockResolvedValue({});
    const createNotification = jest.fn().mockResolvedValue({ id: 'n' });
    const notifyAuditScheduled = jest.fn().mockResolvedValue(undefined);
    const armOnsiteEvidence = jest.fn().mockResolvedValue({ armed: true, canLeadToCertificate: true, reason: null });

    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../services/application-status-writer', () => ({ writeApplicationStatus }));
    jest.doMock('../../services/notification-service', () => ({ createNotification }));
    jest.doMock('../../services/audit/audit-schedule-notices', () => ({ notifyAuditScheduled }));
    jest.doMock('../../services/audit/arm-onsite-evidence', () => ({
        ...jest.requireActual('../../services/audit/arm-onsite-evidence'),
        armOnsiteEvidence,
    }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { APPLICATION: 'APPLICATION' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { APPLICATION: 'APPLICATION' },
    }));
    jest.doMock('../../services/application-service', () => ({
        findFirstWithWhere: jest.fn(async () => baseApp),
        findAuditorScheduleCandidates: jest.fn(async () => collisionCandidates),
        getById: jest.fn(async () => ({ ...baseApp })),
    }));
    jest.doMock('../../services/provider-user-service', () => ({
        findActiveProviderById: jest.fn(async () => insp),
    }));
    const qu = jest.requireActual('../../routes/api/provider/handlers/queue-utils');
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    jest.doMock('../../routes/api/provider/handlers/scheduler-handler-deps', () => ({
        authenticateProvider: (_q, _r, n) => n(),
        requireCanonicalPermission: () => (_q, _r, n) => n(),
        PERMISSIONS: { APPLICATION_SCHEDULE: 'x' },
        logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        normalizeRole: jest.requireActual('../../shared/canonical-rbac').normalizeRole,
        CANONICAL_ROLES: jest.requireActual('../../shared/canonical-rbac').CANONICAL_ROLES,
        toInt: (v, d, mn, mx) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(mx, Math.max(mn, n)) : d; },
        obj,
        arr: (v) => (Array.isArray(v) ? v : []),
        dt: (v) => { if (!v) { return null; } const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; },
        prisma,
        workflowTransitionService: jest.requireActual('../../services/workflow-transition-service'),
        getRequestIp: () => '127.0.0.1',
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { APPLICATION: 'APPLICATION' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { APPLICATION: 'APPLICATION' },
        normalizeInspectionModeInput: qu.normalizeInspectionModeInput,
        isValidHttpUrl: qu.isValidHttpUrl,
        resolveAuditSchedule: qu.resolveAuditSchedule,
        hasScheduleCollision: qu.hasScheduleCollision,
        getApplicantName: (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim(),
        resolveUserIdFromHealthId: jest.fn(async () => 'farmer-1'),
        isPhase2PaymentConfirmed: jest.fn(async () => true),
        isWorkingDay: jest.requireActual('../../utils/working-days').isWorkingDay,
    }));

    const handler = require(HANDLER).schedulerAuditSchedulesPost.slice(-1)[0];
    return { handler, tx, prisma, txCalls, writeApplicationStatus, notifyAuditScheduled, armOnsiteEvidence, baseApp };
}

function call(handler, body) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(p) { resolve({ status: this.statusCode, body: p }); return this; },
        };
        const req = {
            body,
            user: { id: 'disp-1', role: 'dispatcher', canonicalRole: 'dispatcher', organizationId: 'org-1' },
            get: () => 'jest',
        };
        handler(req, res);
    });
}

const bodyFor = (when, extra = {}) => ({
    applicationId: 'app-1', auditorId: 'insp-new', scheduledDate: when.toISOString(),
    inspectionMode: 'ONSITE', location: 'ฟาร์มสวนสุข', estimatedDuration: 120, ...extra,
});

describe('calendar door reschedules an already-confirmed audit', () => {
    test('AUDIT_CONFIRMED is accepted (was 400 "must be in AUDIT_FEE_PAID") and reported as a reschedule', async () => {
        const h = build();
        const when = futureWorkingDay(14, 3);
        const out = await call(h.handler, bodyFor(when));
        expect(out.status).toBe(201);
        expect(out.body.success).toBe(true);
        expect(out.body.message).toBe('Audit rescheduled successfully');
    });

    test('writes the new date + auditor + schedule record, with NO status transition', async () => {
        const h = build();
        const when = futureWorkingDay(14, 3);
        await call(h.handler, bodyFor(when));
        expect(h.writeApplicationStatus).not.toHaveBeenCalled();
        expect(h.txCalls.appUpdate).toHaveLength(1);
        const { where, data } = h.txCalls.appUpdate[0];
        expect(where).toEqual({ id: 'app-1' });
        expect(data.scheduledDate.toISOString()).toBe(when.toISOString());
        expect(data.auditorId).toBe('insp-new');
        expect(data.status).toBeUndefined();
        expect(data.formData.auditSchedule.scheduledDate).toBe(when.toISOString());
        expect(data.formData.auditSchedule.auditorId).toBe('insp-new');
        expect(data.formData.workflowState).toBe('AUDIT_CONFIRMED');
        const ev = data.workflowHistory.slice(-1)[0];
        expect(ev.action).toBe('AUDIT_RESCHEDULED');
        expect(ev.metadata.previousAuditorId).toBe('insp-old');
    });

    test('the inspector evidence row follows the new auditor, inside the same transaction', async () => {
        const h = build();
        await call(h.handler, bodyFor(futureWorkingDay(14, 3)));
        expect(h.prisma.$transaction).toHaveBeenCalled();
        expect(h.txCalls.checklistUpdateMany).toHaveLength(1);
        const { where, data } = h.txCalls.checklistUpdateMany[0];
        expect(where).toMatchObject({ applicationId: 'app-1', isDeleted: false, status: 'IN_PROGRESS' });
        expect(data.auditorId).toBe('insp-new');
        expect(h.armOnsiteEvidence.mock.calls[0][0]).toBe(h.tx);
    });

    test('farmer and inspector are notified through the shared builder, flagged as a reschedule', async () => {
        const h = build();
        const when = futureWorkingDay(14, 3);
        await call(h.handler, bodyFor(when));
        expect(h.notifyAuditScheduled).toHaveBeenCalledTimes(1);
        const arg = h.notifyAuditScheduled.mock.calls[0][0];
        expect(arg).toMatchObject({ farmerUserId: 'farmer-1', auditorId: 'insp-new', rescheduled: true, applicationNumber: 'GACP-2569-0001' });
        expect(new Date(arg.scheduledAt).toISOString()).toBe(when.toISOString());
        expect(new Date(arg.previousScheduledAt).getTime()).toBe(h.baseApp.scheduledDate.getTime());
    });

    test('guard: a weekend is refused', async () => {
        const h = build();
        const out = await call(h.handler, bodyFor(nextSaturday()));
        expect(out.status).toBe(400);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });

    test('guard: a past date is refused', async () => {
        const h = build();
        const out = await call(h.handler, bodyFor(new Date(Date.now() - 3600 * 1000)));
        expect(out.status).toBe(400);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });

    test('guard: the third booking of one inspector on one day is refused (cap 2)', async () => {
        const when = futureWorkingDay(14, 3);
        const other = (id, hourUtc) => {
            const d = new Date(when); d.setUTCHours(hourUtc, 0, 0, 0);
            return { id, applicationNumber: id, scheduledDate: d, status: 'AUDIT_CONFIRMED' };
        };
        const h = build({ others: [other('o1', 0), other('o2', 8)] });
        const out = await call(h.handler, bodyFor(when));
        expect(out.status).toBe(409);
        expect(out.body.code || out.body.error).toMatch(/OVER_CAP|2/);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });

    test('guard: an overlapping booking of the same inspector is refused', async () => {
        const when = futureWorkingDay(14, 3);
        const h = build({ collisionCandidates: [{ id: 'o1', applicationNumber: 'O-1', scheduledDate: when, formData: { auditSchedule: { estimatedDuration: 120 } } }] });
        const out = await call(h.handler, bodyFor(when));
        expect(out.status).toBe(409);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });

    test('guard: an inspector of another organisation (not found under the org filter) is refused', async () => {
        const h = build({ auditor: null });
        const out = await call(h.handler, bodyFor(futureWorkingDay(14, 3)));
        expect(out.status).toBe(404);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });

    test('guard: a user without the inspector role is refused', async () => {
        const h = build({ auditor: { id: 'insp-new', role: 'document_reviewer', firstName: 'ก', lastName: 'ข' } });
        const out = await call(h.handler, bodyFor(futureWorkingDay(14, 3)));
        expect(out.status).toBe(400);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });

    test('a state that is neither AUDIT_FEE_PAID nor AUDIT_CONFIRMED is still refused', async () => {
        const h = build({ app: { status: 'AUDIT_PASSED', formData: { workflowState: 'AUDIT_PASSED' } } });
        const out = await call(h.handler, bodyFor(futureWorkingDay(14, 3)));
        expect(out.status).toBe(400);
    });

    test('first booking (AUDIT_FEE_PAID) still goes through the status writer', async () => {
        const h = build({ app: { status: 'AUDIT_FEE_PAID', auditorId: null, scheduledDate: null, formData: { workflowState: 'AUDIT_FEE_PAID' } } });
        const out = await call(h.handler, bodyFor(futureWorkingDay(14, 3)));
        expect(out.status).toBe(201);
        expect(h.writeApplicationStatus).toHaveBeenCalledTimes(1);
        expect(h.notifyAuditScheduled.mock.calls[0][0].rescheduled).toBeFalsy();
    });
});

describe('item 7 at the calendar door: the document reviewer cannot be the inspector', () => {
    test('assigning the application\'s own document reviewer as inspector is refused with a Thai catalogue error', async () => {
        const h = build({ reviewerId: 'insp-new' });
        const out = await call(h.handler, bodyFor(futureWorkingDay(14, 3)));
        expect(out.status).toBe(409);
        expect(out.body.code).toBe('INSPECTOR_IS_APPLICATION_REVIEWER');
        expect(out.body.messageTh).toMatch(/[฀-๿]/);
        expect(h.txCalls.appUpdate).toHaveLength(0);
    });
});
