/**
 * /api/provider/ledger/* route tests — Phase 1C.
 *
 * Supertest + mocked deps (mock-backed, runs on dev — no DB). Verifies the
 * must-fix route guards:
 *   • Manager-only gate: admin + scheduler pass; document_reviewer + auditor 403.
 *   • FAIL-CLOSED org guard: missing req.user.organizationId → 403 ORG_SCOPE_REQUIRED
 *     (the degraded-DB path), never 500, never an unscoped query.
 *   • org id is passed through to the query service from req.user.organizationId.
 *   • entityType validation on /timeline.
 *   • response is {success:true, data:{...}} (all nested — apiClient envelope).
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

// The route → handlers/shared → prisma-database, which process.exit(1)s without
// DATABASE_URL on dev machines (the project rules gotcha). Mock it so the route loads;
// the query service (the only thing that touches prisma) is mocked below anyway.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

// Mock the query service — these route tests exercise the guards/wiring, not
// the DB. The service has its own unit test for the where/groupBy shapes.
jest.mock('../../services/assignment-ledger-query-service', () => ({
    getWorkloadByUser: jest.fn(async ({ organizationId, userId }) => ({ metric: 'assignments_given', userId, organizationId, assignmentsGivenInWindow: 3, recentEvents: [] })),
    getEntityTimeline: jest.fn(async ({ organizationId, entityType, entityId }) => ({ entityType, entityId, organizationId, events: [] })),
    getFairnessReport: jest.fn(async ({ organizationId }) => ({ metric: 'assignments_given', organizationId, people: 0, totalAssignments: 0, rows: [] })),
    getReassignments: jest.fn(async () => ({ events: [] })),
    getAssignmentsByAssigner: jest.fn(async ({ assignedByUserId }) => ({ assignedByUserId, count: 0, events: [] })),
    VALID_ENTITY_TYPES: new Set(['APPLICATION', 'WORK_ACTIVITY', 'POST_AUDIT_TASK']),
    MAX_TAKE: 1000,
}));

const ledgerQuery = require('../../services/assignment-ledger-query-service');
const router = require('../../routes/api/provider/ledger');

// user = { role, organizationId } injected before the router (mocked
// authenticateProvider is a pass-through and does not populate req.user).
function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/ledger', router);
    return app;
}

const ADMIN = { role: 'system_admin_dtam', organizationId: 'org-1' };
const SCHEDULER = { role: 'dispatcher', organizationId: 'org-1' };

beforeEach(() => jest.clearAllMocks());

describe('RBAC — manager-only gate', () => {
    test('document_reviewer → 403', async () => {
        const res = await request(buildApp({ role: 'document_reviewer', organizationId: 'org-1' })).get('/ledger/fairness');
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Manager access required/);
    });

    test('auditor → 403', async () => {
        const res = await request(buildApp({ role: 'field_inspector', organizationId: 'org-1' })).get('/ledger/fairness');
        expect(res.status).toBe(403);
    });

    test('admin → 200', async () => {
        const res = await request(buildApp(ADMIN)).get('/ledger/fairness');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('scheduler → 200', async () => {
        const res = await request(buildApp(SCHEDULER)).get('/ledger/fairness');
        expect(res.status).toBe(200);
    });
});

describe('FAIL-CLOSED org guard', () => {
    test('admin with NO organizationId → 403 ORG_SCOPE_REQUIRED (not 500, no query run)', async () => {
        const res = await request(buildApp({ role: 'system_admin_dtam' })).get('/ledger/fairness');
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ORG_SCOPE_REQUIRED');
        expect(ledgerQuery.getFairnessReport).not.toHaveBeenCalled();
    });

    test('the caller org is passed through to the service', async () => {
        await request(buildApp(SCHEDULER)).get('/ledger/fairness');
        expect(ledgerQuery.getFairnessReport).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-1' }),
        );
    });
});

describe('routes + validation', () => {
    test('GET /workload/:userId → 200, scoped to org + user', async () => {
        const res = await request(buildApp(ADMIN)).get('/ledger/workload/u-1');
        expect(res.status).toBe(200);
        expect(res.body.data.userId).toBe('u-1');
        expect(ledgerQuery.getWorkloadByUser).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-1', userId: 'u-1' }),
        );
    });

    test('GET /timeline/:entityType/:entityId → 200 for a valid entityType', async () => {
        const res = await request(buildApp(ADMIN)).get('/ledger/timeline/APPLICATION/app-1');
        expect(res.status).toBe(200);
        expect(ledgerQuery.getEntityTimeline).toHaveBeenCalledWith(
            expect.objectContaining({ entityType: 'APPLICATION', entityId: 'app-1', organizationId: 'org-1' }),
        );
    });

    test('GET /timeline with an invalid entityType → 400 (no query run)', async () => {
        const res = await request(buildApp(ADMIN)).get('/ledger/timeline/BOGUS/x');
        expect(res.status).toBe(400);
        expect(ledgerQuery.getEntityTimeline).not.toHaveBeenCalled();
    });

    test('GET /reassignments → 200, nested under data', async () => {
        const res = await request(buildApp(SCHEDULER)).get('/ledger/reassignments');
        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
        expect(Array.isArray(res.body.data.events)).toBe(true);
    });

    test('GET /by-assigner/:id → 200, scoped', async () => {
        const res = await request(buildApp(ADMIN)).get('/ledger/by-assigner/s-1');
        expect(res.status).toBe(200);
        expect(ledgerQuery.getAssignmentsByAssigner).toHaveBeenCalledWith(
            expect.objectContaining({ assignedByUserId: 's-1', organizationId: 'org-1' }),
        );
    });

    test('?days is clamped to [1,365] → service gets a ~365-day window for days=9999', async () => {
        await request(buildApp(ADMIN)).get('/ledger/fairness?days=9999');
        const arg = ledgerQuery.getFairnessReport.mock.calls[0][0];
        const spanDays = Math.round((arg.to - arg.from) / (24 * 60 * 60 * 1000));
        expect(spanDays).toBe(365);
    });
});
