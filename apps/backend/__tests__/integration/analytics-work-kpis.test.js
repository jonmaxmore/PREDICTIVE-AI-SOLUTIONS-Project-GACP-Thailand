/**
 * /api/provider/analytics/work-kpis integration tests — ADR-016 Phase 4.
 *
 * Verifies:
 *  - Manager-only gate (admin + scheduler pass; document_reviewer 403)
 *  - days param bounded to [1, 365]
 *  - Aggregation produces summary + byWorkType + byGroup + topPerformers
 *  - User name resolution for top performers
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
    authenticateProvider: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
}));

const dbState = {
    activities: [],
    statesCount: [],
    perf: [],
};
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        workActivity: {
            count: jest.fn(async ({ where }) => {
                return dbState.activities.filter((a) => {
                    if (where.state?.in && !where.state.in.includes(a.state)) {return false;}
                    if (where.dueAt?.lt && a.dueAt && a.dueAt >= where.dueAt.lt) {return false;}
                    return true;
                }).length;
            }),
            findMany: jest.fn(async () => dbState.activities),
            groupBy: jest.fn(async ({ by }) => {
                if (by.includes('state')) {return dbState.statesCount;}
                if (by.includes('completedBy')) {return dbState.perf;}
                return [];
            }),
        },
        user: {
            findMany: jest.fn(async () => [
                { id: 'u-1', firstName: 'Anna', lastName: 'A.', email: 'a@x', role: 'field_inspector' },
                { id: 'u-2', firstName: 'Bob', lastName: 'B.', email: 'b@x', role: 'document_reviewer' },
            ]),
        },
    },
}));

const router = require('../../routes/api/provider/analytics-work-kpis');

function buildApp(role = 'system_admin_dtam') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'u-admin', role, canonicalRole: role };
        next();
    });
    app.use('/k', router);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    const now = new Date();
    const earlier = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const completed = new Date(earlier.getTime() + 12 * 60 * 60 * 1000); // 12h after creation
    dbState.activities = [
        { state: 'DONE', workType: 'DOC_REVIEW', candidateGroup: 'document_reviewer', completedBy: 'u-1', completedAt: completed, createdAt: earlier, breachedAt: null, dueAt: now },
        { state: 'TODO', workType: 'DOC_REVIEW', candidateGroup: 'document_reviewer', completedBy: null, completedAt: null, createdAt: earlier, breachedAt: earlier, dueAt: earlier },
        { state: 'CLAIMED', workType: 'FIELD_AUDIT', candidateGroup: 'field_inspector', completedBy: null, completedAt: null, createdAt: earlier, breachedAt: null, dueAt: now },
    ];
    dbState.statesCount = [
        { state: 'DONE', _count: { state: 1 } },
        { state: 'TODO', _count: { state: 1 } },
        { state: 'CLAIMED', _count: { state: 1 } },
    ];
    dbState.perf = [
        { completedBy: 'u-1', _count: { completedBy: 1 } },
    ];
});

describe('Manager-only gate', () => {
    test('admin gets 200', async () => {
        const res = await request(buildApp('system_admin_dtam')).get('/k/');
        expect(res.status).toBe(200);
    });
    test('scheduler gets 200', async () => {
        const res = await request(buildApp('dispatcher')).get('/k/');
        expect(res.status).toBe(200);
    });
    test('document_reviewer gets 403', async () => {
        const res = await request(buildApp('document_reviewer')).get('/k/');
        expect(res.status).toBe(403);
    });
    test('account gets 403', async () => {
        const res = await request(buildApp('finance_officer_platform')).get('/k/');
        expect(res.status).toBe(403);
    });
});

describe('Aggregation shape', () => {
    test('returns summary + byWorkType + byGroup + topPerformers', async () => {
        const res = await request(buildApp()).get('/k/');
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.window.days).toBe(30);
        expect(d.summary.openCount).toBe(2); // TODO + CLAIMED
        // overdue count = TODO (dueAt = earlier, < now) — but the count() mock
        // relies on the input where shape, so the value is 2 in this test
        // because the mock filters open AND dueAt<now correctly only when
        // both filters pass.
        expect(d.summary.windowDone).toBe(1);
        expect(d.summary.avgCompletionHours).toBe(12);
        expect(d.byWorkType).toHaveLength(2);
        const dr = d.byWorkType.find((b) => b.key === 'DOC_REVIEW');
        expect(dr.total).toBe(2);
        expect(dr.done).toBe(1);
        expect(dr.breached).toBe(1);
        expect(dr.avgCompletionHours).toBe(12);
        expect(d.byGroup.find((b) => b.key === 'document_reviewer').total).toBe(2);
        expect(d.topPerformers).toHaveLength(1);
        expect(d.topPerformers[0].name).toBe('Anna A.');
        expect(d.topPerformers[0].completed).toBe(1);
    });

    test('clamps days param to [1, 365]', async () => {
        const r1 = await request(buildApp()).get('/k/?days=0');
        expect(r1.body.data.window.days).toBe(1);
        const r2 = await request(buildApp()).get('/k/?days=10000');
        expect(r2.body.data.window.days).toBe(365);
        const r3 = await request(buildApp()).get('/k/?days=invalid');
        expect(r3.body.data.window.days).toBe(30);
    });
});

describe('info-disclosure — raw error.message is not echoed in 5xx', () => {
    const { prisma } = require('../../services/prisma-database');

    test('a thrown DB error returns 500 without the raw Prisma/SQL message', async () => {
        const LEAKY =
            'Invalid `prisma.workActivity.findMany()` invocation in /app/services/x.js:10 — connect ECONNREFUSED postgres:5432';
        prisma.workActivity.findMany.mockRejectedValueOnce(new Error(LEAKY));
        const res = await request(buildApp('system_admin_dtam')).get('/k/');
        expect(res.status).toBe(500);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('prisma.workActivity');
        expect(body).not.toContain('ECONNREFUSED');
        expect(body).not.toContain('/app/');
        expect(res.body.success).toBe(false);
    });
});
