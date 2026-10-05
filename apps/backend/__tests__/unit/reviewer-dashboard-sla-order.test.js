/**
 * What the reviewer actually receives from GET /api/provider/reviewer/dashboard.
 *
 * The comparator and the cursor drain are tested on their own. This file tests
 * that the handler still uses them, because both are the kind of thing a later
 * refactor drops without any test going red: the queue would simply return to
 * oldest-first, and nothing would say so.
 *
 * Two contracts are pinned here.
 *
 * **Order.** Whoever runs out of time first appears first. The old handler
 * ordered by `createdAt asc`, so an application whose revision deadline expired
 * yesterday sat below one submitted a week earlier with three weeks left.
 *
 * **Honesty about completeness.** When the drain stops at its page budget the
 * response says `truncated: true`. A dashboard that shows a prefix of someone's
 * queue while presenting it as the whole is the same defect `take: 1000` was —
 * only the number changed. It has to be visible in the payload, not just in a
 * log line nobody reads.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, res, next) => {
        req.user = { id: 'reviewer-1', providerId: 'provider-1', role: 'DOCUMENT_REVIEWER', canonicalRole: 'DOCUMENT_REVIEWER' };
        return next();
    };
    return {
        authenticateProvider: buildHeaderUser,
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
    };
});

jest.mock('../../services/application-service', () => ({
    listAllReviewerQueueApplications: jest.fn(),
    findApplicationByIdOrNumberFormDataSlice: jest.fn(),
    updateReviewerProgress: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue(null),
}));

const applicationService = require('../../services/application-service');
const reviewerRouter = require('../../routes/api/provider/reviewer');

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/reviewer', reviewerRouter);
    return app;
};

/**
 * An application awaiting revision, with its deadline where the handler reads
 * it — `formData.revisionDueAt`, not a column.
 */
const awaitingRevision = (id, dueAt, submittedAt = '2026-01-01T00:00:00.000Z') => ({
    id,
    applicationNumber: `GACP-${id}`,
    status: 'REVISION_REQUESTED',
    reviewerId: 'reviewer-1',
    createdAt: new Date(submittedAt),
    updatedAt: new Date(submittedAt),
    workflowHistory: [],
    formData: {
        revisionDueAt: dueAt,
        revisionRequestedAt: submittedAt,
        currentState: 'REVISION_REQUESTED',
    },
    applicant: { firstName: 'สมชาย', lastName: 'ใจดี' },
});

const getDashboard = () => request(buildApp()).get('/api/provider/reviewer/dashboard');

describe('GET /reviewer/dashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('order', () => {
        it('puts the application closest to its deadline at the top', async () => {
            // Submitted newest-first on purpose: under the old `createdAt asc`
            // ordering this comes back exactly reversed.
            applicationService.listAllReviewerQueueApplications.mockResolvedValue({
                items: [
                    awaitingRevision('relaxed', '2026-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
                    awaitingRevision('overdue', '2025-06-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
                    awaitingRevision('soon', '2026-07-27T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
                ],
                truncated: false,
            });

            const response = await getDashboard();

            expect(response.status).toBe(200);
            const order = response.body.data.queues.awaitingRevision.items.map((item) => item.id);
            expect(order).toEqual(['overdue', 'soon', 'relaxed']);
        });

        it('orders the revision-deadline calendar the same way', async () => {
            applicationService.listAllReviewerQueueApplications.mockResolvedValue({
                items: [
                    awaitingRevision('later', '2026-09-01T00:00:00.000Z'),
                    awaitingRevision('sooner', '2026-08-01T00:00:00.000Z'),
                ],
                truncated: false,
            });

            const response = await getDashboard();

            expect(response.body.data.calendar.revisionDeadlines.map((entry) => entry.applicationId))
                .toEqual(['sooner', 'later']);
        });
    });

    describe('completeness', () => {
        it('reports an untruncated queue as untruncated', async () => {
            applicationService.listAllReviewerQueueApplications.mockResolvedValue({
                items: [awaitingRevision('a', '2026-08-01T00:00:00.000Z')],
                truncated: false,
            });

            const response = await getDashboard();
            expect(response.body.data.selectedQueue.pagination.truncated).toBe(false);
        });

        it('tells the client when the queue it is showing is only a prefix', async () => {
            applicationService.listAllReviewerQueueApplications.mockResolvedValue({
                items: [awaitingRevision('a', '2026-08-01T00:00:00.000Z')],
                truncated: true,
            });

            const response = await getDashboard();
            expect(response.body.data.selectedQueue.pagination.truncated).toBe(true);
        });
    });

    describe('the query it issues', () => {
        it('asks only for this reviewer, and asks for all of it', async () => {
            applicationService.listAllReviewerQueueApplications.mockResolvedValue({ items: [], truncated: false });

            await getDashboard();

            // No `take` — the ceiling is gone, and the drain decides its own
            // page size. Passing one here would put it back.
            expect(applicationService.listAllReviewerQueueApplications).toHaveBeenCalledWith({
                reviewerId: 'reviewer-1',
            });
        });

        it('survives a reviewer with an empty queue', async () => {
            applicationService.listAllReviewerQueueApplications.mockResolvedValue({ items: [], truncated: false });

            const response = await getDashboard();

            expect(response.status).toBe(200);
            expect(response.body.data.queues.awaitingRevision.items).toEqual([]);
            expect(response.body.data.kpi.pending).toBe(0);
        });
    });
});
