/**
 * edit-hydrates-step1-answers.test.tsx — P3 (staging walk 2026-09-29,
 * ~/work/state/staging-walk-2026-09-29/INDEX.md, defect P3 / the backlog).
 *
 * Reopening a never-submitted draft through /health/applications/[id]/edit
 * showed step 1 (ประเภทคำขอและผู้ยื่น) with NEITHER the request type NOR the
 * applicant type selected, even though the draft's own formData carried them
 * (screens/22b-step1-state.png: "ขิง" plant card selected, but no ประเภทคำขอ
 * card and no ผู้ยื่นคำขอ card is). The applicant then had to re-pick both,
 * and autosave wrote the re-pick over the original draft.
 *
 * Root cause: `handleStartEdit()` in client-view.tsx hydrates plantId,
 * serviceType, applicantData, siteData, ... but never reads
 * `application.formData.requestType` / `.applicantType` / `.certScope` into
 * the flow store — step 1 renders its selection purely from
 * `state.requestType` / `state.applicantType` (step1-request-type.tsx), so
 * an unset store field renders as "nothing chosen" regardless of what the
 * server actually holds.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
const mockUpdateState = jest.fn();

jest.mock('@/lib/api', () => ({
    apiClient: {
        get: (url: string) => mockApiGet(url),
        post: jest.fn(),
    },
}));

jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        useParams: () => ({ id: 'app-1' }),
        usePathname: () => '/health/applications/app-1/edit',
    };
});

jest.mock('@/app/health/applications/hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => ({
        updateState: mockUpdateState,
        // O1 (2026-09-30): the edit page's last write is hydrateDraft (a load, not an
        // edit). Same patch shape, so the same recorder reads both.
        hydrateDraft: mockUpdateState,
        setApplicantData: jest.fn(),
        setSiteData: jest.fn(),
        setProductionData: jest.fn(),
        setHarvestData: jest.fn(),
        setSecurityData: jest.fn(),
        setFarmData: jest.fn(),
        setPlots: jest.fn(),
        setLots: jest.fn(),
        setDocuments: jest.fn(),
        setYoutubeUrl: jest.fn(),
        setGeneralInfo: jest.fn(),
        setLocationType: jest.fn(),
        setSiteTypes: jest.fn(),
        setLicensePdfUrl: jest.fn(),
        setApplicationId: jest.fn(),
        resetWizard: jest.fn(),
    }),
}));

import EditApplicationPage from '../edit/client-view';

const DRAFT_WITH_STEP1_ANSWERS = {
    id: 'app-1',
    applicationNumber: 'APP-2569-MUJZVOTO-80E5FE',
    status: 'DRAFT',
    formData: {
        plantId: 'cannabis',
        serviceType: 'NEW',
        requestType: 'NEW',
        applicantType: 'JURISTIC',
        certScope: 'PLANTING',
    },
};

describe('EditApplicationPage — hydrates step 1 (request type + applicant type) from the draft (P3)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApiGet.mockReset();
        mockUpdateState.mockReset();
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
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
            root.render(<EditApplicationPage />);
        });
    }

    async function flush() {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
    }

    it('pressing เริ่มแก้ไขคำขอ hydrates requestType + applicantType + certScope into the flow store', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: DRAFT_WITH_STEP1_ANSWERS });

        mount();
        await flush();

        const startButton = Array.from(container!.querySelectorAll('button'))
            .find((btn) => btn.textContent?.includes('เริ่มแก้ไขคำขอ'));
        expect(startButton).toBeTruthy();

        await act(async () => {
            startButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const calls = mockUpdateState.mock.calls as Array<[Record<string, unknown>]>;
        const merged = calls.reduce((acc, [update]) => ({ ...acc, ...update }), {} as Record<string, unknown>);

        expect(merged.requestType).toBe('NEW');
        expect(merged.applicantType).toBe('JURISTIC');
        expect(merged.certScope).toBe('PLANTING');
    });
});
