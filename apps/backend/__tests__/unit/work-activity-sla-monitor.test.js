/**
 * work-activity SLA monitor unit tests — ADR-016 Phase 1B.
 *
 * Verifies the cron logic:
 *  - Fires WORK_ACTIVITY_WARNING when warningAt has passed AND warnedAt is null
 *  - Fires WORK_ACTIVITY_BREACH when dueAt has passed AND breachedAt is null
 *  - Stamps warnedAt / breachedAt at dispatch (dedup — won't re-fire next pass)
 *  - Suppresses warning when breach is already due (avoid silly "near due"
 *    when it's already past)
 *  - Closed states (DONE / CANCELLED) are never alerted
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Mock the dispatcher so we can spy on calls without touching email/SMS.
const mockNotify = {
    notifyWarning: jest.fn(async () => 1),
    notifyBreach: jest.fn(async () => 1),
};
jest.mock('../../services/work-activity-notifications', () => mockNotify);

// Mock tenant-context to be a transparent passthrough — the cron's call
// to runWithTenantContext just needs to invoke the inner callback.
jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    runWithTenantContext: (_ctx, fn) => fn(),
}));

// Mock prisma-database — we pass our own row set + capture updates.
const mockState = { rows: [] };
const mockPrisma = {
    workActivity: {
        findMany: jest.fn(async () => mockState.rows),
        update: jest.fn(async ({ where, data }) => {
            const row = mockState.rows.find((r) => r.id === where.id);
            Object.assign(row, data);
            return row;
        }),
    },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

const { checkOverdueActivities } = require('../../jobs/work-activity-sla-monitor');

beforeEach(() => {
    mockState.rows = [];
    mockNotify.notifyWarning.mockClear();
    mockNotify.notifyBreach.mockClear();
    mockPrisma.workActivity.update.mockClear();
});

describe('work-activity-sla-monitor.checkOverdueActivities', () => {
    test('returns zeros when no candidate rows', async () => {
        mockState.rows = [];
        const out = await checkOverdueActivities(new Date());
        expect(out).toEqual({ checked: 0, warned: 0, breached: 0 });
        expect(mockNotify.notifyWarning).not.toHaveBeenCalled();
        expect(mockNotify.notifyBreach).not.toHaveBeenCalled();
    });

    test('fires WARNING when warningAt has passed and warnedAt is null', async () => {
        const asOf = new Date('2026-04-30T12:00:00Z');
        const past = new Date('2026-04-30T08:00:00Z');
        const future = new Date('2026-05-01T08:00:00Z');
        mockState.rows = [
            {
                id: 'a-1',
                applicationId: 'app-1',
                organizationId: 'org-1',
                state: 'TODO',
                workType: 'DOC_REVIEW',
                candidateGroup: 'document_reviewer',
                assignedUserId: null,
                warningAt: past,
                warnedAt: null,
                dueAt: future,
                breachedAt: null,
            },
        ];
        const out = await checkOverdueActivities(asOf);
        expect(out.warned).toBe(1);
        expect(out.breached).toBe(0);
        expect(mockNotify.notifyWarning).toHaveBeenCalledTimes(1);
        // dedup stamp
        expect(mockPrisma.workActivity.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'a-1' },
                data: { warnedAt: asOf },
            }),
        );
    });

    test('fires BREACH when dueAt has passed and breachedAt is null', async () => {
        const asOf = new Date('2026-04-30T12:00:00Z');
        const past = new Date('2026-04-30T08:00:00Z');
        mockState.rows = [
            {
                id: 'a-2',
                applicationId: 'app-2',
                organizationId: 'org-1',
                state: 'CLAIMED',
                workType: 'FIELD_AUDIT',
                candidateGroup: 'auditor',
                assignedUserId: 'u-1',
                warningAt: past,
                warnedAt: past, // already warned earlier
                dueAt: past,
                breachedAt: null,
            },
        ];
        const out = await checkOverdueActivities(asOf);
        expect(out.warned).toBe(0);
        expect(out.breached).toBe(1);
        expect(mockNotify.notifyBreach).toHaveBeenCalledTimes(1);
        expect(mockNotify.notifyWarning).not.toHaveBeenCalled();
        expect(mockPrisma.workActivity.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'a-2' },
                data: expect.objectContaining({ breachedAt: asOf }),
            }),
        );
    });

    test('suppresses warning when breach is already due (one alert, not two)', async () => {
        const asOf = new Date('2026-04-30T12:00:00Z');
        const past = new Date('2026-04-30T06:00:00Z');
        mockState.rows = [
            {
                id: 'a-3',
                applicationId: 'app-3',
                organizationId: 'org-1',
                state: 'TODO',
                workType: 'DOC_REVIEW',
                candidateGroup: 'document_reviewer',
                assignedUserId: null,
                warningAt: past,
                warnedAt: null,
                dueAt: past,
                breachedAt: null,
            },
        ];
        const out = await checkOverdueActivities(asOf);
        expect(out.warned).toBe(0);
        expect(out.breached).toBe(1);
        expect(mockNotify.notifyWarning).not.toHaveBeenCalled();
        expect(mockNotify.notifyBreach).toHaveBeenCalledTimes(1);
        // breach update also stamps warnedAt to suppress next-pass warning
        const updateCall = mockPrisma.workActivity.update.mock.calls[0][0];
        expect(updateCall.data.breachedAt).toBe(asOf);
        expect(updateCall.data.warnedAt).toBe(asOf);
    });

    test('one notification failure does not abort other rows', async () => {
        const asOf = new Date('2026-04-30T12:00:00Z');
        const past = new Date('2026-04-30T08:00:00Z');
        mockState.rows = [
            { id: 'a-4', applicationId: 'app-4', organizationId: 'org-1', state: 'TODO', workType: 'DOC_REVIEW', candidateGroup: 'document_reviewer', warningAt: past, warnedAt: null, dueAt: null, breachedAt: null },
            { id: 'a-5', applicationId: 'app-5', organizationId: 'org-1', state: 'TODO', workType: 'FIELD_AUDIT', candidateGroup: 'auditor', warningAt: past, warnedAt: null, dueAt: null, breachedAt: null },
        ];
        // First call throws, second succeeds.
        mockNotify.notifyWarning
            .mockImplementationOnce(async () => { throw new Error('email server down'); })
            .mockImplementationOnce(async () => 1);
        const out = await checkOverdueActivities(asOf);
        expect(out.checked).toBe(2);
        expect(out.warned).toBe(1);
    });

    test('skips rows missing organizationId (defensive)', async () => {
        const asOf = new Date('2026-04-30T12:00:00Z');
        const past = new Date('2026-04-30T08:00:00Z');
        mockState.rows = [
            {
                id: 'a-6',
                applicationId: 'app-6',
                organizationId: null,
                state: 'TODO',
                workType: 'DOC_REVIEW',
                candidateGroup: 'document_reviewer',
                warningAt: past,
                warnedAt: null,
                dueAt: null,
                breachedAt: null,
            },
        ];
        const out = await checkOverdueActivities(asOf);
        expect(out.warned).toBe(0);
        expect(out.breached).toBe(0);
    });
});
