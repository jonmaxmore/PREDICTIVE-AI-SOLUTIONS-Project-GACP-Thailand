/**
 * edit-load-unavailable-retry.test.tsx — W1-RETRY acceptance test.
 *
 * Bug (live probe 2026-07-24, correct-key HEALTH session, backend down):
 * /health/applications/[id]/edit answered a 503 BACKEND_UNREACHABLE
 * envelope with the TERMINAL red alert 'ไม่พบคำขอที่ระบุ' ("application
 * not found") and only a back link — a definitive bad-state claim on a
 * fetch failure, with no retry.
 *
 * Fix under test: transport/5xx failures (status >= 500, statusless
 * network/timeout errors, thrown fetch) now render the amber
 * indeterminate ServiceUnavailable pattern (role="status") with a retry
 * action that re-fires the SAME fetch. Genuine terminal outcomes
 * (4xx not-found, non-editable status) keep the existing red alert.
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

// The wizard store is irrelevant here — stub every setter the page destructures.
jest.mock('@/app/health/applications/hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => ({
        updateState: jest.fn(),
        hydrateDraft: jest.fn(),
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

// Exact shape the real apiClient returns when the Next proxy answers
// 503 BACKEND_UNREACHABLE (backend down).
const UNREACHABLE_ENVELOPE = {
    success: false,
    error: 'ยังเชื่อมต่อระบบไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    status: 503,
    code: 'Backend service unavailable',
};

const EDITABLE_APP = {
    id: 'app-1',
    applicationNumber: 'APP-2569-0042',
    status: 'DRAFT',
    formData: {},
};

describe('EditApplicationPage — backend-unavailable load failure gets amber retry state (W1-RETRY)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks does NOT drop unconsumed mockResolvedValueOnce
        // queue entries — a failed earlier test would otherwise leak its
        // leftover envelope into the next test's mount. Full reset.
        mockApiGet.mockReset();
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
            root.render(<EditApplicationPage />);
        });
    }

    async function flush() {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
    }

    it('503 envelope → amber role="status" card with retry, NOT the terminal "ไม่พบคำขอที่ระบุ"', async () => {
        mockApiGet.mockResolvedValueOnce(UNREACHABLE_ENVELOPE);

        mount();
        await flush();

        const card = container!.querySelector('[data-testid="edit-load-unavailable"]');
        expect(card).not.toBeNull();
        expect(card!.getAttribute('role')).toBe('status');
        expect(container!.querySelector('[data-testid="edit-load-retry"]')).not.toBeNull();
        // Never claim a definitive bad state on a fetch failure.
        expect(container!.innerHTML).not.toContain('ไม่พบคำขอที่ระบุ');
    });

    it('retry re-fires the SAME fetch and recovers into the edit screen', async () => {
        mockApiGet
            .mockResolvedValueOnce(UNREACHABLE_ENVELOPE)
            .mockResolvedValueOnce({ success: true, data: EDITABLE_APP });

        mount();
        await flush();
        expect(mockApiGet).toHaveBeenCalledTimes(1);

        const retry = container!.querySelector<HTMLButtonElement>('[data-testid="edit-load-retry"]');
        expect(retry).not.toBeNull();
        await act(async () => {
            retry!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flush();

        expect(mockApiGet).toHaveBeenCalledTimes(2);
        expect(mockApiGet).toHaveBeenNthCalledWith(2, '/applications/app-1');
        // Recovered: normal edit screen renders.
        expect(container!.innerHTML).toContain('APP-2569-0042');
        expect(container!.innerHTML).toContain('เริ่มแก้ไขคำขอ');
        expect(container!.querySelector('[data-testid="edit-load-unavailable"]')).toBeNull();
    });

    it('thrown fetch (network failure) → amber retry state', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network down'));

        mount();
        await flush();

        expect(container!.querySelector('[data-testid="edit-load-unavailable"]')).not.toBeNull();
        expect(container!.querySelector('[data-testid="edit-load-retry"]')).not.toBeNull();
    });

    it('PIN: genuine 4xx not-found keeps the terminal red alert without a retry', async () => {
        mockApiGet.mockResolvedValueOnce({ success: false, error: 'Not found', status: 404 });

        mount();
        await flush();

        expect(container!.innerHTML).toContain('ไม่พบคำขอที่ระบุ');
        expect(container!.querySelector('[data-testid="edit-load-unavailable"]')).toBeNull();
        expect(container!.querySelector('[data-testid="edit-load-retry"]')).toBeNull();
    });
});
