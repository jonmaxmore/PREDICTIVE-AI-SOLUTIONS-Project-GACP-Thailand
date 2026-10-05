/**
 * X2-FIX-C / H-11 (P-NEW-1) — /provider/work/[id] next-state native
 * <select> accessible-label regression guard.
 *
 * Pre-X2 the raw <select> at client-view.tsx:452 had no <label>
 * association — keyboard worked natively but screen-reader users had
 * no programmatic name for the field (WCAG 1.3.1 + 3.3.2). X2-FIX-C
 * adds a useId-keyed <label htmlFor={id} className="sr-only"> +
 * matching id on the <select>, plus a data-testid="next-state-select"
 * for the test hook below.
 *
 * The test mounts the page with the canClaim / canDone / nextStates
 * branches all true so the conditional "ปิดงาน + เลื่อนสถานะคำขอ"
 * section renders, then asserts:
 *   1. The select carries data-testid="next-state-select" and has an id.
 *   2. There exists a <label htmlFor={selectId}> with the Thai text
 *      "เลือกสถานะถัดไปของคำขอ" (sr-only is fine — visible label is
 *      not required for AT).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the api client so the page resolves into the "loaded" branch
// with TODO state + at least one next-state option, which is the only
// branch where the select actually renders.
const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
const mockApiPost = jest.fn<(url: string, body?: unknown) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockApiGet(url),
        post: (url: string, body?: unknown) => mockApiPost(url, body),
    },
    api: {
        get: (url: string) => mockApiGet(url),
        post: (url: string, body?: unknown) => mockApiPost(url, body),
    },
}));

// Stable next/navigation router per I-016.
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/work/test-id',
        useSearchParams: () => new URLSearchParams(),
    };
});

// Mock ProviderLayout to a passthrough so we don't drag in the
// auth/role plumbing.
jest.mock('../../../components/provider-layout', () => {
    const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    Passthrough.displayName = 'MockProviderLayout';
    return { __esModule: true, default: Passthrough };
});

// Mock notifications (sonner-backed wrapper) — pulled in by the page;
// jsdom doesn't need real toasts.
jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

// The view now reads useAuth() to gate the app-number link (link-bounce fix).
// Stub it so the component renders outside an AuthProvider in this unit test.
jest.mock('@/lib/services/auth-provider', () => ({
    useAuth: () => ({ user: { role: 'field_inspector' } }),
}));

import WorkActivityDetailView from '../client-view';

describe('[X2-FIX-C / H-11] /provider/work/[id] — next-state select has accessible label', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function flushMicrotasks(rounds = 15) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    it('renders the native <select> with a wired-up sr-only <label>', async () => {
        // The page issues two GETs in parallel (workDetail + workNextStates).
        // Both must succeed for the select branch to render.
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/next-states')) {
                return Promise.resolve({
                    success: true,
                    data: {
                        currentStatus: 'ASSIGNED_FOR_REVIEW',
                        options: [
                            { toState: 'DOC_APPROVED', requiresComment: false },
                            { toState: 'REVISION_REQUESTED', requiresComment: true },
                        ],
                    },
                });
            }
            // workDetail — TODO state so `canDone` is true, which is
            // the gating predicate around the "ปิดงาน + เลื่อนสถานะ"
            // section that contains the select.
            return Promise.resolve({
                success: true,
                data: {
                    id: 'act-1',
                    applicationId: 'app-1',
                    applicationNumber: 'GACP-2026-0001',
                    applicationStatus: 'ASSIGNED_FOR_REVIEW',
                    applicantName: 'Test Farmer',
                    applicantEmail: 'farmer@test',
                    workType: 'DOC_REVIEW',
                    candidateGroup: 'REVIEWER',
                    state: 'TODO',
                    assignedUserId: null,
                    assignedUserName: null,
                    completedByName: null,
                    triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
                    dueAt: null,
                    warningAt: null,
                    claimedAt: null,
                    startedAt: null,
                    completedAt: null,
                    cancelledAt: null,
                    cancelReason: null,
                    note: null,
                    createdAt: '2026-05-01T00:00:00.000Z',
                    isOverdue: false,
                },
            });
        });

        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<WorkActivityDetailView activityId="act-1" />);
        });

        await flushMicrotasks();

        const select = container!.querySelector('[data-testid="next-state-select"]');
        expect(select).not.toBeNull();
        const selectId = select!.getAttribute('id');
        // useId emits a stable non-empty string starting with a colon.
        expect(typeof selectId).toBe('string');
        expect((selectId || '').length).toBeGreaterThan(0);

        // The page should render a <label htmlFor={selectId}> with the
        // Thai accessible name "เลือกสถานะถัดไปของคำขอ". The label
        // can be sr-only — what matters is the htmlFor wiring.
        const label = container!.querySelector(`label[for="${selectId}"]`);
        expect(label).not.toBeNull();
        expect(label!.textContent).toContain('เลือกสถานะถัดไปของคำขอ');
    });
});
