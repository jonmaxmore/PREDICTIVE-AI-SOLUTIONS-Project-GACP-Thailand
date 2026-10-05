/**
 * The admin dashboard's auditor-workload panel.
 *
 * The handler looped over every auditor and awaited
 * `countAuditorActiveAssignments(orgId, user.id)` once each — N round trips for
 * N auditors, each running a `count` with a JSON-path predicate that no index
 * can serve.
 *
 * `countAuditorActiveAssignmentsBulk` has been sitting in the same service,
 * exported, since the batch-10 cleanup, with a comment that says exactly what it
 * is for: "N+1 -> 1 query for N auditors". Nothing called it. The fix is to call
 * it.
 *
 * The arithmetic gets pinned here too, because `availability` is what an admin
 * reads to decide who receives the next farm visit, and its two thresholds are
 * both boundary conditions.
 */

const { buildAuditorWorkload, AUDITOR_CAPACITY } = require('../../services/admin/auditor-workload');

const user = (id, over = {}) => ({ id, firstName: 'สมชาย', lastName: 'ใจดี', role: 'AUDITOR', ...over });

describe('buildAuditorWorkload', () => {
    describe('it reads counts from the batched lookup', () => {
        it('gives each auditor their own count', () => {
            const counts = new Map([['a', 3], ['b', 7]]);
            const rows = buildAuditorWorkload([user('a'), user('b')], counts);
            expect(rows.map((r) => [r.id, r.active])).toEqual([['a', 3], ['b', 7]]);
        });

        it('treats an auditor missing from the map as having no work', () => {
            // Not as unknown, and certainly not as full — an auditor with no
            // assignments should read AVAILABLE, which is the point of the panel.
            const rows = buildAuditorWorkload([user('a')], new Map());
            expect(rows[0].active).toBe(0);
            expect(rows[0].availability).toBe('AVAILABLE');
        });

        it('survives no map at all', () => {
            expect(buildAuditorWorkload([user('a')], null)[0].active).toBe(0);
        });

        it('is empty for no auditors', () => {
            expect(buildAuditorWorkload([], new Map())).toEqual([]);
            expect(buildAuditorWorkload(null, new Map())).toEqual([]);
        });
    });

    describe('availability, at its boundaries', () => {
        const availabilityAt = (active) => buildAuditorWorkload([user('a')], new Map([['a', active]]))[0].availability;

        it('is AVAILABLE below 70% of capacity', () => {
            expect(availabilityAt(0)).toBe('AVAILABLE');
            expect(availabilityAt(6)).toBe('AVAILABLE');
        });

        it('is BUSY from exactly 70%', () => {
            // 7 of 10. An auditor at the threshold is busy, not available —
            // rounding this the other way sends them one more farm visit.
            expect(availabilityAt(7)).toBe('BUSY');
            expect(availabilityAt(9)).toBe('BUSY');
        });

        it('is FULL from exactly capacity', () => {
            expect(availabilityAt(AUDITOR_CAPACITY)).toBe('FULL');
        });

        it('stays FULL beyond capacity rather than wrapping', () => {
            expect(availabilityAt(AUDITOR_CAPACITY + 5)).toBe('FULL');
        });
    });

    describe('utilisation', () => {
        it('is a percentage of capacity', () => {
            const rows = buildAuditorWorkload([user('a')], new Map([['a', 5]]));
            expect(rows[0].utilization).toBe(50);
        });

        it('does not exceed 100 for an over-assigned auditor', () => {
            // The bar would otherwise render past its track, and "150%" reads
            // like a data error rather than an overloaded person.
            const rows = buildAuditorWorkload([user('a')], new Map([['a', 15]]));
            expect(rows[0].utilization).toBe(100);
        });

        it('is a whole number', () => {
            const rows = buildAuditorWorkload([user('a')], new Map([['a', 1]]));
            expect(Number.isInteger(rows[0].utilization)).toBe(true);
        });
    });

    describe('the name shown', () => {
        it('joins the parts', () => {
            expect(buildAuditorWorkload([user('a')], new Map())[0].name).toBe('สมชาย ใจดี');
        });

        it('uses whichever part exists', () => {
            expect(buildAuditorWorkload([user('a', { lastName: null })], new Map())[0].name).toBe('สมชาย');
        });

        it('falls back to a dash rather than printing "null null"', () => {
            const rows = buildAuditorWorkload([user('a', { firstName: null, lastName: null })], new Map());
            expect(rows[0].name).toBe('-');
        });

        it('falls back to a dash for a missing role', () => {
            expect(buildAuditorWorkload([user('a', { role: null })], new Map())[0].role).toBe('-');
        });
    });
});
