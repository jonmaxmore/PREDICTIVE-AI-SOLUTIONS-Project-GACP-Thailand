/**
 * The admin dashboard's auditor-workload panel.
 *
 * The handler looped over every auditor and awaited
 * `countAuditorActiveAssignments(orgId, user.id)` once each — N round trips for
 * N auditors, each running a `count` with a JSON-path predicate no index can
 * serve. `countAuditorActiveAssignmentsBulk` has been in the same service,
 * exported, since the batch-10 cleanup, with a comment saying exactly what it
 * is for: "N+1 -> 1 query for N auditors". Nothing called it.
 *
 * This is the shaping half, separated so the arithmetic can be tested without a
 * database — `availability` is what an admin reads when deciding who gets the
 * next farm visit, and both of its thresholds are boundaries.
 */

/** Active assignments one auditor is expected to carry. */
const AUDITOR_CAPACITY = 10;

/** At or above this share of capacity an auditor is busy rather than available. */
const BUSY_THRESHOLD = 0.7;

/**
 * @param {Array<object>} users     auditor rows (`id`, `firstName`, `lastName`, `role`)
 * @param {Map<string, number>} counts active assignments per user id, from the
 *   batched lookup
 * @returns {Array<object>} one row per auditor
 */
function buildAuditorWorkload(users, counts) {
    return (users || []).map((user) => {
        // Absent from the map means no assignments — not unknown, and certainly
        // not full. An auditor with nothing on should read AVAILABLE, which is
        // the entire point of the panel.
        const active = Number(counts?.get?.(String(user.id)) ?? 0) || 0;

        return {
            id: user.id,
            name: [user.firstName, user.lastName].filter(Boolean).join(' ') || '-',
            role: user.role || '-',
            active,
            capacity: AUDITOR_CAPACITY,
            // Capped: a bar past its own track reads as a data error rather
            // than as an overloaded person.
            utilization: Math.min(100, Math.round((active / AUDITOR_CAPACITY) * 100)),
            availability: active >= AUDITOR_CAPACITY
                ? 'FULL'
                : active >= AUDITOR_CAPACITY * BUSY_THRESHOLD
                    ? 'BUSY'
                    : 'AVAILABLE',
        };
    });
}

module.exports = { buildAuditorWorkload, AUDITOR_CAPACITY, BUSY_THRESHOLD };
