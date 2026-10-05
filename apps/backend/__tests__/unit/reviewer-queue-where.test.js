/**
 * The reviewer queue asks the database for the reviewer's own work.
 *
 * It used to ask for everybody's:
 *
 *     const applications = await listReviewerQueueApplications({ take: 1000 });
 *     const myApplications = applications.filter((a) => a.reviewerId === currentReviewerId
 *         || obj(obj(a.formData).PROVIDERAssignment).reviewerId === currentReviewerId);
 *
 * Two things wrong with that, and the second is not about speed.
 *
 * **It transfers the whole pipeline to keep a handful.** Every reviewer's
 * dashboard load pulled up to a thousand applications with their `formData` and
 * `workflowHistory` JSON columns — the entire wizard payload per row — and then
 * discarded almost all of it in JavaScript.
 *
 * **And `take: 1000` is a silent ceiling.** Once the document-review pipeline
 * holds more than a thousand applications, the ones past the limit are never
 * fetched, so they never reach the filter, so they never appear on the
 * dashboard of the reviewer they are assigned to. No error and no warning: a
 * farmer's application simply stops being visible to the person responsible for
 * it. `orderBy: createdAt asc` decides who disappears — the newest work, which
 * is the work with a live SLA.
 *
 * Filtering in the database fixes both. These tests pin the filter itself,
 * because the ownership rule has two branches and dropping either one empties
 * somebody's dashboard — which is exactly what REV-01 already recorded happening
 * once: "the reviewer's primary dashboard was ALWAYS empty even with
 * validly-assigned work".
 */

const { reviewerQueueWhere, REVIEWER_QUEUE_STATUSES } = require('../../services/application-service/reviewer-queue-where');

const REVIEWER = '7f3d9c11-0000-4000-8000-000000000001';

describe('reviewerQueueWhere', () => {
    describe('the pipeline it covers', () => {
        it('keeps the document-review states the dashboard partitions on', () => {
            for (const status of ['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED', 'DOC_APPROVED']) {
                expect(REVIEWER_QUEUE_STATUSES).toContain(status);
            }
        });

        it('excludes deleted applications', () => {
            expect(reviewerQueueWhere({}).isDeleted).toBe(false);
        });

        it('filters on status in the query, not afterwards', () => {
            expect(reviewerQueueWhere({}).status).toEqual({ in: REVIEWER_QUEUE_STATUSES });
        });
    });

    describe('ownership, both branches', () => {
        const where = reviewerQueueWhere({ reviewerId: REVIEWER });

        it('matches the canonical reviewerId column', () => {
            expect(where.OR).toContainEqual({ reviewerId: REVIEWER });
        });

        it('still matches rows assigned before the reviewerId backfill', () => {
            // REV-01: legacy assignments live at
            // formData.PROVIDERAssignment.reviewerId. Dropping this branch would
            // empty the dashboard of every reviewer whose work predates the
            // column — the exact failure REV-01 was raised for.
            expect(where.OR).toContainEqual({
                formData: {
                    path: ['PROVIDERAssignment', 'reviewerId'],
                    equals: REVIEWER,
                },
            });
        });

        it('is an OR, not an AND — a row needs only one of them', () => {
            expect(where.OR).toHaveLength(2);
            expect(where.AND).toBeUndefined();
        });
    });

    describe('when no reviewer is given', () => {
        it('does not filter by ownership at all', () => {
            // The unscoped shape is for callers that genuinely want the whole
            // pipeline. It must not silently become "assigned to nobody".
            expect(reviewerQueueWhere({}).OR).toBeUndefined();
            expect(reviewerQueueWhere({ reviewerId: null }).OR).toBeUndefined();
            expect(reviewerQueueWhere({ reviewerId: '' }).OR).toBeUndefined();
        });

        it('treats whitespace as absent rather than searching for it', () => {
            expect(reviewerQueueWhere({ reviewerId: '   ' }).OR).toBeUndefined();
        });
    });

    describe('the id is used as data', () => {
        it('passes it through untouched, as a Prisma value', () => {
            // Prisma parameterises these; the id is never interpolated into
            // SQL. This asserts we hand it over rather than building a string.
            const odd = "'; DROP TABLE \"Application\"; --";
            const where = reviewerQueueWhere({ reviewerId: odd });
            expect(where.OR[0]).toEqual({ reviewerId: odd });
        });

        it('trims surrounding whitespace so a padded id still matches', () => {
            expect(reviewerQueueWhere({ reviewerId: `  ${REVIEWER}  ` }).OR[0])
                .toEqual({ reviewerId: REVIEWER });
        });
    });
});
