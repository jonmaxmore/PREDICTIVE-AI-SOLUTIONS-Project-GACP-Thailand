/**
 * sla-aging-badge.test.tsx — V2-A (DR-5) regression test.
 *
 * Purpose: lock the contract that the "ค้าง N วัน" badge appears on
 * doc-review queue rows only when the workflow state is
 * ASSIGNED_FOR_REVIEW AND the submission has been pending at least
 * the SLA threshold (5 days, matching the `getSlaDays` danger flag in
 * provider-application-detail-config.ts:105). The badge MUST NOT show
 * on other states (otherwise reviewers see noise on Certified /
 * Submitted rows) nor for rows submitted under the threshold.
 *
 * Shape — pure predicate test using the exported `getSlaAgingBadge`
 * helper. The project does not pull in @testing-library/react so we
 * exercise the logic surface that the listing column's render function
 * consumes; the JSX wiring is implicit in the page component and
 * exercised by the Playwright suite (out of scope for unit tests).
 *
 * Date arithmetic uses Date.now() — we freeze it with jest fake timers
 * so the test is deterministic across CI clock drift.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// next/navigation stable mock per I-016 (page.tsx is not exercised here
// but if a sibling import drags it in we need a deterministic shim).
jest.mock('next/navigation', () => {
    const stableRouter = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => stableRouter,
        useSearchParams: () => new URLSearchParams(),
        usePathname: () => '/provider/applications',
        useParams: () => ({}),
    };
});

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: jest.fn(), post: jest.fn() },
}));

import { getSlaAgingBadge } from '../sla-aging';

// Freeze the clock at 2026-05-17T10:00:00Z (V2 iter date) so the
// day-arithmetic is reproducible.
const FIXED_NOW = new Date('2026-05-17T10:00:00.000Z').getTime();

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
});

afterEach(() => {
    jest.useRealTimers();
});

const daysAgoIso = (days: number) => new Date(FIXED_NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('getSlaAgingBadge — DR-5 SLA badge predicate (V2-A)', () => {
    it('returns null for SUBMITTED rows even when old (not in review queue yet)', () => {
        // The DR-5 spec scopes the badge to ASSIGNED_FOR_REVIEW only —
        // a SUBMITTED row sits with finance for the doc-fee approval
        // and the reviewer cannot act on it yet.
        const result = getSlaAgingBadge({
            workflowState: 'SUBMITTED',
            status: 'SUBMITTED',
            submittedAt: daysAgoIso(30),
        });
        expect(result).toBeNull();
    });

    it('returns null for ASSIGNED_FOR_REVIEW rows under the 5-day threshold', () => {
        const result = getSlaAgingBadge({
            workflowState: 'ASSIGNED_FOR_REVIEW',
            status: 'ASSIGNED_FOR_REVIEW',
            submittedAt: daysAgoIso(3),
        });
        expect(result).toBeNull();
    });

    it('returns null at the boundary (4 days — still within SLA)', () => {
        const result = getSlaAgingBadge({
            workflowState: 'ASSIGNED_FOR_REVIEW',
            status: 'ASSIGNED_FOR_REVIEW',
            submittedAt: daysAgoIso(4),
        });
        expect(result).toBeNull();
    });

    it('returns the badge at exactly 5 days (SLA threshold inclusive)', () => {
        const result = getSlaAgingBadge({
            workflowState: 'ASSIGNED_FOR_REVIEW',
            status: 'ASSIGNED_FOR_REVIEW',
            submittedAt: daysAgoIso(5),
        });
        expect(result).not.toBeNull();
        expect(result?.days).toBe(5);
        expect(result?.label).toBe('ค้าง 5 วัน');
    });

    it('returns the badge for ASSIGNED_FOR_REVIEW rows aged 12 days', () => {
        const result = getSlaAgingBadge({
            workflowState: 'ASSIGNED_FOR_REVIEW',
            status: 'ASSIGNED_FOR_REVIEW',
            submittedAt: daysAgoIso(12),
        });
        expect(result?.days).toBe(12);
        expect(result?.label).toBe('ค้าง 12 วัน');
    });

    it('falls back to status when workflowState is missing', () => {
        const result = getSlaAgingBadge({
            status: 'ASSIGNED_FOR_REVIEW',
            submittedAt: daysAgoIso(7),
        });
        expect(result?.days).toBe(7);
    });

    it('prefers createdAt over submittedAt when both are present', () => {
        // createdAt is the canonical SLA anchor on the detail page; the
        // listing should honour it for parity. Different values prove
        // the precedence.
        const result = getSlaAgingBadge({
            workflowState: 'ASSIGNED_FOR_REVIEW',
            status: 'ASSIGNED_FOR_REVIEW',
            createdAt: daysAgoIso(10),
            submittedAt: daysAgoIso(2),
        });
        expect(result?.days).toBe(10);
    });

    it('returns null when both timestamps are missing or malformed', () => {
        expect(
            getSlaAgingBadge({
                workflowState: 'ASSIGNED_FOR_REVIEW',
                status: 'ASSIGNED_FOR_REVIEW',
                submittedAt: '',
            }),
        ).toBeNull();
        expect(
            getSlaAgingBadge({
                workflowState: 'ASSIGNED_FOR_REVIEW',
                status: 'ASSIGNED_FOR_REVIEW',
                submittedAt: 'not-a-date',
            }),
        ).toBeNull();
    });

    it('returns null for revision-pending rows (the review clock is paused)', () => {
        // REVISION_REQUESTED means the ball is in the applicant's
        // court; we deliberately do not surface aging for that state
        // so reviewers can focus on rows that are actually their
        // responsibility.
        const result = getSlaAgingBadge({
            workflowState: 'REVISION_REQUESTED',
            status: 'REVISION_REQUESTED',
            submittedAt: daysAgoIso(20),
        });
        expect(result).toBeNull();
    });

    it('returns null for CERTIFIED / APPROVED rows (terminal states)', () => {
        expect(
            getSlaAgingBadge({
                workflowState: 'CERTIFIED',
                status: 'CERTIFIED',
                submittedAt: daysAgoIso(30),
            }),
        ).toBeNull();
        expect(
            getSlaAgingBadge({
                workflowState: 'APPROVED',
                status: 'APPROVED',
                submittedAt: daysAgoIso(30),
            }),
        ).toBeNull();
    });
});
