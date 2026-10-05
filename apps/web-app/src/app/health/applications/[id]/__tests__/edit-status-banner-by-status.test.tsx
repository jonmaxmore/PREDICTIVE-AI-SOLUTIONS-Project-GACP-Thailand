/**
 * edit-status-banner-by-status.test.tsx — P4 (staging walk 2026-09-29,
 * ~/work/state/staging-walk-2026-09-29/INDEX.md, defect P4 / the backlog).
 *
 * The edit landing page (/health/applications/[id]/edit) printed the badge
 * "ต้องแก้ไขเอกสาร" — a revision-requested message — for EVERY editable
 * status, including a never-submitted DRAFT (screens/21-draft-resume-landing.png:
 * a fresh draft nobody has reviewed yet showed "สถานะปัจจุบัน: ต้องแก้ไขเอกสาร").
 *
 * Fix under test: that badge is shown only for the statuses that really mean
 * "an officer asked for changes" (REVISION_REQUESTED, CAR_PENDING). A DRAFT
 * gets a neutral "ร่างคำขอ ยังไม่ได้ยื่น" line instead (thai-ui-copy: no em
 * dash in Thai copy).
 *
 * Same defect class, same page, found while fixing the badge (the backlog,
 * "Found while fixing P4"): the "ขั้นตอนการแก้ไข" instructions card right below
 * this badge also told every editable status — DRAFT included — to "read the
 * officer's note above" and "resubmit". That list is now shown only for the
 * same officer-requested-changes statuses; DRAFT gets one neutral line
 * (`getNextAction('DRAFT')`, the same canonical DRAFT copy status-mapping.ts
 * already uses elsewhere).
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

function draftFor(status: string) {
    return {
        id: 'app-1',
        applicationNumber: 'APP-2569-MUJZVOTO-80E5FE',
        status,
        formData: { plantId: 'cannabis', serviceType: 'NEW' },
    };
}

describe('EditApplicationPage — the ต้องแก้ไขเอกสาร banner only names an officer request (P4)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApiGet.mockReset();
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

    it('REVISION_REQUESTED keeps the ต้องแก้ไขเอกสาร badge and the ขั้นตอนการแก้ไข instructions', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: draftFor('REVISION_REQUESTED') });
        mount();
        await flush();
        expect(container!.textContent).toContain('ต้องแก้ไขเอกสาร');
        expect(container!.textContent).toContain('ขั้นตอนการแก้ไข');
        expect(container!.textContent).toContain('อ่านหมายเหตุจากเจ้าหน้าที่ด้านบน');
    });

    it('CAR_PENDING (an officer-raised corrective action) also keeps the badge and instructions', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: draftFor('CAR_PENDING') });
        mount();
        await flush();
        expect(container!.textContent).toContain('ต้องแก้ไขเอกสาร');
        expect(container!.textContent).toContain('ขั้นตอนการแก้ไข');
        expect(container!.textContent).toContain('อ่านหมายเหตุจากเจ้าหน้าที่ด้านบน');
    });

    it('a never-submitted DRAFT does NOT claim an officer asked for changes', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: draftFor('DRAFT') });
        mount();
        await flush();

        expect(container!.textContent).not.toContain('ต้องแก้ไขเอกสาร');
        // Neutral status line, thai-ui-copy: no em dash.
        expect(container!.textContent).toContain('ร่างคำขอ');
        expect(container!.textContent).not.toContain('—');
    });

    it('a never-submitted DRAFT does NOT tell the applicant to read an officer note or resubmit', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: draftFor('DRAFT') });
        mount();
        await flush();

        expect(container!.textContent).not.toContain('ขั้นตอนการแก้ไข');
        expect(container!.textContent).not.toContain('อ่านหมายเหตุจากเจ้าหน้าที่ด้านบน');
        expect(container!.textContent).not.toContain('กดส่งใหม่');
        // One neutral line instead — the same canonical DRAFT copy
        // status-mapping.ts already uses elsewhere (getNextAction('DRAFT')).
        expect(container!.textContent).toContain('กรอกข้อมูลให้ครบแล้วส่งคำขอ');
    });
});
