/**
 * Bug 6.5 — the primary FE resubmit path (POST /applications/submit) bypassed
 * the 5-working-day revision deadline that the alternate submitRevision enforces.
 * This suite pins the SHARED assertRevisionNotExpired helper both entry points
 * now consume.
 *
 * Contract:
 *   - Resolves the due date from formData.revisionDueAt / revision_due_at, else
 *     the RevisionDeadline row.
 *   - When overdue: transitions the application to EXPIRED (via
 *     writeApplicationStatus), fails the RevisionDeadline row, and reports
 *     { expired: true }.
 *   - When within-deadline (or no deadline set): reports { expired: false } and
 *     performs NO side-effects.
 */

'use strict';

const { writeApplicationStatus } = require('../../services/application-status-writer');

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async () => ({})),
}));

const {
    assertRevisionNotExpired,
} = require('../../services/application-service/revision-deadline-guard');

function buildPrisma() {
    return {
        revisionDeadline: {
            findUnique: jest.fn(async () => null),
            updateMany: jest.fn(async () => ({ count: 1 })),
        },
    };
}

beforeEach(() => {
    writeApplicationStatus.mockClear();
});

describe('Bug 6.5 — assertRevisionNotExpired', () => {
    test('overdue (formData.revisionDueAt in the past) → expired:true + EXPIRE transition + deadline failed', async () => {
        const prisma = buildPrisma();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const app = {
            id: 'app-1',
            status: 'REVISION_REQUESTED',
            formData: { revisionDueAt: yesterday },
            workflowHistory: [],
        };

        const result = await assertRevisionNotExpired(app, {
            prisma,
            actorUserId: 'user-1',
            actorRole: 'health',
        });

        expect(result.expired).toBe(true);
        // Application driven to EXPIRED
        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
        expect(writeApplicationStatus.mock.calls[0][0].toStatus).toBe('EXPIRED');
        // Deadline row failed
        expect(prisma.revisionDeadline.updateMany).toHaveBeenCalledTimes(1);
        const upd = prisma.revisionDeadline.updateMany.mock.calls[0][0];
        expect(upd.data.status).toBe('FAILED');
    });

    test('overdue (RevisionDeadline row in the past, no formData date) → expired:true', async () => {
        const prisma = buildPrisma();
        prisma.revisionDeadline.findUnique.mockResolvedValue({
            revisionDue: new Date(Date.now() - 60 * 60 * 1000),
            status: 'PENDING',
        });
        const app = { id: 'app-2', status: 'CAR_PENDING', formData: {}, workflowHistory: [] };

        const result = await assertRevisionNotExpired(app, {
            prisma, actorUserId: 'user-2', actorRole: 'health',
        });

        expect(result.expired).toBe(true);
        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
    });

    test('within deadline (future dueAt) → expired:false + NO side-effects', async () => {
        const prisma = buildPrisma();
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const app = {
            id: 'app-3',
            status: 'REVISION_REQUESTED',
            formData: { revisionDueAt: tomorrow },
            workflowHistory: [],
        };

        const result = await assertRevisionNotExpired(app, {
            prisma, actorUserId: 'user-3', actorRole: 'health',
        });

        expect(result.expired).toBe(false);
        expect(writeApplicationStatus).not.toHaveBeenCalled();
        expect(prisma.revisionDeadline.updateMany).not.toHaveBeenCalled();
    });

    test('no deadline anywhere → expired:false (nothing to enforce)', async () => {
        const prisma = buildPrisma();
        const app = { id: 'app-4', status: 'REVISION_REQUESTED', formData: {}, workflowHistory: [] };

        const result = await assertRevisionNotExpired(app, {
            prisma, actorUserId: 'user-4', actorRole: 'health',
        });

        expect(result.expired).toBe(false);
        expect(writeApplicationStatus).not.toHaveBeenCalled();
    });
});
