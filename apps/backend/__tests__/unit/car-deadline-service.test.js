'use strict';

/**
 * CAR deadline helper (workflow audit 2026-06-11, HIGH). A CAR raised by an
 * auditor must start the canonical 5-working-day clock (Thai-holiday-aware) and
 * seed a RevisionDeadline row the cron can expire.
 */

const mockFindDeadline = jest.fn();
const mockUpsertDeadline = jest.fn().mockResolvedValue({ id: 'rd-1' });
jest.mock('../../services/admin-application-service', () => ({
    findRevisionDeadlineByApplicationId: (...a) => mockFindDeadline(...a),
    upsertRevisionDeadline: (...a) => mockUpsertDeadline(...a),
}));

const { computeCarDueDate, seedCarRevisionDeadline, CAR_DEADLINE_BUSINESS_DAYS } = require('../../services/car-deadline-service');

describe('car-deadline-service', () => {
    beforeEach(() => jest.clearAllMocks());

    it('uses the 5-working-day window', () => {
        expect(CAR_DEADLINE_BUSINESS_DAYS).toBe(5);
    });

    it('computeCarDueDate skips Thai public holidays (Asia/Bangkok), not just weekends', () => {
        // Wed 2026-04-29 + 5 working days: skips Fri 5/1 (Labour Day) and Mon 5/4
        // (Coronation Day) + the weekends → Fri 2026-05-08. The holiday-blind
        // calculator would return Wed 2026-05-06.
        const due = computeCarDueDate(new Date('2026-04-29T06:00:00Z'));
        expect(due.toISOString().slice(0, 10)).toBe('2026-05-08');
    });

    it('seedCarRevisionDeadline upserts a PENDING row, bumping revisionCount on an existing CAR loop', async () => {
        mockFindDeadline.mockResolvedValue({ revisionCount: 2 });
        const dueAt = new Date('2026-05-08T10:00:00Z');
        await seedCarRevisionDeadline({ applicationId: 'app-1', dueAt, actorId: 'auditor-1' });

        expect(mockUpsertDeadline).toHaveBeenCalledWith(expect.objectContaining({
            applicationId: 'app-1',
            update: expect.objectContaining({ revisionDue: dueAt, status: 'PENDING', revisionCount: 3 }),
            create: expect.objectContaining({ revisionDue: dueAt, status: 'PENDING', revisionCount: 1 }),
        }));
    });

    it('seedCarRevisionDeadline starts revisionCount at 1 for a first-time CAR', async () => {
        mockFindDeadline.mockResolvedValue(null);
        await seedCarRevisionDeadline({ applicationId: 'app-2', dueAt: new Date('2026-05-08T10:00:00Z'), actorId: 'a' });
        expect(mockUpsertDeadline.mock.calls[0][0].update.revisionCount).toBe(1);
    });

    it('seedCarRevisionDeadline is a no-op on missing/invalid args (no upsert)', async () => {
        await seedCarRevisionDeadline({ applicationId: null, dueAt: new Date() });
        await seedCarRevisionDeadline({ applicationId: 'x', dueAt: new Date('invalid') });
        await seedCarRevisionDeadline({});
        expect(mockUpsertDeadline).not.toHaveBeenCalled();
    });
});
