/**
 * work-activity-service unit tests — ADR-016 Phase 1A.
 *
 * Verifies the BPMN-aligned work-item service contract:
 *  - createForStage: idempotent on (app, workType, triggeredAtStage)
 *  - createForStage: applies SLA policy → dueAt + warningAt
 *  - claim / unclaim / markDone: state transitions + role guards
 *  - cancel / cancelOpenForStage: terminal-state behaviour
 *  - listMyTodo: shows assigned + claimable
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Stub the notifications module so claim() doesn't try to load
// notification-service / prisma-database under unit-test conditions.
jest.mock('../../services/work-activity-notifications', () => ({
    notifyAssigned: jest.fn(async () => 0),
    notifyWarning: jest.fn(async () => 0),
    notifyBreach: jest.fn(async () => 0),
    workTypeLabel: (s) => s,
}));

// Phase 1C: stub user-groups so unit tests don't need a real DB lookup
// for membership resolution. The mock infers groups from a special
// `_userRoleHints` map populated per-test (defaults to []).
//
// Stored on globalThis because jest.mock() factories are not allowed to
// reference outer-scope variables (only `mock`-prefixed names get an
// exception, and the implicit `_` prefix doesn't count).
globalThis.__waUserRoleHints = globalThis.__waUserRoleHints || new Map();
const _userRoleHints = globalThis.__waUserRoleHints; // alias for the rest of the file
jest.mock('../../shared/user-groups', () => {
    const mockUserGroups = {
        getUserGroups: jest.fn(async (_prisma, userId) => globalThis.__waUserRoleHints.get(userId) || []),
        userInGroup: jest.fn(async (_prisma, userId, groupCode) => {
            const groups = globalThis.__waUserRoleHints.get(userId) || [];
            return groups.includes('system_admin_dtam') || groups.includes(groupCode);
        }),
        listGroupMemberUserIds: jest.fn(async () => []),
        clearCache: jest.fn(),
    };
    return mockUserGroups;
});

const wa = require('../../services/work-activity-service');

function makePrisma(seed = {}) {
    const state = {
        configs: seed.configs || [],
        policies: seed.policies || [],
        activities: seed.activities || [],
        nextId: 1,
    };
    const id = () => `wa-${state.nextId++}`;

    return {
        _state: state,
        stageActivityConfig: {
            findMany: jest.fn(async ({ where, orderBy: _ }) => {
                return state.configs.filter(
                    (c) => c.workflowStage === where.workflowStage && (where.isActive ? c.isActive : true),
                );
            }),
        },
        slaPolicy: {
            findUnique: jest.fn(async ({ where }) => {
                return state.policies.find((p) => p.workType === where.workType) || null;
            }),
            findMany: jest.fn(async ({ where = {} } = {}) => {
                return state.policies.filter(
                    (p) => !where.workType?.in || where.workType.in.includes(p.workType),
                );
            }),
        },
        workActivity: {
            findFirst: jest.fn(async ({ where }) => {
                return state.activities.find((a) => {
                    if (a.applicationId !== where.applicationId) {return false;}
                    if (a.workType !== where.workType) {return false;}
                    if (a.triggeredAtStage !== where.triggeredAtStage) {return false;}
                    return where.state.in.includes(a.state);
                }) || null;
            }),
            findUnique: jest.fn(async ({ where }) => {
                return state.activities.find((a) => a.id === where.id) || null;
            }),
            findMany: jest.fn(async ({ where = {} } = {}) => {
                return state.activities.filter((a) => {
                    if (where.applicationId && a.applicationId !== where.applicationId) {return false;}
                    if (where.triggeredAtStage && a.triggeredAtStage !== where.triggeredAtStage) {return false;}
                    if (where.state?.in && !where.state.in.includes(a.state)) {return false;}
                    if (where.candidateGroup && a.candidateGroup !== where.candidateGroup) {return false;}
                    if (where.workType?.in && !where.workType.in.includes(a.workType)) {return false;}
                    return true;
                });
            }),
            create: jest.fn(async ({ data }) => {
                const row = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...data };
                state.activities.push(row);
                return row;
            }),
            update: jest.fn(async ({ where, data }) => {
                const idx = state.activities.findIndex((a) => a.id === where.id);
                if (idx === -1) {throw new Error('not found');}
                state.activities[idx] = { ...state.activities[idx], ...data, updatedAt: new Date() };
                return state.activities[idx];
            }),
            updateMany: jest.fn(async ({ where, data }) => {
                let count = 0;
                state.activities = state.activities.map((a) => {
                    if (a.applicationId !== where.applicationId) {return a;}
                    if (where.triggeredAtStage && a.triggeredAtStage !== where.triggeredAtStage) {return a;}
                    if (where.state?.in && !where.state.in.includes(a.state)) {return a;}
                    count += 1;
                    return { ...a, ...data, updatedAt: new Date() };
                });
                return { count };
            }),
            count: jest.fn(async ({ where = {} } = {}) => {
                const asOf = where.OR?.[0]?.dueAt?.lte;
                return state.activities.filter((a) => {
                    if (where.candidateGroup && a.candidateGroup !== where.candidateGroup) {return false;}
                    if (where.state?.in && !where.state.in.includes(a.state)) {return false;}
                    if (where.organizationId && a.organizationId !== where.organizationId) {return false;}
                    // OR: overdue (dueAt <= asOf) OR breached (breachedAt != null)
                    if (where.OR) {
                        const overdue = asOf && a.dueAt && a.dueAt <= asOf;
                        const breached = a.breachedAt != null;
                        if (!overdue && !breached) {return false;}
                    }
                    return true;
                }).length;
            }),
        },
    };
}

describe('work-activity-service.createForStage', () => {
    test('returns [] when no configs match the stage', async () => {
        const prisma = makePrisma({ configs: [] });
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'AUDIT_PASSED',
            organizationId: 'org-1',
        });
        expect(out).toEqual([]);
    });

    test('creates one activity per matching config', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'AUDIT_CONFIRMED',
                    workType: 'FIELD_AUDIT',
                    candidateGroup: 'field_inspector',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
            policies: [
                { workType: 'FIELD_AUDIT', targetHours: 336, warningHours: 240 },
            ],
        });
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'AUDIT_CONFIRMED',
            organizationId: 'org-1',
        });
        expect(out).toHaveLength(1);
        expect(out[0].workType).toBe('FIELD_AUDIT');
        expect(out[0].candidateGroup).toBe('field_inspector');
        expect(out[0].state).toBe('TODO');
        expect(out[0].dueAt).toBeInstanceOf(Date);
        expect(out[0].warningAt).toBeInstanceOf(Date);
        expect(out[0].triggeredAtStage).toBe('AUDIT_CONFIRMED');
    });

    test('is idempotent — re-entering the same stage does not duplicate', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'ASSIGNED_FOR_REVIEW',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
        });
        await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        });
        const second = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        });
        expect(second).toEqual([]);
        expect(prisma._state.activities).toHaveLength(1);
    });

    test('creates a new row after the previous one was completed', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'ASSIGNED_FOR_REVIEW',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
        });
        await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        });
        // Reviewer completes it
        prisma._state.activities[0].state = 'DONE';
        // Application bounces RR → AFR again — fresh activity is OK
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        });
        expect(out).toHaveLength(1);
        expect(prisma._state.activities).toHaveLength(2);
    });

    test('pre-assigns the DOC_REVIEW activity to reviewerId (CLAIMED, not TODO)', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'ASSIGNED_FOR_REVIEW',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
        });
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
            reviewerId: 'rev-1',
        });
        expect(out).toHaveLength(1);
        expect(out[0].state).toBe('CLAIMED');
        expect(out[0].assignedUserId).toBe('rev-1');
        expect(out[0].claimedAt).toBeInstanceOf(Date);
    });

    test('keeps non-DOC_REVIEW activities on the pull model even when reviewerId is set', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'AUDIT_CONFIRMED',
                    workType: 'FIELD_AUDIT',
                    candidateGroup: 'field_inspector',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
        });
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'AUDIT_CONFIRMED',
            organizationId: 'org-1',
            reviewerId: 'rev-1', // must be ignored for a non-DOC_REVIEW activity
        });
        expect(out).toHaveLength(1);
        expect(out[0].state).toBe('TODO');
        expect(out[0].assignedUserId).toBeNull();
    });

    test('DOC_REVIEW stays TODO when no reviewerId is supplied (pull model preserved)', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'ASSIGNED_FOR_REVIEW',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
        });
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        });
        expect(out).toHaveLength(1);
        expect(out[0].state).toBe('TODO');
        expect(out[0].assignedUserId).toBeNull();
    });

    test('falls back to no SLA when no policy exists', async () => {
        const prisma = makePrisma({
            configs: [
                {
                    workflowStage: 'AUDIT_PASSED',
                    workType: 'FINAL_APPROVAL',
                    candidateGroup: 'field_inspector',
                    displayOrder: 0,
                    isActive: true,
                },
            ],
            policies: [], // no policy
        });
        const out = await wa.createForStage({
            prisma,
            applicationId: 'app-1',
            toStatus: 'AUDIT_PASSED',
            organizationId: 'org-1',
        });
        expect(out[0].dueAt).toBeNull();
        expect(out[0].warningAt).toBeNull();
    });
});

describe('work-activity-service.claim / unclaim / markDone', () => {
    function seed() {
        return makePrisma({
            activities: [
                {
                    id: 'a-1',
                    applicationId: 'app-1',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    state: 'TODO',
                    assignedUserId: null,
                    organizationId: 'org-1',
                    triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
                },
            ],
        });
    }

    beforeEach(() => {
        _userRoleHints.clear();
    });

    test('claim moves TODO → CLAIMED for matching role', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        const out = await wa.claim({
            prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer',
        });
        expect(out.state).toBe('CLAIMED');
        expect(out.assignedUserId).toBe('u-1');
        expect(out.claimedAt).toBeInstanceOf(Date);
    });

    test('claim rejects if role does not match candidate group', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['finance_officer_platform']);
        await expect(
            wa.claim({ prisma, activityId: 'a-1', userId: 'u-1', userRole: 'finance_officer_platform' }),
        ).rejects.toThrow(/cannot claim/);
    });

    test('admin can claim any group', async () => {
        const prisma = seed();
        _userRoleHints.set('u-admin', ['system_admin_dtam']);
        const out = await wa.claim({
            prisma, activityId: 'a-1', userId: 'u-admin', userRole: 'system_admin_dtam',
        });
        expect(out.state).toBe('CLAIMED');
    });

    test('claim rejects already-claimed activity', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        prisma._state.activities[0].state = 'CLAIMED';
        prisma._state.activities[0].assignedUserId = 'u-2';
        await expect(
            wa.claim({ prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer' }),
        ).rejects.toThrow(/already CLAIMED/);
    });

    // Phase 1C: multi-group user can claim work for any group they belong to.
    test('claim succeeds for a user in multiple groups (Phase 1C)', async () => {
        const prisma = seed();
        // User is in both auditor and document_reviewer groups
        _userRoleHints.set('u-multi', ['field_inspector', 'document_reviewer']);
        // Activity wants document_reviewer — should be claimable
        const out = await wa.claim({
            prisma, activityId: 'a-1', userId: 'u-multi', userRole: 'field_inspector',
        });
        expect(out.state).toBe('CLAIMED');
        expect(out.assignedUserId).toBe('u-multi');
    });

    // ── Tenant guard (audit 2.6): by-id claim/unclaim/markDone must not cross
    //    org. findUnique-by-id is NOT org-scoped by the tenant extension, so the
    //    service rejects a cross-tenant row as not-found (anti-enumeration) when
    //    the caller supplies an organizationId, and fail-opens when it doesn't. ──
    test('claim rejects a cross-tenant activity as not-found (org mismatch)', async () => {
        const prisma = seed(); // activity is org-1
        _userRoleHints.set('u-1', ['document_reviewer']);
        await expect(
            wa.claim({ prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer', organizationId: 'org-2' }),
        ).rejects.toThrow(/not found/i);
    });

    test('claim succeeds when organizationId matches the activity', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        const out = await wa.claim({
            prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer', organizationId: 'org-1',
        });
        expect(out.state).toBe('CLAIMED');
    });

    test('claim fail-opens when no organizationId supplied (system/legacy caller)', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        const out = await wa.claim({
            prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer',
        });
        expect(out.state).toBe('CLAIMED');
    });

    test('markDone rejects a cross-tenant activity as not-found (org mismatch)', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        await expect(
            wa.markDone({ prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer', organizationId: 'org-2' }),
        ).rejects.toThrow(/not found/i);
    });

    test('unclaim rejects a cross-tenant activity as not-found (org mismatch)', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        prisma._state.activities[0].state = 'CLAIMED';
        prisma._state.activities[0].assignedUserId = 'u-1';
        await expect(
            wa.unclaim({ prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer', organizationId: 'org-2' }),
        ).rejects.toThrow(/not found/i);
    });

    test('unclaim returns activity to TODO and clears assignee', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        prisma._state.activities[0].state = 'CLAIMED';
        prisma._state.activities[0].assignedUserId = 'u-1';
        const out = await wa.unclaim({
            prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer',
        });
        expect(out.state).toBe('TODO');
        expect(out.assignedUserId).toBeNull();
    });

    test('unclaim rejects if user is not the assignee (and not admin)', async () => {
        const prisma = seed();
        _userRoleHints.set('u-other', ['document_reviewer']);
        prisma._state.activities[0].state = 'CLAIMED';
        prisma._state.activities[0].assignedUserId = 'u-1';
        await expect(
            wa.unclaim({ prisma, activityId: 'a-1', userId: 'u-other', userRole: 'document_reviewer' }),
        ).rejects.toThrow(/Only the assignee/);
    });

    test('markDone moves to DONE and stamps completedBy', async () => {
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        prisma._state.activities[0].state = 'CLAIMED';
        prisma._state.activities[0].assignedUserId = 'u-1';
        const out = await wa.markDone({
            prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer', note: 'Looks good',
        });
        expect(out.state).toBe('DONE');
        expect(out.completedBy).toBe('u-1');
        expect(out.completedAt).toBeInstanceOf(Date);
        expect(out.note).toBe('Looks good');
    });

    test('markDone is idempotent at the application level — does not advance status', async () => {
        // The service should NOT call any prisma.application.update — it
        // only writes to the activity row. Stage advance is the caller's
        // responsibility.
        const prisma = seed();
        _userRoleHints.set('u-1', ['document_reviewer']);
        prisma._state.activities[0].state = 'CLAIMED';
        prisma._state.activities[0].assignedUserId = 'u-1';
        await wa.markDone({
            prisma, activityId: 'a-1', userId: 'u-1', userRole: 'document_reviewer',
        });
        // Sanity: there's no application namespace on the prisma stub —
        // if the service tried to touch it, the test would have thrown.
        expect(prisma).not.toHaveProperty('application');
    });
});

describe('work-activity-service.cancel / cancelOpenForStage', () => {
    test('cancel moves activity to CANCELLED with reason', async () => {
        const prisma = makePrisma({
            activities: [
                {
                    id: 'a-1',
                    applicationId: 'app-1',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    state: 'CLAIMED',
                    assignedUserId: 'u-1',
                    organizationId: 'org-1',
                    triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
                },
            ],
        });
        const out = await wa.cancel({ prisma, activityId: 'a-1', reason: 'application withdrawn' });
        expect(out.state).toBe('CANCELLED');
        expect(out.cancelReason).toBe('application withdrawn');
    });

    test('cancel is idempotent on already-terminal rows', async () => {
        const prisma = makePrisma({
            activities: [
                {
                    id: 'a-1',
                    applicationId: 'app-1',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'document_reviewer',
                    state: 'DONE',
                    organizationId: 'org-1',
                    triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
                },
            ],
        });
        const out = await wa.cancel({ prisma, activityId: 'a-1', reason: 'noop' });
        expect(out.state).toBe('DONE');
    });

    test('cancelOpenForStage cancels every open row for a stage', async () => {
        const prisma = makePrisma({
            activities: [
                { id: 'a-1', applicationId: 'app-1', workType: 'DOC_REVIEW', state: 'TODO', triggeredAtStage: 'ASSIGNED_FOR_REVIEW', candidateGroup: 'document_reviewer', organizationId: 'org-1' },
                { id: 'a-2', applicationId: 'app-1', workType: 'DOC_REVIEW', state: 'DONE', triggeredAtStage: 'ASSIGNED_FOR_REVIEW', candidateGroup: 'document_reviewer', organizationId: 'org-1' },
                { id: 'a-3', applicationId: 'app-1', workType: 'FIELD_AUDIT', state: 'CLAIMED', triggeredAtStage: 'AUDIT_CONFIRMED', candidateGroup: 'field_inspector', organizationId: 'org-1' },
            ],
        });
        const out = await wa.cancelOpenForStage({
            prisma,
            applicationId: 'app-1',
            triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
        });
        expect(out.count).toBe(1); // only a-1 (a-2 already DONE, a-3 different stage)
    });
});

describe('work-activity-service.listMyTodo', () => {
    beforeEach(() => {
        _userRoleHints.clear();
    });

    test('returns assigned items + claimable items for the role', async () => {
        const prisma = makePrisma({
            activities: [
                { id: 'a-1', applicationId: 'app-1', workType: 'DOC_REVIEW', state: 'CLAIMED', assignedUserId: 'u-1', candidateGroup: 'document_reviewer', triggeredAtStage: 'ASSIGNED_FOR_REVIEW', organizationId: 'org-1' },
                { id: 'a-2', applicationId: 'app-2', workType: 'DOC_REVIEW', state: 'TODO', assignedUserId: null, candidateGroup: 'document_reviewer', triggeredAtStage: 'ASSIGNED_FOR_REVIEW', organizationId: 'org-1' },
                { id: 'a-3', applicationId: 'app-3', workType: 'FIELD_AUDIT', state: 'TODO', assignedUserId: null, candidateGroup: 'field_inspector', triggeredAtStage: 'AUDIT_CONFIRMED', organizationId: 'org-1' },
            ],
        });
        _userRoleHints.set('u-1', ['document_reviewer']);
        // The mock findMany doesn't deeply emulate OR clauses; for this
        // test we trust the where shape passes through unchanged. The
        // assertion is that listMyTodo invokes findMany at all + with a
        // limit and includes.
        await wa.listMyTodo({ prisma, userId: 'u-1', userRole: 'document_reviewer' });
        expect(prisma.workActivity.findMany).toHaveBeenCalledTimes(1);
        const call = prisma.workActivity.findMany.mock.calls[0][0];
        expect(call.where.state.in).toContain('TODO');
        expect(call.where.state.in).toContain('CLAIMED');
        expect(call.where.OR).toBeDefined();
        expect(call.include?.application).toBeDefined();
    });

    test('returns [] for unknown role with no membership and no userRole hint', async () => {
        const prisma = makePrisma();
        // No memberships, no role hint either
        const out = await wa.listMyTodo({ prisma, userId: 'u-1', userRole: '' });
        expect(out).toEqual([]);
    });

    // Phase 1C: a multi-group user sees claimable rows for ALL their groups.
    test('multi-group user sees claimable rows from every group (Phase 1C)', async () => {
        const prisma = makePrisma({ activities: [] });
        _userRoleHints.set('u-multi', ['document_reviewer', 'field_inspector']);
        await wa.listMyTodo({ prisma, userId: 'u-multi', userRole: 'field_inspector' });
        const call = prisma.workActivity.findMany.mock.calls[0][0];
        // Second OR branch should filter candidateGroup IN ['document_reviewer', 'field_inspector']
        const orBranch = call.where.OR.find((b) => b?.candidateGroup?.in);
        expect(orBranch).toBeDefined();
        expect(orBranch.candidateGroup.in).toEqual(
            expect.arrayContaining(['document_reviewer', 'field_inspector']),
        );
    });

    // Phase 1C: admin user sees every TODO row regardless of candidateGroup.
    test('admin user sees every TODO row (Phase 1C)', async () => {
        const prisma = makePrisma({ activities: [] });
        _userRoleHints.set('u-admin', ['system_admin_dtam']);
        await wa.listMyTodo({ prisma, userId: 'u-admin', userRole: 'system_admin_dtam' });
        const call = prisma.workActivity.findMany.mock.calls[0][0];
        const orBranch = call.where.OR.find((b) => b?.state === 'TODO');
        // Admin branch should have NO candidateGroup filter
        expect(orBranch.candidateGroup).toBeUndefined();
    });
});

// Wave-3 P1-H: read-only overdue/breached count for a candidate group's queue.
describe('work-activity-service.countOverdueForGroup', () => {
    const ASOF = new Date('2026-07-02T12:00:00Z');
    const OVERDUE_DUE = new Date('2026-07-01T00:00:00Z'); // dueAt < asOf
    const FUTURE_DUE = new Date('2026-07-10T00:00:00Z');  // dueAt > asOf

    test('returns 0 for an unknown/empty role', async () => {
        const prisma = makePrisma({ activities: [] });
        expect(await wa.countOverdueForGroup({ prisma, role: '' })).toBe(0);
        // Must not even hit the DB for an empty role.
        expect(prisma.workActivity.count).not.toHaveBeenCalled();
    });

    test('counts overdue (dueAt<=asOf) AND breached (breachedAt!=null) open rows for the group', async () => {
        const prisma = makePrisma({
            activities: [
                // overdue, open, scheduler → counted
                { id: 'o1', candidateGroup: 'dispatcher', state: 'TODO', dueAt: OVERDUE_DUE, breachedAt: null, organizationId: 'org-1' },
                // breached, open, scheduler → counted
                { id: 'o2', candidateGroup: 'dispatcher', state: 'CLAIMED', dueAt: FUTURE_DUE, breachedAt: new Date(), organizationId: 'org-1' },
                // future dueAt + not breached → NOT counted
                { id: 'o3', candidateGroup: 'dispatcher', state: 'TODO', dueAt: FUTURE_DUE, breachedAt: null, organizationId: 'org-1' },
                // different candidate group → NOT counted
                { id: 'o4', candidateGroup: 'field_inspector', state: 'TODO', dueAt: OVERDUE_DUE, breachedAt: null, organizationId: 'org-1' },
            ],
        });
        const n = await wa.countOverdueForGroup({
            prisma, role: 'dispatcher', asOf: ASOF, organizationId: 'org-1',
        });
        expect(n).toBe(2);
    });

    test('scopes to the caller organization', async () => {
        const prisma = makePrisma({
            activities: [
                { id: 'p1', candidateGroup: 'dispatcher', state: 'TODO', dueAt: OVERDUE_DUE, breachedAt: null, organizationId: 'org-1' },
                { id: 'p2', candidateGroup: 'dispatcher', state: 'TODO', dueAt: OVERDUE_DUE, breachedAt: null, organizationId: 'org-2' },
            ],
        });
        const n = await wa.countOverdueForGroup({
            prisma, role: 'dispatcher', asOf: ASOF, organizationId: 'org-1',
        });
        expect(n).toBe(1);
        const call = prisma.workActivity.count.mock.calls[0][0];
        expect(call.where.organizationId).toBe('org-1');
        expect(call.where.candidateGroup).toBe('dispatcher');
        // only OPEN states are counted (breached rows stay open)
        expect(call.where.state.in).toEqual(expect.arrayContaining(['TODO', 'CLAIMED', 'IN_PROGRESS']));
    });

    test('excludes DONE/CANCELLED rows even if past due', async () => {
        const prisma = makePrisma({
            activities: [
                { id: 'd1', candidateGroup: 'dispatcher', state: 'DONE', dueAt: OVERDUE_DUE, breachedAt: null, organizationId: 'org-1' },
                { id: 'd2', candidateGroup: 'dispatcher', state: 'CANCELLED', dueAt: OVERDUE_DUE, breachedAt: new Date(), organizationId: 'org-1' },
            ],
        });
        const n = await wa.countOverdueForGroup({
            prisma, role: 'dispatcher', asOf: ASOF, organizationId: 'org-1',
        });
        expect(n).toBe(0);
    });
});
