'use strict';

/**
 * ADR-014 Phase 3b-D1/D2 — work-inbox org-scoping.
 *
 * candidateGroup is a GLOBAL role code, so the work-queue list queries
 * (listMyTodo / listForGroup) must constrain to the caller's organizationId
 * UNCONDITIONALLY (not via the TENANT_READ_ORG_SCOPE read-scope flag, which is
 * OFF on prod). Otherwise, once a 2nd tenant exists, an org-A actor could see
 * org-B's TODO pool. Asserted by inspecting the Prisma `where` the service builds.
 *
 * Two invariants:
 *  1. org supplied  → where.organizationId is set (scoped).
 *  2. org absent    → where.organizationId is NOT set — so the SLA cron and any
 *     context-less caller keep their cross-tenant behaviour. listOverdue (the
 *     cron) must NEVER be scoped.
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../shared/user-groups', () => ({
    getUserGroups: jest.fn(async () => ['document_reviewer']),
}));

const workActivityService = require('../../services/work-activity-service');

function makePrisma() {
    return { workActivity: { findMany: jest.fn(async () => []) } };
}
function lastWhere(prisma) {
    return prisma.workActivity.findMany.mock.calls[0][0].where;
}

describe('[Phase 3b-D1/D2] work-inbox org-scoping', () => {
    test('listMyTodo scopes by organizationId when supplied', async () => {
        const prisma = makePrisma();
        await workActivityService.listMyTodo({ prisma, userId: 'u-1', userRole: 'document_reviewer', organizationId: 'org-1' });
        expect(lastWhere(prisma).organizationId).toBe('org-1');
    });

    test('listMyTodo does NOT scope when org is absent (context-less safe)', async () => {
        const prisma = makePrisma();
        await workActivityService.listMyTodo({ prisma, userId: 'u-1', userRole: 'document_reviewer' });
        expect(lastWhere(prisma).organizationId).toBeUndefined();
    });

    test('listForGroup scopes by organizationId when supplied', async () => {
        const prisma = makePrisma();
        await workActivityService.listForGroup({ prisma, role: 'document_reviewer', organizationId: 'org-1' });
        expect(lastWhere(prisma).organizationId).toBe('org-1');
    });

    test('listForGroup does NOT scope when org is absent', async () => {
        const prisma = makePrisma();
        await workActivityService.listForGroup({ prisma, role: 'document_reviewer' });
        expect(lastWhere(prisma).organizationId).toBeUndefined();
    });

    test('listOverdue (SLA cron) is NEVER org-scoped — must see all tenants', async () => {
        const prisma = makePrisma();
        await workActivityService.listOverdue({ prisma });
        expect(lastWhere(prisma).organizationId).toBeUndefined();
    });
});
