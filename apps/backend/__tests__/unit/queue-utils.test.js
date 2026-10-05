/**
 * Unit tests for queue-utils.js — specifically the reschedule/followup
 * candidate predicates used by the scheduler and auditor dashboards.
 *
 * Retro-QA fix (2026-05-15, HIGH-2): the `isMajorRescheduleCandidate`
 * helper previously had ZERO direct unit tests — only indirect coverage
 * via the scheduler-dashboard integration test. A false-negative would
 * silently leave applications stuck in the wrong queue. These tests
 * exercise the predicate directly with fixtures for each canonical and
 * edge-case state.
 */

const path = require('path');

// Mock the prisma module so we can require queue-utils without booting Prisma.
jest.mock('../../services/prisma-database', () => ({
    prisma: {},
}));

const queueUtils = require(path.join(
    __dirname,
    '..',
    '..',
    'routes',
    'api',
    'provider',
    'handlers',
    'queue-utils.js',
));

const { isMajorRescheduleCandidate } = queueUtils;
// Note: `isMinorFollowupCandidate` is defined in queue-utils.js but kept
// internal (used only by `buildAuditorQueueItem`); the closing-review
// retro-QA confirmed there was no need to widen the export surface just
// for unit testing — its behavior is exercised indirectly via the
// auditor-dashboard integration test.

describe('isMajorRescheduleCandidate', () => {
    it('returns false for an empty application', () => {
        expect(isMajorRescheduleCandidate(undefined)).toBe(false);
        expect(isMajorRescheduleCandidate(null)).toBe(false);
        expect(isMajorRescheduleCandidate({})).toBe(false);
    });

    it('returns false when current state is OUTSIDE the CAR loop, even with MAJOR in history', () => {
        // This is the bug the state-gate guards against: an app that
        // completed the CAR loop and moved on (e.g. AUDIT_PASSED, APPROVED,
        // CERTIFIED, or recycled to AUDIT_FEE_PAID) should NOT be flagged.
        const certified = {
            status: 'CERTIFIED',
            formData: { workflowState: 'CERTIFIED' },
            workflowHistory: [
                { timestamp: '2026-05-01T00:00:00Z', decision: 'MAJOR' },
                { timestamp: '2026-05-02T00:00:00Z', decision: 'PASS' },
            ],
        };
        expect(isMajorRescheduleCandidate(certified)).toBe(false);

        const auditFeePaid = {
            status: 'AUDIT_FEE_PAID',
            formData: { workflowState: 'AUDIT_FEE_PAID' },
            workflowHistory: [{ decision: 'MAJOR' }],
        };
        expect(isMajorRescheduleCandidate(auditFeePaid)).toBe(false);
    });

    it('returns true when in CAR_PENDING with MAJOR decision in history', () => {
        const carPendingAfterMajor = {
            status: 'CAR_PENDING',
            formData: { workflowState: 'CAR_PENDING' },
            workflowHistory: [
                { timestamp: '2026-05-01T00:00:00Z', decision: 'MAJOR' },
            ],
        };
        expect(isMajorRescheduleCandidate(carPendingAfterMajor)).toBe(true);
    });

    it('returns true when in CAR_REVIEWING with MAJOR decision in history', () => {
        const carReviewingAfterMajor = {
            status: 'CAR_REVIEWING',
            formData: { workflowState: 'CAR_REVIEWING' },
            workflowHistory: [{ decision: 'MAJOR' }],
        };
        expect(isMajorRescheduleCandidate(carReviewingAfterMajor)).toBe(true);
    });

    it('returns false when in CAR_PENDING but no MAJOR in history (e.g. MINOR-only)', () => {
        const carPendingMinorOnly = {
            status: 'CAR_PENDING',
            formData: { workflowState: 'CAR_PENDING' },
            workflowHistory: [{ decision: 'MINOR' }],
        };
        expect(isMajorRescheduleCandidate(carPendingMinorOnly)).toBe(false);
    });

    it('reads MAJOR from event.metadata.decision (nested-decision shape)', () => {
        const carPendingMajorViaMetadata = {
            status: 'CAR_PENDING',
            formData: { workflowState: 'CAR_PENDING' },
            workflowHistory: [
                { action: 'WORKFLOW_TRANSITION', metadata: { decision: 'MAJOR' } },
            ],
        };
        expect(isMajorRescheduleCandidate(carPendingMajorViaMetadata)).toBe(true);
    });

    it('reads MAJOR from event.result.decision (alternative nested shape)', () => {
        const carReviewingMajorViaResult = {
            status: 'CAR_REVIEWING',
            formData: { workflowState: 'CAR_REVIEWING' },
            workflowHistory: [
                { action: 'AUDIT_DECISION_RECORDED', result: { decision: 'MAJOR' } },
            ],
        };
        expect(isMajorRescheduleCandidate(carReviewingMajorViaResult)).toBe(true);
    });

    it('reads MAJOR from event.reasonCode (substring match)', () => {
        const carPendingMajorViaReasonCode = {
            status: 'CAR_PENDING',
            formData: { workflowState: 'CAR_PENDING' },
            workflowHistory: [
                { action: 'WORKFLOW_TRANSITION', reasonCode: 'AUDITOR_MAJOR_FINDING' },
            ],
        };
        expect(isMajorRescheduleCandidate(carPendingMajorViaReasonCode)).toBe(true);
    });

    it('handles legacy status aliases that resolve to CAR loop states', () => {
        // STATE_BY_LEGACY_STATUS doesn't map any legacy alias to CAR_PENDING
        // directly, but `formData.workflowState` takes precedence in
        // `resolveStateFromApplication`. Verify that a legacy status with
        // an explicit CAR_REVIEWING workflowState still resolves correctly.
        const mixedLegacy = {
            status: 'AUDIT_FAILED', // STATE_BY_LEGACY_STATUS maps to REJECTED
            formData: { workflowState: 'CAR_REVIEWING' }, // takes precedence
            workflowHistory: [{ decision: 'MAJOR' }],
        };
        expect(isMajorRescheduleCandidate(mixedLegacy)).toBe(true);
    });
});

