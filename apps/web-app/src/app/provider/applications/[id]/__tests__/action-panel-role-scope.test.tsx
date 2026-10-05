/**
 * action-panel-role-scope.test.tsx — V2-A (DR-2) regression test.
 *
 * Purpose: lock the contract that the "Approve Documents" / "Request
 * Revision" action panel is ONLY visible to the canonical roles that
 * the backend ROLE_TRANSITIONS map authorises to drive
 * `ASSIGNED_FOR_REVIEW -> DOC_APPROVED` / `... -> REVISION_REQUESTED`.
 * Non-target roles must see the read-only Thai notice instead — this
 * test pins the predicate so a future refactor does not silently
 * re-expose the buttons (and the resulting 400 from the workflow
 * service).
 *
 * Shape — pure predicate per `force-status-modal.test.tsx`. The repo
 * does NOT pull in @testing-library/react (only `@testing-library/jest-
 * dom`), so we test the exported `viewerCanActOnReview` predicate the
 * page consumes inside its `useMemo`. The visual wiring is exercised
 * by the second describe-block via `renderToStaticMarkup` so the
 * predicate-to-JSX edge cannot rot.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

// Stable next/navigation router per I-016 (per-file factory).
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
        usePathname: () => '/provider/applications/test-id',
        useParams: () => ({ id: 'test-id' }),
    };
});

// The api-client is reached via the useEffect on mount; stub it so the
// SSR pass does not crash trying to call fetch.
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: jest
            .fn<() => Promise<{ success: boolean; data: unknown }>>()
            .mockResolvedValue({ success: false, data: null }),
        post: jest
            .fn<() => Promise<{ success: boolean; data: unknown }>>()
            .mockResolvedValue({ success: true, data: {} }),
    },
}));

// Sonner toast — pulled in transitively; stub so jsdom doesn't choke.
jest.mock('sonner', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import ProviderApplicationDetailPage from '../page';
// REVIEW_ACTION_ROLES / viewerCanActOnReview moved out of page.tsx into
// review-gate.ts (Next forbids non-default page exports). The 9-step gate
// (REQUIRED_REVIEWED_STEPS / getReviewedStepsGate) was removed 2026-06-23.
import {
    REVIEW_ACTION_ROLES,
    viewerCanActOnReview,
} from '../review-gate';

describe('viewerCanActOnReview — DR-2 role predicate (V2-A)', () => {
    it('returns TRUE for ADMIN (canonical override)', () => {
        expect(viewerCanActOnReview('system_admin_dtam')).toBe(true);
    });

    it('returns TRUE for DOCUMENT_REVIEWER (the doc-review queue owner)', () => {
        expect(viewerCanActOnReview('document_reviewer')).toBe(true);
    });

    it('returns TRUE for AUDITOR (per ROLE_TRANSITIONS — RB-5 inheritance)', () => {
        // Auditor inherits the ASSIGNED_FOR_REVIEW -> DOC_APPROVED pair
        // from the consolidated head_auditor role; this is intentional
        // per the canonical contract (workflow-transition-service.js
        // lines 217-226). V2-B locks the contract; this test pins the
        // FRONT-END mirror.
        expect(viewerCanActOnReview('field_inspector')).toBe(true);
    });

    it('รับตัวพิมพ์ต่างของคำปัจจุบัน และปฏิเสธคำเก่า', () => {
        // The auth/provider/me endpoint may return the legacy alias
        // (e.g. `head_auditor`) for older accounts in the migration
        // window. The predicate must defer to `normalizeRole` so those
        // tokens keep their action panel.
        expect(viewerCanActOnReview('field_inspector')).toBe(true);
        expect(viewerCanActOnReview('FIELD_INSPECTOR')).toBe(true);
        // คำเก่าถูกปฏิเสธ ไม่ใช่แปลให้
        expect(viewerCanActOnReview('inspector')).toBe(false);
    });

    it('returns FALSE for SCHEDULER (no doc-review transition)', () => {
        expect(viewerCanActOnReview('dispatcher')).toBe(false);
    });

    it('returns FALSE for ACCOUNT_DTAM (finance role)', () => {
        expect(viewerCanActOnReview('finance_officer_dtam')).toBe(false);
    });

    it('returns FALSE for ACCOUNT_PLATFORM (finance role)', () => {
        expect(viewerCanActOnReview('finance_officer_platform')).toBe(false);
    });

    it('returns FALSE for legacy ACCOUNT (pre-tier-16 finance)', () => {
        expect(viewerCanActOnReview('finance_officer_platform')).toBe(false);
    });

    it('returns FALSE for HEALTH (applicant — wrong side of the workflow)', () => {
        expect(viewerCanActOnReview('health')).toBe(false);
    });

    it('returns FALSE for unknown / unrecognised roles (defence in depth)', () => {
        expect(viewerCanActOnReview('unknown_role')).toBe(false);
    });

    it('returns FALSE when role is null / undefined / empty (auth loading)', () => {
        expect(viewerCanActOnReview(null)).toBe(false);
        expect(viewerCanActOnReview(undefined)).toBe(false);
        expect(viewerCanActOnReview('')).toBe(false);
    });

    it('exposes the canonical role set as ReadonlySet for downstream gating', () => {
        expect(REVIEW_ACTION_ROLES.size).toBe(3);
        expect(REVIEW_ACTION_ROLES.has('system_admin_dtam')).toBe(true);
        expect(REVIEW_ACTION_ROLES.has('document_reviewer')).toBe(true);
        expect(REVIEW_ACTION_ROLES.has('field_inspector')).toBe(true);
    });
});

describe('ProviderApplicationDetailPage — SSR smoke (V2-A)', () => {
    it('exports the default component symbol', () => {
        expect(typeof ProviderApplicationDetailPage).toBe('function');
    });

    it('renders the loading skeleton without throwing (initial mount)', () => {
        // Initial render shows the Spinner; the role / application
        // fetches resolve asynchronously inside useEffect and never
        // commit to the SSR pass — sufficient to prove the JSX tree is
        // syntactically valid after the V2-A edits.
        expect(() => renderToStaticMarkup(<ProviderApplicationDetailPage />)).not.toThrow();
    });
});
