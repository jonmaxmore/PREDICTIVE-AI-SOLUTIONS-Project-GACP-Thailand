/**
 * Unit tests for services/assignment-ledger-query-service.js
 *
 * Proves the must-fix correctness guards at the service layer (runs on dev —
 * prisma-database is mocked before require, per the process.exit gotcha):
 *   • EVERY read (findMany / count / groupBy / name-resolution) includes
 *     organizationId in the WHERE (tenant leak guard — groupBy is NOT
 *     auto-scoped by the extension).
 *   • fairness/workload count only ASSIGN+REASSIGN (throughput, not all 6 actions).
 *   • take is clamped to MAX_TAKE.
 *   • missing organizationId throws (defensive).
 */

'use strict';

// Capture the args each prisma method is called with.
const calls = { count: [], findMany: [], groupBy: [], userFindMany: [] };
const ledgerReturns = { count: 0, findMany: [], groupBy: [] };

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        assignmentLedgerEntry: {
            count: jest.fn(async (args) => { calls.count.push(args); return ledgerReturns.count; }),
            findMany: jest.fn(async (args) => { calls.findMany.push(args); return ledgerReturns.findMany; }),
            groupBy: jest.fn(async (args) => { calls.groupBy.push(args); return ledgerReturns.groupBy; }),
        },
        user: {
            findMany: jest.fn(async (args) => { calls.userFindMany.push(args); return []; }),
        },
    },
}));

const svc = require('../../services/assignment-ledger-query-service');

const ORG = 'org-1';
const FROM = new Date('2026-05-01T00:00:00Z');
const TO = new Date('2026-06-01T00:00:00Z');

beforeEach(() => {
    calls.count = []; calls.findMany = []; calls.groupBy = []; calls.userFindMany = [];
    ledgerReturns.count = 0; ledgerReturns.findMany = []; ledgerReturns.groupBy = [];
});

describe('tenant scope — organizationId is in every WHERE', () => {
    test('getWorkloadByUser: count + findMany both scoped to org + count filters ASSIGN/REASSIGN', async () => {
        await svc.getWorkloadByUser({ organizationId: ORG, userId: 'u-1', from: FROM, to: TO });
        expect(calls.count[0].where).toMatchObject({
            organizationId: ORG, assigneeUserId: 'u-1', action: { in: ['ASSIGN', 'REASSIGN'] },
        });
        expect(calls.findMany[0].where).toMatchObject({ organizationId: ORG, assigneeUserId: 'u-1' });
        // recentEvents is NOT action-filtered (it's the activity feed)
        expect(calls.findMany[0].where.action).toBeUndefined();
    });

    test('getFairnessReport: groupBy where has org + ASSIGN/REASSIGN; name-resolution user.findMany is org-scoped', async () => {
        ledgerReturns.groupBy = [{ assigneeUserId: 'u-1', _count: { assigneeUserId: 5 } }];
        await svc.getFairnessReport({ organizationId: ORG, from: FROM, to: TO });
        expect(calls.groupBy[0].by).toEqual(['assigneeUserId']);
        expect(calls.groupBy[0].where).toMatchObject({
            organizationId: ORG, action: { in: ['ASSIGN', 'REASSIGN'] },
        });
        // CRITICAL: the name lookup must also be org-scoped (no unscoped user read)
        expect(calls.userFindMany[0].where).toMatchObject({ organizationId: ORG, id: { in: ['u-1'] } });
    });

    test('getEntityTimeline: scoped to org + entity; name-resolution org-scoped', async () => {
        ledgerReturns.findMany = [{ assigneeUserId: 'u-1', assignedByUserId: 's-1', previousAssigneeUserId: null }];
        await svc.getEntityTimeline({ organizationId: ORG, entityType: 'APPLICATION', entityId: 'app-1' });
        expect(calls.findMany[0].where).toMatchObject({ organizationId: ORG, entityType: 'APPLICATION', entityId: 'app-1' });
        expect(calls.userFindMany[0].where.organizationId).toBe(ORG);
    });

    test('getReassignments: org + action REASSIGN', async () => {
        await svc.getReassignments({ organizationId: ORG, from: FROM, to: TO });
        expect(calls.findMany[0].where).toMatchObject({ organizationId: ORG, action: 'REASSIGN' });
    });

    test('getAssignmentsByAssigner: org + assignedBy + ASSIGN/REASSIGN', async () => {
        await svc.getAssignmentsByAssigner({ organizationId: ORG, assignedByUserId: 's-1', from: FROM, to: TO });
        expect(calls.findMany[0].where).toMatchObject({
            organizationId: ORG, assignedByUserId: 's-1', action: { in: ['ASSIGN', 'REASSIGN'] },
        });
    });
});

describe('fail-closed: missing organizationId throws (defensive)', () => {
    test.each([
        ['getWorkloadByUser', () => svc.getWorkloadByUser({ userId: 'u-1', from: FROM, to: TO })],
        ['getEntityTimeline', () => svc.getEntityTimeline({ entityType: 'APPLICATION', entityId: 'a' })],
        ['getFairnessReport', () => svc.getFairnessReport({ from: FROM, to: TO })],
        ['getReassignments', () => svc.getReassignments({ from: FROM, to: TO })],
        ['getAssignmentsByAssigner', () => svc.getAssignmentsByAssigner({ assignedByUserId: 's-1', from: FROM, to: TO })],
    ])('%s throws without organizationId', async (_name, fn) => {
        await expect(fn()).rejects.toThrow(/organizationId is required/);
    });
});

describe('take clamp + input validation', () => {
    test('take > MAX_TAKE is clamped to MAX_TAKE', async () => {
        await svc.getWorkloadByUser({ organizationId: ORG, userId: 'u-1', from: FROM, to: TO, take: 99999 });
        expect(calls.findMany[0].take).toBe(svc.MAX_TAKE);
    });

    test('getEntityTimeline rejects an invalid entityType', async () => {
        await expect(
            svc.getEntityTimeline({ organizationId: ORG, entityType: 'BOGUS', entityId: 'x' }),
        ).rejects.toThrow(/invalid entityType/);
    });

    test('getFairnessReport maps _count → assignmentsGivenInWindow and totals', async () => {
        ledgerReturns.groupBy = [
            { assigneeUserId: 'u-1', _count: { assigneeUserId: 5 } },
            { assigneeUserId: 'u-2', _count: { assigneeUserId: 2 } },
        ];
        const res = await svc.getFairnessReport({ organizationId: ORG, from: FROM, to: TO });
        expect(res.metric).toBe('assignments_given');
        expect(res.people).toBe(2);
        expect(res.totalAssignments).toBe(7);
        expect(res.rows[0]).toMatchObject({ assigneeUserId: 'u-1', assignmentsGivenInWindow: 5 });
    });

    test('optional role filter is added to the groupBy where', async () => {
        await svc.getFairnessReport({ organizationId: ORG, from: FROM, to: TO, role: 'auditor' });
        expect(calls.groupBy[0].where).toMatchObject({ role: 'auditor' });
    });
});
