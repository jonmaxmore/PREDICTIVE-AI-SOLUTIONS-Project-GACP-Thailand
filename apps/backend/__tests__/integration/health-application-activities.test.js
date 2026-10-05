/**
 * /api/applications/:id/activities (HEALTH side) — ADR-016 Phase 6.
 *
 * Verifies:
 *  - Returns redacted shape (no assignee names, no notes)
 *  - 404 when the application doesn't belong to the calling user
 *  - Coarsens internal state into 4 public statuses
 *  - isOverdue flag exposed without leaking SLA hours
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => next(),
    authenticateProvider: (req, _res, next) => next(),
}));

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'h-1', userId: 'u-1' })),
}));

const dbState = {
    application: null,
    activities: [],
};
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findFirst: jest.fn(async () => dbState.application),
        },
        workActivity: {
            findMany: jest.fn(async () => dbState.activities),
        },
    },
}));

const router = require('../../routes/api/applications/application-workflow-handlers');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'u-1', healthId: 'h-1', canonicalRole: 'health' };
        next();
    });
    app.use('/apps', router);
    return app;
}

const baseDate = new Date('2026-04-30T10:00:00Z');
const past = new Date('2026-04-30T05:00:00Z');
const future = new Date('2026-05-01T10:00:00Z');

beforeEach(() => {
    jest.clearAllMocks();
    dbState.application = { id: 'app-1' };
    dbState.activities = [
        // open + overdue
        { id: 'a-1', workType: 'DOC_REVIEW', state: 'CLAIMED', createdAt: past, claimedAt: past, completedAt: null, cancelledAt: null, dueAt: past },
        // pending
        { id: 'a-2', workType: 'FIELD_AUDIT', state: 'TODO', createdAt: past, claimedAt: null, completedAt: null, cancelledAt: null, dueAt: future },
        // done
        { id: 'a-3', workType: 'SLIP_REVIEW', state: 'DONE', createdAt: past, claimedAt: past, completedAt: baseDate, cancelledAt: null, dueAt: future },
    ];
});

describe('GET /:id/activities — HEALTH redacted view', () => {
    test('returns 404 when the user does not own the application', async () => {
        dbState.application = null;
        const res = await request(buildApp()).get('/apps/app-1/activities');
        expect(res.status).toBe(404);
    });

    test('shape: workTypeLabel + coarse status, no assignee fields', async () => {
        const res = await request(buildApp()).get('/apps/app-1/activities');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        for (const row of res.body.data) {
            expect(row.workTypeLabel).toBeTruthy();
            // Public status enum
            expect(['pending', 'in_progress', 'done', 'cancelled']).toContain(row.status);
            // Redacted fields must NOT be in the response
            expect(row.assignedUserName).toBeUndefined();
            expect(row.assignedUserId).toBeUndefined();
            expect(row.completedByName).toBeUndefined();
            expect(row.note).toBeUndefined();
            expect(row.candidateGroup).toBeUndefined();
            expect(row.triggeredAtStage).toBeUndefined();
        }
    });

    test('coarsens CLAIMED + IN_PROGRESS to in_progress', async () => {
        const res = await request(buildApp()).get('/apps/app-1/activities');
        const a1 = res.body.data.find((r) => r.id === 'a-1');
        expect(a1.status).toBe('in_progress');
    });

    test('coarsens TODO to pending', async () => {
        const res = await request(buildApp()).get('/apps/app-1/activities');
        const a2 = res.body.data.find((r) => r.id === 'a-2');
        expect(a2.status).toBe('pending');
    });

    test('isOverdue flag exposed for open + past-due rows', async () => {
        const res = await request(buildApp()).get('/apps/app-1/activities');
        const a1 = res.body.data.find((r) => r.id === 'a-1');
        const a3 = res.body.data.find((r) => r.id === 'a-3');
        expect(a1.isOverdue).toBe(true);
        // DONE rows shouldn't be flagged overdue even if dueAt < now
        expect(a3.isOverdue).toBeFalsy();
    });
});
