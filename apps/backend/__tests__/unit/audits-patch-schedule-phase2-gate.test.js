'use strict';

/**
 * PATCH /api/audits/:id/schedule — the round-2 payment gate.
 *
 * Business rule: an on-site field inspection may not be queued until the
 * applicant's round-2 (field-inspection fee) slip has been APPROVED by
 * accounting. The canonical scheduler handler enforces this in two layers —
 * `resolveStateFromApplication(app) === 'AUDIT_FEE_PAID'` and
 * `isPhase2PaymentConfirmed(app)` — at
 * routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js:107-121.
 *
 * PATCH /:id/schedule writes the SAME two columns (`scheduledDate`,
 * `auditorId`) and carried neither check: it looked the application up with
 * `select: { id: true }` purely to confirm tenancy, then wrote. A SCHEDULER
 * could therefore assign an auditor and an inspection date to an application
 * sitting in PENDING_AUDIT_FEE with no slip ever uploaded.
 *
 * That write is not cosmetic. Setting `auditorId` makes the assigned auditor
 * satisfy `requireApplicationOwner` (shared/application-owner-gate.js:73-76),
 * which opens the checklist-create and on-site GPS check-in paths for an
 * unpaid application. The final PASS decision still fails closed on
 * `assertTransition`, so no certificate can be minted — but the field visit
 * itself proceeds, which is exactly what the gate exists to prevent.
 *
 * RED (pre-fix): both writes return 200 and reach updateApplicationColumns.
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

// Auth shim: a SCHEDULER — the role the queue department actually holds, and
// the one ROLE_GROUPS.SCHEDULERS admits to this route.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = {
            id: 'scheduler-1',
            role: 'SCHEDULER',
            canonicalRole: 'scheduler',
            organizationId: 'org-1',
        };
        next();
    },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: {},
}));

jest.mock('../../services/farm-service', () => ({ updateFarmFromAudit: jest.fn() }));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/application-visibility', () => ({ withVisibility: (where) => where }));
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(),
    seedCarRevisionDeadline: jest.fn(),
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

// The settlement projection is the real payment source of truth. Returning no
// invoices is the honest representation of "round-2 fee never settled" — the
// gate's own computePhaseSettlement runs for real against it.
const mockListSettlements = jest.fn().mockResolvedValue([]);
jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: (...a) => mockListSettlements(...a),
}));

const mockFindFirstWithWhere = jest.fn();
const mockUpdateApplicationColumns = jest.fn().mockResolvedValue({ id: 'APP-1' });
jest.mock('../../services/application-service', () => ({
    findFirstWithWhere: (...a) => mockFindFirstWithWhere(...a),
    updateApplicationColumns: (...a) => mockUpdateApplicationColumns(...a),
    findAuditApplication: jest.fn(),
    getById: jest.fn(),
}));

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/audits', require('../../routes/api/audit/audits'));
    return app;
}

// Round-2 fee invoiced but never paid, no slip approved. This is the state an
// application sits in between "document audit passed" and "accounting approves
// the round-2 slip" — precisely the window the gate must hold shut.
const UNPAID_PHASE_2 = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0001',
    status: 'PENDING_AUDIT_FEE',
    phase2Status: 'PENDING',
    auditorId: null,
    scheduledDate: null,
    formData: {},
    organizationId: 'org-1',
};

describe('PATCH /audits/:id/schedule refuses to queue a field inspection before round-2 payment is approved', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockListSettlements.mockResolvedValue([]);
        mockFindFirstWithWhere.mockResolvedValue({ ...UNPAID_PHASE_2 });
        mockUpdateApplicationColumns.mockResolvedValue({ id: 'APP-1' });
        app = buildApp();
    });

    test('assigning an auditor to an unpaid application is rejected and writes nothing', async () => {
        const res = await request(app)
            .patch('/audits/APP-1/schedule')
            .send({ auditorId: 'auditor-9' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(mockUpdateApplicationColumns).not.toHaveBeenCalled();
    });

    test('setting an inspection date on an unpaid application is rejected and writes nothing', async () => {
        const res = await request(app)
            .patch('/audits/APP-1/schedule')
            .send({ scheduledDate: '2026-08-14', scheduledTime: '09:00' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(mockUpdateApplicationColumns).not.toHaveBeenCalled();
    });

    test('the tenancy lookup selects the columns the gate needs, not just id', async () => {
        // The pre-fix handler selected `{ id: true }`, which is why no gate
        // could run here: the row it held carried no status and no
        // phase2Status. Pinning the projection keeps a later refactor from
        // quietly narrowing it and disabling the gate again.
        await request(app).patch('/audits/APP-1/schedule').send({ auditorId: 'auditor-9' });

        expect(mockFindFirstWithWhere).toHaveBeenCalledTimes(1);
        const { select } = mockFindFirstWithWhere.mock.calls[0][0];
        expect(select).toEqual(expect.objectContaining({
            id: true,
            status: true,
            phase2Status: true,
            formData: true,
        }));
    });

    test('a settled round-2 fee lets the same request through', async () => {
        mockFindFirstWithWhere.mockResolvedValue({
            ...UNPAID_PHASE_2,
            status: 'AUDIT_FEE_PAID',
            phase2Status: 'PAID',
        });

        const res = await request(app)
            .patch('/audits/APP-1/schedule')
            .send({ auditorId: 'auditor-9', scheduledDate: '2026-08-14' });

        expect(res.status).toBe(200);
        expect(mockUpdateApplicationColumns).toHaveBeenCalledTimes(1);
        const [, updateData] = mockUpdateApplicationColumns.mock.calls[0];
        expect(updateData.auditorId).toBe('auditor-9');
    });
});
