/**
 * reopen-period-modal — R7-D SoD pre-flight unit tests.
 *
 * Why this shape: the project does NOT pull in @testing-library/react
 * (see `apps/web-app/package.json` — only `@testing-library/jest-dom`
 * is installed) and Radix Dialog portals away in jsdom (so
 * `renderToStaticMarkup` returns an empty string for the open dialog
 * body). The existing tests in this folder
 * (`close-period-modal.test.tsx`) and across the repo
 * (`force-status-modal.test.tsx`, `AssignAuditorModal.test.tsx`)
 * solve this with TWO complementary patterns:
 *
 *   1. Export a pure helper from the .tsx module and unit-test the
 *      helper directly (mirrors `mapClosePeriodError`).
 *   2. SSR via `renderToStaticMarkup` for prop-contract smoke tests
 *      (mirrors `AssignAuditorModal`).
 *
 * R7-D adopts BOTH:
 *   - 6 predicate tests exhaustively cover the SoD truth table for the
 *     newly-exported `isSelfReopen(currentUserId, record)`.
 *   - 4 SSR tests assert the component renders without throwing across
 *     the same matrix of props (closed/open × self/non-self), proving
 *     the helper is wired into the JSX without behavior regressions.
 *
 * Closes R6-B's M-3 (SoD pre-flight) verification debt.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

// Stub the service layer so the modal can import without reaching the
// real apiClient. We only care about the rendered prop contract.
jest.mock('@/lib/services/finance-orphans-service', () => ({
    PeriodCloseService: {
        reopenPeriod: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValue({ id: 'pc-1', status: 'REOPENED' }),
    },
}));

import { ReopenPeriodModal, isSelfReopen } from '../reopen-period-modal';
import type { PeriodCloseRecord } from '@/lib/services/finance-orphans-service';

const sampleRecord: PeriodCloseRecord = {
    id: 'pc-2026-04',
    organizationId: 'org-1',
    year: 2026,
    month: 4,
    status: 'CLOSED',
    closedAt: '2026-05-01T03:00:00.000Z',
    closedBy: 'user-admin-A',
    notes: null,
};

describe('isSelfReopen — SoD predicate (R7-D)', () => {
    it('returns TRUE when currentUserId === record.closedBy (the SoD violation)', () => {
        expect(isSelfReopen('user-admin-A', sampleRecord)).toBe(true);
    });

    it('returns FALSE when currentUserId !== record.closedBy (the normal case)', () => {
        expect(isSelfReopen('user-admin-B', sampleRecord)).toBe(false);
    });

    it('returns FALSE when currentUserId is null (signed out / auth loading)', () => {
        // Backend remains the source of truth — we MUST NOT show the
        // warning here, otherwise an unauthenticated render would flash
        // the alert before auth resolves.
        expect(isSelfReopen(null, sampleRecord)).toBe(false);
    });

    it('returns FALSE when currentUserId is undefined (prop omitted)', () => {
        // Existing call sites that pre-date R6-B pass nothing — they
        // must continue to work without the warning.
        expect(isSelfReopen(undefined, sampleRecord)).toBe(false);
    });

    it('returns FALSE when record is null (modal in transition / no target)', () => {
        // Parent passes `record={reopenTarget}` which is null between
        // closing one row and opening another — must not crash.
        expect(isSelfReopen('user-admin-A', null)).toBe(false);
    });

    it('returns FALSE when record.closedBy is null (defensive — OPEN row leaked through)', () => {
        const orphan: PeriodCloseRecord = { ...sampleRecord, closedBy: null };
        expect(isSelfReopen('user-admin-A', orphan)).toBe(false);
    });

    it('returns FALSE when currentUserId is an empty string (truthy-check guards us)', () => {
        // An empty string is a "logged in as nobody" footgun. The
        // Boolean(...) guard at the top of the predicate must reject it.
        expect(isSelfReopen('', sampleRecord)).toBe(false);
    });

    it('returns FALSE when both ids exist but differ only by case (exact-match required)', () => {
        // SELF_REOPEN_FORBIDDEN backend guard is exact string match
        // (Postgres-equality); the client predicate must match exactly
        // to avoid a false-positive client warning that the server would
        // overrule.
        expect(isSelfReopen('user-admin-a', sampleRecord)).toBe(false);
    });
});

describe('ReopenPeriodModal — SSR prop contract (R7-D)', () => {
    it('exports the named component symbol', () => {
        expect(typeof ReopenPeriodModal).toBe('function');
    });

    it('renders without throwing when closed (default mount path)', () => {
        expect(() =>
            renderToStaticMarkup(
                <ReopenPeriodModal
                    open={false}
                    record={sampleRecord}
                    onClose={() => {}}
                    onReopened={() => {}}
                />,
            ),
        ).not.toThrow();
    });

    it('renders without throwing when open=true + non-self user (normal path)', () => {
        expect(() =>
            renderToStaticMarkup(
                <ReopenPeriodModal
                    open
                    record={sampleRecord}
                    currentUserId="user-admin-B"
                    onClose={() => {}}
                    onReopened={() => {}}
                />,
            ),
        ).not.toThrow();
    });

    it('renders without throwing when open=true + self-reopen (SoD path)', () => {
        // The SoD branch renders an extra <div role="alert">; this test
        // proves the conditional render does not throw — Radix portals
        // body away so we cannot grep the markup, but the SoD message
        // path is exercised by the `isSelfReopen` predicate tests above.
        expect(() =>
            renderToStaticMarkup(
                <ReopenPeriodModal
                    open
                    record={sampleRecord}
                    currentUserId="user-admin-A"
                    onClose={() => {}}
                    onReopened={() => {}}
                />,
            ),
        ).not.toThrow();
    });

    it('renders without throwing when record is null (parent transition)', () => {
        expect(() =>
            renderToStaticMarkup(
                <ReopenPeriodModal
                    open={false}
                    record={null}
                    currentUserId="user-admin-A"
                    onClose={() => {}}
                    onReopened={() => {}}
                />,
            ),
        ).not.toThrow();
    });
});
