/**
 * F-PREVIEW-REVISION-CLOSED — the applicant's resubmit button
 * (Task 2, design notes).
 *
 * The button that sends a REVISION_REQUESTED / CAR_PENDING application back
 * to the reviewer lives ONLY on this preview page (footer button, label
 * swapped by status — client-view.tsx:425-450). It carries no status
 * allow-list of its own: it renders whenever `preview` is non-null, and
 * `preview` is set only after GET /preview/applications/:id/preview
 * succeeds. Before Task 2 that endpoint 400'd for
 * REVISION_REQUESTED/CAR_PENDING (previewable-statuses.js:19-25), so
 * `preview` stayed null, the page rendered the error card instead of the
 * footer, and the button never existed in the DOM to click.
 *
 * This proves the FE claim directly: given the (now-fixed) backend returns
 * success for a REVISION_REQUESTED/CAR_PENDING application, the resubmit
 * button renders with the correct Thai label and is enabled. It does not
 * re-test the backend gate itself — that is
 * apps/backend/__tests__/unit/preview-previewable-states.test.js — it tests
 * only that the FE has no separate gate that would still hide the button
 * after the backend allows the preview.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the api client BEFORE importing the page so the import sees our stub.
// client-view.tsx consumes `apiClient.get` for the preview lookup and
// `apiClient.post` for submit/payment (needed by the fix-round-2 tests
// below, which click the resubmit button and inspect handlePayment's error
// mapping).
const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
const mockApiPost = jest.fn<(url: string, body?: unknown) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => mockApiGet(url),
        post: (url: string, body?: unknown) => mockApiPost(url, body),
    },
}));

// Override the repo-default next/navigation mock (jest.setup.tsx) so
// useSearchParams().get('id') returns a real id — the default is an empty
// URLSearchParams, which would short-circuit the page to the "ไม่พบรหัสคำขอ"
// branch before apiClient.get is ever called.
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
        pathname: '/',
        query: {},
    };
    const searchParams = new URLSearchParams({ id: 'app-preview-1' });
    return {
        useRouter: () => router,
        usePathname: () => '/',
        useSearchParams: () => searchParams,
    };
});

import ApplicationPreviewPage from '../client-view';

function makePreviewData(status: string, opts: {
    isComplete?: boolean;
    missingFields?: string[];
    isPhasePaid?: boolean;
    phase1Status?: string;
} = {}) {
    const isComplete = opts.isComplete ?? true;
    const phase1Status = opts.phase1Status ?? 'PAID';
    const isPhasePaid = opts.isPhasePaid ?? true;
    return {
        applicationId: 'app-preview-1',
        status,
        nextRequiredAction: 'WAIT_DOC_REVIEW',
        farmInfo: {},
        productionInfo: {},
        documents: [],
        summary: {
            totalSteps: 7,
            completedSteps: isComplete ? 7 : 3,
            isComplete,
            missingFields: opts.missingFields ?? ([] as string[]),
        },
        payment: {
            phase1Amount: 5535,
            phase1Status,
            phase2Amount: 27675,
            scopeCount: 1,
            totalEstimated: 33210,
            breakdown: {
                phase1: {
                    stateAmount: 5000, platformAmount: 535, phaseTotal: 5535,
                    stateStatus: phase1Status, platformStatus: phase1Status, isPhasePaid,
                },
                phase2: {
                    stateAmount: 25000, platformAmount: 2675, phaseTotal: 27675,
                    stateStatus: 'PENDING', platformStatus: 'PENDING', isPhasePaid: false,
                },
                totals: { stateTotal: 30000, platformTotal: 3210, grandTotal: 33210 },
            },
        },
        financialDocuments: {},
    };
}

async function flushAsync(rounds = 8): Promise<void> {
    // Mirrors the payments-states.test.tsx pattern in this repo: React 18
    // concurrent scheduling needs several microtask flushes before the
    // fetch-then-setState effect settles.
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

describe('/health/applications/preview — resubmit button (F-PREVIEW-REVISION-CLOSED)', () => {
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

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root!.render(<ApplicationPreviewPage />);
        });
    }

    function findButton(label: string): HTMLButtonElement | null {
        return (
            Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
                (btn.textContent || '').includes(label),
            ) ?? null
        );
    }

    async function clickButton(label: string): Promise<void> {
        const btn = findButton(label);
        expect(btn).not.toBeNull();
        await act(async () => {
            btn!.click();
        });
        await flushAsync();
    }

    it('renders the resubmit button for a REVISION_REQUESTED application, once the backend allows the preview', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: { success: true, preview: makePreviewData('REVISION_REQUESTED') },
        });

        mount();
        await flushAsync();

        // The exact bug: previously the page never got past the error branch.
        expect(container!.textContent).not.toContain('Application is not in previewable state');
        expect(container!.textContent).not.toContain('ไม่พบข้อมูลพรีวิว');

        const resubmitBtn = Array.from(container!.querySelectorAll('button')).find((btn) =>
            (btn.textContent || '').includes('ส่งคำขอแก้ไข'),
        );
        expect(resubmitBtn).not.toBeUndefined();
        expect(resubmitBtn!.disabled).toBe(false);
    });

    it('renders the resubmit button for a CAR_PENDING application, once the backend allows the preview', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: { success: true, preview: makePreviewData('CAR_PENDING') },
        });

        mount();
        await flushAsync();

        const resubmitBtn = Array.from(container!.querySelectorAll('button')).find((btn) =>
            (btn.textContent || '').includes('ส่ง CAR'),
        );
        expect(resubmitBtn).not.toBeUndefined();
        expect(resubmitBtn!.disabled).toBe(false);
    });

    // Item 2, final-review round (2026-08-18): summary.isComplete
    // (summarizeCompletion) is a coarse heuristic that diverges from the REAL
    // gate /submit enforces (validateSubmissionPayload → 422 with precise Thai
    // errors). For resubmit states the heuristic can read false while /submit
    // would pass — the button must not re-close the door this page exists to
    // reopen; /submit's own 422 is the judge instead.
    it('does not disable the resubmit button on the completeness heuristic — /submit is the real judge (Item 2)', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: {
                success: true,
                preview: makePreviewData('REVISION_REQUESTED', { isComplete: false, missingFields: ['farmInfo'] }),
            },
        });

        mount();
        await flushAsync();

        const resubmitBtn = Array.from(container!.querySelectorAll('button')).find((btn) =>
            (btn.textContent || '').includes('ส่งคำขอแก้ไข'),
        );
        expect(resubmitBtn).not.toBeUndefined();
        expect(resubmitBtn!.disabled).toBe(false);
    });

    it('DRAFT still disables the submit button when summary.isComplete is false — the heuristic gate is unchanged for non-resubmit (Item 2)', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: {
                success: true,
                preview: makePreviewData('DRAFT', {
                    isComplete: false,
                    missingFields: ['farmInfo'],
                    isPhasePaid: false,
                    phase1Status: 'PENDING',
                }),
            },
        });

        mount();
        await flushAsync();

        const submitBtn = Array.from(container!.querySelectorAll('button')).find((btn) =>
            (btn.textContent || '').includes('ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่ 1'),
        );
        expect(submitBtn).not.toBeUndefined();
        expect(submitBtn!.disabled).toBe(true);
    });

    // Fix round 2 (Blocker 1 follow-up, 2026-08-18): api-client.ts's error
    // priority was reverted to db3e6480 (it broke use-auto-save.ts's
    // DRAFT_VERSION_CONFLICT detection), so /submit's 422
    // APPLICATION_INCOMPLETE surfaces its raw code verbatim in
    // `submitResponse.error` again. handlePayment now maps that ONE code
    // page-scoped instead — these two tests pin the mapping, not api-client.
    it('maps the raw APPLICATION_INCOMPLETE code to Thai copy when /submit 422s with no messageTh', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: { success: true, preview: makePreviewData('REVISION_REQUESTED') },
        });
        mockApiPost.mockResolvedValueOnce({
            success: false,
            error: 'APPLICATION_INCOMPLETE',
            code: 'APPLICATION_INCOMPLETE',
            status: 422,
            meta: { errorsByStep: { 5: ['farmData is required'] }, missingFields: ['farmData'] },
        });

        mount();
        await flushAsync();
        await clickButton('ส่งคำขอแก้ไข');

        expect(container!.textContent).not.toContain('APPLICATION_INCOMPLETE');
        expect(container!.textContent).toContain('กรุณากรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ');
    });

    it('prefers meta.messageTh over the fixed fallback when the backend sends one', async () => {
        mockApiGet.mockResolvedValueOnce({
            success: true,
            data: { success: true, preview: makePreviewData('REVISION_REQUESTED') },
        });
        mockApiPost.mockResolvedValueOnce({
            success: false,
            error: 'APPLICATION_INCOMPLETE',
            code: 'APPLICATION_INCOMPLETE',
            status: 422,
            meta: { messageTh: 'ข้อความทดสอบจากแบ็กเอนด์' },
        });

        mount();
        await flushAsync();
        await clickButton('ส่งคำขอแก้ไข');

        expect(container!.textContent).not.toContain('APPLICATION_INCOMPLETE');
        expect(container!.textContent).toContain('ข้อความทดสอบจากแบ็กเอนด์');
    });

    it('regression guard: while the backend still blocks the preview, the resubmit button does not render', async () => {
        // Pins the PRE-FIX shape so this file also documents what "closed"
        // looked like: apiClient surfaces a non-2xx as { success: false,
        // error }, and the page shows the error card, never the footer.
        mockApiGet.mockResolvedValueOnce({
            success: false,
            error: 'Application is not in previewable state',
        });

        mount();
        await flushAsync();

        const resubmitBtn = Array.from(container!.querySelectorAll('button')).find((btn) =>
            (btn.textContent || '').includes('ส่งคำขอแก้ไข'),
        );
        expect(resubmitBtn).toBeUndefined();
        expect(container!.textContent).toContain('Application is not in previewable state');
    });
});
