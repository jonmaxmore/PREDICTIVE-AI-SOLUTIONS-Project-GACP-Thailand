/**
 * Unit tests for scripts/backfill-assignment-ledger.js
 *
 * Exercises backfill() with an injected fake prisma — no DB. Verifies the
 * source→ledger mapping for all three phases, dry-run (no writes), query-based
 * dedup, and the FK-orphan / incomplete-row guards.
 */

const { backfill } = require('../../scripts/backfill-assignment-ledger');

const ORG = 'org-1';

// Build a configurable fake prisma. `knownUsers` is the set of valid User ids
// (FK guard); `existingLedger` rows are returned by findFirst (dedup).
function makeFakePrisma({ auditLogs = [], applications = [], workActivities = [], knownUsers, knownOrgs, existingLedger = [] } = {}) {
    const created = [];
    const users = knownUsers instanceof Set
        ? knownUsers
        : new Set(knownUsers || []);
    const orgs = knownOrgs instanceof Set ? knownOrgs : (knownOrgs ? new Set(knownOrgs) : null);
    return {
        created,
        auditLog: { findMany: async () => auditLogs },
        application: { findMany: async () => applications },
        workActivity: { findMany: async () => workActivities },
        user: {
            findUnique: async ({ where }) => (users.size === 0 || users.has(where.id) ? { id: where.id } : null),
        },
        // null knownOrgs (default) = every org exists; pass a list to restrict.
        organization: {
            findUnique: async ({ where }) => (orgs === null || orgs.has(where.id) ? { id: where.id } : null),
        },
        assignmentLedgerEntry: {
            findFirst: async ({ where }) => existingLedger.find(
                (r) => r.entityType === where.entityType
                    && r.entityId === where.entityId
                    && r.action === where.action
                    && r.assigneeUserId === where.assigneeUserId,
            ) || null,
            create: async ({ data }) => { created.push(data); return data; },
        },
    };
}

describe('backfill-assignment-ledger — Phase 1 (AuditLog ASSIGN)', () => {
    test('REVIEWER_ASSIGNED → ASSIGN document_reviewer (assignee=metadata.reviewerId, assignedBy=actorId)', async () => {
        const prisma = makeFakePrisma({
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(1);
        expect(prisma.created[0]).toMatchObject({
            entityType: 'APPLICATION', entityId: 'app-1', action: 'ASSIGN',
            assigneeUserId: 'rev-1', assignedByUserId: 'sched-1', role: 'document_reviewer', source: 'SCHEDULER',
            organizationId: ORG,
        });
    });

    test('AUDIT_SCHEDULED → ASSIGN auditor (assignee=metadata.auditorId)', async () => {
        const prisma = makeFakePrisma({
            auditLogs: [{
                id: 'a2', action: 'AUDIT_SCHEDULED', actorId: 'sched-1', resourceId: 'app-2',
                metadata: { auditorId: 'aud-1' }, createdAt: new Date('2026-06-02T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(1);
        expect(prisma.created[0]).toMatchObject({
            entityId: 'app-2', action: 'ASSIGN', assigneeUserId: 'aud-1', role: 'auditor', source: 'SCHEDULER',
        });
    });
});

describe('backfill-assignment-ledger — Phase 2 (_reassignmentHistory REASSIGN)', () => {
    test('each history entry → REASSIGN auditor with previousAssigneeUserId', async () => {
        const prisma = makeFakePrisma({
            applications: [{
                id: 'app-3', organizationId: ORG,
                formData: {
                    _reassignmentHistory: [
                        { from: 'aud-1', to: 'aud-2', reason: 'sick', reassignedBy: 'sched-1', reassignedAt: '2026-06-03T03:00:00Z' },
                    ],
                },
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(1);
        expect(prisma.created[0]).toMatchObject({
            entityId: 'app-3', action: 'REASSIGN', assigneeUserId: 'aud-2',
            previousAssigneeUserId: 'aud-1', assignedByUserId: 'sched-1', role: 'auditor', source: 'SCHEDULER', reason: 'sick',
        });
    });
});

describe('backfill-assignment-ledger — Phase 3 (WorkActivity)', () => {
    test('claimed (non-TODO) → CLAIM; done → COMPLETE (assignee=completedBy)', async () => {
        const prisma = makeFakePrisma({
            workActivities: [{
                id: 'wa-1', assignedUserId: 'rev-1', claimedAt: new Date('2026-06-04T03:00:00Z'),
                state: 'DONE', completedBy: 'rev-1', completedAt: new Date('2026-06-04T05:00:00Z'),
                candidateGroup: 'document_reviewer', organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(2);
        const actions = prisma.created.map((r) => r.action).sort();
        expect(actions).toEqual(['CLAIM', 'COMPLETE']);
        const claim = prisma.created.find((r) => r.action === 'CLAIM');
        expect(claim).toMatchObject({ entityType: 'WORK_ACTIVITY', entityId: 'wa-1', source: 'SYSTEM_BACKFILL', role: 'document_reviewer' });
    });

    test('a TODO row with no claimedAt produces no rows', async () => {
        const prisma = makeFakePrisma({
            workActivities: [{
                id: 'wa-2', assignedUserId: 'rev-1', claimedAt: null, state: 'TODO',
                completedBy: null, completedAt: null, candidateGroup: 'document_reviewer', organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(0);
    });
});

describe('backfill-assignment-ledger — safety guards', () => {
    test('--dry-run writes nothing but still tallies created', async () => {
        const prisma = makeFakePrisma({
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma, dryRun: true });
        expect(res.totals.created).toBe(1);
        expect(prisma.created).toHaveLength(0);
    });

    test('dedup: an existing ledger row within the window is skipped', async () => {
        const prisma = makeFakePrisma({
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
            existingLedger: [{ entityType: 'APPLICATION', entityId: 'app-1', action: 'ASSIGN', assigneeUserId: 'rev-1' }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(0);
        expect(res.totals.duplicatesAvoided).toBe(1);
        expect(prisma.created).toHaveLength(0);
    });

    test('orphan assignee (no matching User) is skipped, not thrown', async () => {
        const prisma = makeFakePrisma({
            knownUsers: ['sched-1'], // rev-1 does NOT exist
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(0);
        expect(res.totals.skippedOrphanAssignee).toBe(1);
    });

    test('orphan org (stale/archived organizationId) is skipped, not thrown into errors', async () => {
        const prisma = makeFakePrisma({
            knownUsers: ['sched-1', 'rev-1'],
            knownOrgs: ['some-other-org'], // ORG does NOT exist (e.g. archived)
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(0);
        expect(res.totals.skippedOrphanOrg).toBe(1);
        expect(res.totals.errors).toBe(0); // FK violation avoided — not counted as an error
        expect(prisma.created).toHaveLength(0);
    });

    test('unknown assignedBy is demoted to null, row still created', async () => {
        const prisma = makeFakePrisma({
            knownUsers: ['rev-1'], // sched-1 (the assigner) does NOT exist
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(1);
        expect(prisma.created[0].assignedByUserId).toBeNull();
    });

    test('incomplete row (missing organizationId) is skipped', async () => {
        const prisma = makeFakePrisma({
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: { reviewerId: 'rev-1' }, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: null,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(0);
        expect(res.totals.skippedIncomplete).toBe(1);
    });

    test('missing assignee id (no metadata) is skipped as incomplete', async () => {
        const prisma = makeFakePrisma({
            auditLogs: [{
                id: 'a1', action: 'REVIEWER_ASSIGNED', actorId: 'sched-1', resourceId: 'app-1',
                metadata: {}, createdAt: new Date('2026-06-01T03:00:00Z'), organizationId: ORG,
            }],
        });
        const res = await backfill({ prisma });
        expect(res.totals.created).toBe(0);
        expect(res.totals.skippedIncomplete).toBe(1);
    });
});
