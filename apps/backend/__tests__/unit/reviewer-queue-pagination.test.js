/**
 * The reviewer queue is read in pages, and every page is read.
 *
 * The query used to be a single `findMany` with `take: 1000`. Scoping it to one
 * reviewer removed most of the damage, but not the shape of it: `take` is still
 * a ceiling, and a ceiling that is never reported is a ceiling that lies. Give
 * one reviewer more than a thousand open applications and the thousand-and-first
 * is not fetched, not counted in any KPI, and not on the dashboard of the person
 * responsible for it. Nothing errors. Nothing warns. The work is simply gone.
 *
 * So the ceiling comes out and pagination goes in — cursor-based, because
 * `skip`/`offset` re-scans every row it steps over and, worse, drifts: rows
 * inserted or re-sorted between two offset reads make the reader skip rows it
 * never saw. A cursor is anchored to a row, so the next page starts exactly
 * where the last one stopped.
 *
 * Cursor paging needs a *total* order, which `createdAt` alone is not — two
 * applications submitted in the same millisecond tie, and a tie makes the page
 * boundary ambiguous in both directions. `[createdAt asc, id asc]` breaks it.
 *
 * The drain is bounded, because an unbounded loop against a table is a way to
 * take the server down. But the bound is honest: if it is ever reached the
 * result says `truncated: true` and says how much it read, so the dashboard can
 * tell the reviewer their queue is not all here. That is the whole difference
 * between this and `take: 1000`.
 */

const { createApplicationProviderQueryMethods } = require('../../services/application-service/application-provider-query-methods');

const REVIEWER = '7f3d9c11-0000-4000-8000-000000000001';

/** Rows numbered so ordering and duplication are both visible at a glance. */
const rows = (from, count) => Array.from({ length: count }, (_, index) => ({
    id: `app-${String(from + index).padStart(4, '0')}`,
    applicationNumber: `GACP-${from + index}`,
}));

/**
 * A Prisma stand-in that serves a fixed row list through real cursor semantics,
 * so the drain is tested against the paging contract rather than against a mock
 * that agrees with whatever the caller does.
 */
const fakePrisma = (allRows) => {
    const calls = [];
    return {
        calls,
        application: {
            findMany: jest.fn(async (args) => {
                calls.push(args);
                const start = args.cursor
                    ? allRows.findIndex((row) => row.id === args.cursor.id) + (args.skip || 0)
                    : 0;
                return allRows.slice(start, start + args.take);
            }),
        },
    };
};

const methodsFor = (allRows) => {
    const prisma = fakePrisma(allRows);
    return { prisma, methods: createApplicationProviderQueryMethods({ prisma }) };
};

describe('listAllReviewerQueueApplications', () => {
    describe('it reads past the old ceiling', () => {
        it('returns every row a reviewer has, across many pages', async () => {
            const all = rows(1, 2500);
            const { methods } = methodsFor(all);

            const result = await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });

            expect(result.items).toHaveLength(2500);
            expect(result.items.map((row) => row.id)).toEqual(all.map((row) => row.id));
        });

        it('reports that nothing was withheld', async () => {
            const { methods } = methodsFor(rows(1, 2500));
            const result = await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });
            expect(result.truncated).toBe(false);
        });

        it('never returns the same application twice', async () => {
            const { methods } = methodsFor(rows(1, 1001));
            const result = await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 100 });
            expect(new Set(result.items.map((row) => row.id)).size).toBe(result.items.length);
        });
    });

    describe('how it pages', () => {
        it('anchors each page on a cursor rather than an offset', async () => {
            const { prisma, methods } = methodsFor(rows(1, 450));
            await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });

            const [first, ...rest] = prisma.calls;
            expect(first.cursor).toBeUndefined();
            for (const call of rest) {
                expect(call.cursor).toEqual({ id: expect.any(String) });
                // `skip: 1` steps over the cursor row itself, which would
                // otherwise be returned again at the head of every page.
                expect(call.skip).toBe(1);
            }
        });

        it('orders by a total key so page boundaries cannot drift', async () => {
            const { prisma, methods } = methodsFor(rows(1, 10));
            await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });
            expect(prisma.calls[0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
        });

        it('scopes every page to the one reviewer', async () => {
            const { prisma, methods } = methodsFor(rows(1, 450));
            await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });
            for (const call of prisma.calls) {
                expect(call.where.OR).toContainEqual({ reviewerId: REVIEWER });
            }
        });

        it('stops as soon as a page comes back short', async () => {
            const { prisma, methods } = methodsFor(rows(1, 150));
            await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });
            // One read returned 150 of a possible 200 — there is provably
            // nothing after it, so a second read would be a wasted round trip.
            expect(prisma.calls).toHaveLength(1);
        });

        it('needs no extra read when the last page is exactly full', async () => {
            // Each read asks for one row more than it intends to keep. That
            // spare row answers "is there another page?" without a round trip
            // that returns nothing, and it is what makes `truncated` exact
            // rather than a guess made at the last page boundary.
            const { prisma, methods } = methodsFor(rows(1, 400));
            const result = await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });
            expect(prisma.calls).toHaveLength(2);
            expect(result.items).toHaveLength(400);
            expect(result.truncated).toBe(false);
        });

        it('asks for one row beyond the page as the probe', async () => {
            const { prisma, methods } = methodsFor(rows(1, 400));
            await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 200 });
            expect(prisma.calls[0].take).toBe(201);
        });
    });

    describe('the bound is honest', () => {
        it('says so when it stops early rather than pretending it finished', async () => {
            const { methods } = methodsFor(rows(1, 5000));
            const result = await methods.listAllReviewerQueueApplications({
                reviewerId: REVIEWER,
                pageSize: 100,
                maxPages: 3,
            });
            expect(result.items).toHaveLength(300);
            expect(result.truncated).toBe(true);
        });

        it('does not claim truncation when the bound was merely reachable', async () => {
            const { methods } = methodsFor(rows(1, 300));
            const result = await methods.listAllReviewerQueueApplications({
                reviewerId: REVIEWER,
                pageSize: 100,
                maxPages: 3,
            });
            expect(result.items).toHaveLength(300);
            expect(result.truncated).toBe(false);
        });
    });

    describe('empty and degenerate queues', () => {
        it('returns nothing for a reviewer with no work', async () => {
            const { prisma, methods } = methodsFor([]);
            const result = await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER });
            expect(result).toEqual({ items: [], truncated: false });
            expect(prisma.calls).toHaveLength(1);
        });

        it('refuses a page size of zero instead of looping forever', async () => {
            const { methods } = methodsFor(rows(1, 10));
            const result = await methods.listAllReviewerQueueApplications({ reviewerId: REVIEWER, pageSize: 0 });
            expect(result.items.length).toBeGreaterThan(0);
        });
    });
});
