/**
 * Operator ruling 2026-10-05 — a stored purpose the register has no licence for
 * (MEDICAL, COMMERCIAL, anything else) is never mapped to another word and never
 * dropped without a word. The edit page used to filter unknown values out silently
 * (SUPPORTED_CERTIFICATION_PURPOSES); an applicant reopening an old draft saw an empty
 * choice with no explanation. Now the words it could not carry forward are recorded for
 * step 4, which tells the applicant to choose again.
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
    apiClient: { get: (url: string) => mockApiGet(url), post: jest.fn() },
}));

jest.mock('next/navigation', () => {
    const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
    return {
        useRouter: () => router,
        useParams: () => ({ id: 'app-1' }),
        usePathname: () => '/health/applications/app-1/edit',
    };
});

jest.mock('@/app/health/applications/hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => ({
        updateState: mockUpdateState,
        hydrateDraft: mockUpdateState,
        setApplicantData: jest.fn(), setSiteData: jest.fn(), setProductionData: jest.fn(),
        setHarvestData: jest.fn(), setSecurityData: jest.fn(), setFarmData: jest.fn(),
        setPlots: jest.fn(), setLots: jest.fn(), setDocuments: jest.fn(), setYoutubeUrl: jest.fn(),
        setGeneralInfo: jest.fn(), setLocationType: jest.fn(), setSiteTypes: jest.fn(),
        setLicensePdfUrl: jest.fn(), setApplicationId: jest.fn(), resetWizard: jest.fn(),
    }),
}));

import EditApplicationPage from '../edit/client-view';
import { STALE_PURPOSES_KEY } from '../../new/_steps/steps/step4-variety-purpose-config';

const draftWith = (certificationPurposes: string[]) => ({
    id: 'app-1',
    applicationNumber: 'APP-2569-000001',
    status: 'DRAFT',
    formData: { plantId: 'cannabis', serviceType: 'NEW', certificationPurposes },
});

describe('EditApplicationPage — a stored purpose the register no longer knows', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApiGet.mockReset();
        mockUpdateState.mockReset();
        window.sessionStorage.clear();
    });
    afterEach(() => {
        if (root) { act(() => { root?.unmount(); }); root = null; }
        if (container) { container.remove(); container = null; }
    });

    async function pressStart(data: unknown) {
        mockApiGet.mockResolvedValueOnce({ success: true, data });
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => { root = createRoot(container!); root.render(<EditApplicationPage />); });
        await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
        const start = Array.from(container.querySelectorAll('button'))
            .find((btn) => btn.textContent?.includes('เริ่มแก้ไขคำขอ'));
        expect(start).toBeTruthy();
        await act(async () => { start!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        const calls = mockUpdateState.mock.calls as Array<[Record<string, unknown>]>;
        return calls.reduce((acc, [update]) => ({ ...acc, ...update }), {} as Record<string, unknown>);
    }

    it('carries the valid words forward and records the unknown one for step 4', async () => {
        const merged = await pressStart(draftWith(['MEDICAL', 'EXPORT']));
        expect(merged.certificationPurposes).toEqual(['EXPORT']);
        expect(JSON.parse(window.sessionStorage.getItem(STALE_PURPOSES_KEY) || 'null')).toEqual(['MEDICAL']);
    });

    it('a draft holding only a retired word hydrates no purpose and records it', async () => {
        const merged = await pressStart(draftWith(['COMMERCIAL']));
        expect(merged.certificationPurposes).toEqual([]);
        expect(JSON.parse(window.sessionStorage.getItem(STALE_PURPOSES_KEY) || 'null')).toEqual(['COMMERCIAL']);
    });

    it('a clean draft leaves no stale record behind', async () => {
        window.sessionStorage.setItem(STALE_PURPOSES_KEY, JSON.stringify(['MEDICAL']));
        const merged = await pressStart(draftWith(['RESEARCH', 'PROCESSING']));
        expect(merged.certificationPurposes).toEqual(['RESEARCH', 'PROCESSING']);
        expect(window.sessionStorage.getItem(STALE_PURPOSES_KEY)).toBeNull();
    });
});
