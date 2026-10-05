'use strict';

/**
 * Unit tests for assignment-ledger-service (work-distribution ledger Phase 1B).
 * The service must be BEST-EFFORT: never throw to the caller (an assignment is
 * payment/workflow-critical), validate inputs, and write a clean row otherwise.
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { recordAssignment } = require('../../services/assignment-ledger-service');

function makePrisma(impl) {
    return { assignmentLedgerEntry: { create: jest.fn(impl || (async ({ data }) => ({ id: 'led-1', ...data }))) } };
}
const base = {
    entityType: 'APPLICATION', entityId: 'app-1', action: 'ASSIGN',
    assigneeUserId: 'u-rev', assignedByUserId: 'u-sched', role: 'document_reviewer',
    source: 'SCHEDULER', organizationId: 'org-1',
};

describe('[Phase 1B] assignment-ledger-service.recordAssignment', () => {
    test('writes a ledger row with the full who→whom payload', async () => {
        const prisma = makePrisma();
        const row = await recordAssignment({ prisma, ...base });
        expect(prisma.assignmentLedgerEntry.create).toHaveBeenCalledTimes(1);
        const data = prisma.assignmentLedgerEntry.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
            entityType: 'APPLICATION', entityId: 'app-1', action: 'ASSIGN',
            assigneeUserId: 'u-rev', assignedByUserId: 'u-sched', role: 'document_reviewer',
            source: 'SCHEDULER', organizationId: 'org-1',
        });
        expect(row.id).toBe('led-1');
    });

    test('self-claim: assignedByUserId null, action CLAIM', async () => {
        const prisma = makePrisma();
        await recordAssignment({ prisma, entityType: 'WORK_ACTIVITY', entityId: 'wa-1', action: 'CLAIM', assigneeUserId: 'u-1', organizationId: 'org-1', source: 'SELF_CLAIM' });
        const data = prisma.assignmentLedgerEntry.create.mock.calls[0][0].data;
        expect(data.action).toBe('CLAIM');
        expect(data.assignedByUserId).toBeNull();
        expect(data.source).toBe('SELF_CLAIM');
    });

    test('NEVER throws + does not write when a required field is missing', async () => {
        const prisma = makePrisma();
        await expect(recordAssignment({ prisma, ...base, assigneeUserId: undefined })).resolves.toBeNull();
        await expect(recordAssignment({ prisma, ...base, organizationId: undefined })).resolves.toBeNull();
        expect(prisma.assignmentLedgerEntry.create).not.toHaveBeenCalled();
    });

    test('NEVER throws + skips on invalid entityType/action', async () => {
        const prisma = makePrisma();
        await expect(recordAssignment({ prisma, ...base, action: 'BOGUS' })).resolves.toBeNull();
        await expect(recordAssignment({ prisma, ...base, entityType: 'BOGUS' })).resolves.toBeNull();
        expect(prisma.assignmentLedgerEntry.create).not.toHaveBeenCalled();
    });

    test('NEVER throws when the DB create rejects (swallows + returns null)', async () => {
        const prisma = makePrisma(async () => { throw new Error('db down'); });
        await expect(recordAssignment({ prisma, ...base })).resolves.toBeNull();
    });
});
