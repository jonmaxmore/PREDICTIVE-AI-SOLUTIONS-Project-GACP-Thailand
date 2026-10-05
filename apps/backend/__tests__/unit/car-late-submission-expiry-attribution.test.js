'use strict';

/**
 * AUDIT-TRAIL — a deadline expiry must not be recorded as the applicant's act.
 *
 * POST /api/applications/:id/car expires the application inline when the
 * applicant uploads CAR evidence after carDueAt. The expiry itself is correct
 * business behaviour — the deadline passed — but three things about HOW it was
 * recorded were wrong:
 *
 * 1. FALSE ATTRIBUTION. It wrote `actorId: req.user.id` and
 *    `actorRole: <the applicant's role>` on both the status write and the
 *    workflow event. The audit trail therefore said the APPLICANT cancelled
 *    their own fully-paid application. They did not: the deadline did, and
 *    their request merely discovered it. This is the compliance record for a
 *    government certification, and it is read by people deciding whether a
 *    cancellation was the applicant's choice or the system's ruling.
 *
 *    The perverse incentive follows directly: an applicant who submits late is
 *    recorded as having withdrawn, while an applicant who submits NOTHING is
 *    expired by the cron as `actorId: 'cron', actorRole: 'system'` — the
 *    accurate record. Trying to comply produced the worse audit trail.
 *
 * 2. INCONSISTENT STATE. The cron's expiry also flips any PENDING/EXTENDED
 *    RevisionDeadline row to FAILED (cron.js:289-299). The inline path did
 *    not, leaving a deadline row still PENDING against an EXPIRED application
 *    — which the overdue queries then keep reporting.
 *
 * 3. NOT ATOMIC. The cron wraps both writes in one $transaction. The inline
 *    path wrote the status with no transaction, so a failure between the two
 *    halves left exactly the split state (2) describes.
 *
 * The fix aligns the inline path with the cron — the same actor, the same
 * companion write, in one transaction — so the two writers of this transition
 * cannot disagree about what happened. The rejection response is unchanged.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// multer is constructed at module load; hand the route a middleware that
// injects an already-"uploaded" file so the handler reaches the deadline gate.
jest.mock('multer', () => {
    const multer = () => ({
        array: () => (req, _res, next) => {
            req.files = [{ filename: 'car-1.pdf', originalname: 'car.pdf', size: 1234 }];
            next();
        },
    });
    multer.diskStorage = () => ({});
    return multer;
});

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = {
            id: 'applicant-user-1',
            canonicalRole: 'health',
            role: 'HEALTH',
            organizationId: 'org-1',
        };
        next();
    },
}));

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({ id: 'APP-1' });
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

const mockDeadlineUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
const mockTransaction = jest.fn(async (cb) => cb({
    __tx: true,
    revisionDeadline: { updateMany: (...a) => mockDeadlineUpdateMany(...a) },
    // R2 M7: the within-deadline CAR resubmit now appends an append-only
    // snapshot in the same tx. No correction round is seeded (findFirst → null)
    // so the snapshot is a no-op here; the expiry-attribution assertions are
    // unaffected. The append-only behaviour itself is covered by the M7
    // integration test.
    correctionRound: { findFirst: jest.fn(async () => null) },
    correctionSubmissionVersion: { create: jest.fn(async (a) => ({ id: 'csv-mock', ...a.data })) },
}));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: (...a) => mockTransaction(...a),
        revisionDeadline: { updateMany: (...a) => mockDeadlineUpdateMany(...a) },
    },
}));

const mockFindOwned = jest.fn();
// M1 PR-C — the CAR door runs the central submit guard before it decides
// anything. A null holder is refused, never healed (R2 Task 8, spec 2026-09-30 C3).
jest.mock('../../services/application-service', () => ({
    findOwnedApplicationForApplicant: (...a) => mockFindOwned(...a),
}));

// M1 PR-C — guard dependencies, mocked with their real shapes (plan D5/D10).
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(async () => ({ allowed: true, via: 'ENTITY_PERMISSION' })),
}));
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            logWithin: jest.fn(() => jest.fn()),
        },
    };
});

jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: {},
}));
jest.mock('../../services/provider-user-service', () => ({
    listActiveProviders: jest.fn().mockResolvedValue([]),
}));

const router = require('../../routes/api/applications/applications-car');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', router);
    return app;
}

// CAR requested, deadline already in the past. The applicant uploads anyway.
const OVERDUE_CAR = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0001',
    status: 'CAR_PENDING',
    organizationId: 'org-1',
    healthId: 'applicant-canonical',
    // M1 PR-C: the row names the entity it is submitted for; without one the
    // guard refuses the request before the deadline is ever consulted (D7).
    entityId: 'ent-1',
    formData: {
        workflowState: 'CAR_PENDING',
        carDueAt: '2026-07-01T00:00:00.000Z',
        car_due_at: '2026-07-01T00:00:00.000Z',
    },
    workflowHistory: [],
};

function statusWriteArg() {
    return mockWriteApplicationStatus.mock.calls[0][0];
}

describe('AUDIT-TRAIL — late CAR submission expires as the SYSTEM, not the applicant', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindOwned.mockResolvedValue(JSON.parse(JSON.stringify(OVERDUE_CAR)));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'APP-1' });
        app = buildApp();
    });

    const post = () => request(app).post('/api/applications/APP-1/car').send({ notes: 'ส่งหลักฐาน' });

    test('the expiry is still enforced and the late evidence is rejected', async () => {
        const res = await post();

        expect(res.status).toBe(400);
        expect(statusWriteArg().toStatus).toBe('EXPIRED');
        // Exactly one status write — the late evidence must not also be accepted.
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
    });

    test('does NOT record the applicant as the actor who cancelled', async () => {
        await post();

        const arg = statusWriteArg();
        expect(arg.actorId).not.toBe('applicant-user-1');
        expect(String(arg.actorRole || '').toLowerCase()).not.toBe('health');
    });

    test('attributes the expiry to the system, matching the cron', async () => {
        await post();

        const arg = statusWriteArg();
        expect(String(arg.actorRole)).toBe('system');
        expect(String(arg.actorId)).toMatch(/system/i);
    });

    test('the workflow event carries the same system attribution', async () => {
        await post();

        const events = statusWriteArg().additionalData.workflowHistory;
        const expiryEvent = events[events.length - 1];
        expect(expiryEvent.action).toBe('CAR_DEADLINE_EXPIRED');
        expect(String(expiryEvent.actorRole)).toBe('system');
        expect(String(expiryEvent.actorId)).not.toBe('applicant-user-1');
    });

    test('also fails the open RevisionDeadline row, as the cron does', async () => {
        await post();

        expect(mockDeadlineUpdateMany).toHaveBeenCalled();
        const arg = mockDeadlineUpdateMany.mock.calls[0][0];
        expect(arg.where.applicationId).toBe('APP-1');
        expect(arg.where.status.in).toEqual(expect.arrayContaining(['PENDING', 'EXTENDED']));
        expect(arg.data.status).toBe('FAILED');
    });

    test('performs both writes in one transaction', async () => {
        await post();

        expect(mockTransaction).toHaveBeenCalled();
    });

    test('a submission INSIDE the deadline is unaffected', async () => {
        mockFindOwned.mockResolvedValue({
            ...JSON.parse(JSON.stringify(OVERDUE_CAR)),
            formData: {
                workflowState: 'CAR_PENDING',
                carDueAt: '2099-01-01T00:00:00.000Z',
                car_due_at: '2099-01-01T00:00:00.000Z',
            },
        });

        const res = await post();

        expect(res.status).toBe(200);
        expect(statusWriteArg().toStatus).toBe('CAR_REVIEWING');
        expect(mockDeadlineUpdateMany).not.toHaveBeenCalled();
    });
});
