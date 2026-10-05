/**
 * F-G4-11 — the wizard cannot be skipped by editing the URL.
 *
 * Ledger, operator's words: "ระบบต้องไม่สามารถกดข้ามหน้าผ่าน url ได้ เช่น step3
 * แต่เกษตกรไปแก้บน url เป็น step4 แล้วมันไปหน้า 4 จริง แบบนี้ไม่ได้"
 *
 * Measured before the fix, by mounting this component at each step number:
 *
 *   store state              /step/2..9        /step/10, /step/12
 *   ─────────────────────────────────────────────────────────────
 *   empty                    step RENDERS,     step RENDERS,
 *                            replace→/step/1   replace→/step/1
 *   steps 1+2 done           step RENDERS,     step RENDERS,
 *                            NO replace        NO replace
 *
 * Two separate defects. The bounce that did fire fired AFTER the step had
 * already rendered and said nothing about why. And with any populated store it
 * did not fire at all: the guard waited on `hydrationAttempted.current`, a ref
 * that only the empty-store branch of the resume-draft effect ever set, so it
 * switched itself off for everyone past step 2 — which is every farmer who
 * would think to edit the URL.
 *
 * Each test below fails on that code.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no IndexedDB; the real adapter throws on every call. The persisted
// store must still reach a settled verdict through that (a private window does
// exactly this), which is what `useWizardPersistSettled` exists for.
jest.mock('@/lib/indexeddb-storage', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}));

const mockApiGet = jest.fn<(url: string, opts?: unknown) => Promise<unknown>>();
jest.mock('@/lib/api/api-client', () => ({
    api: { get: (url: string, opts?: unknown) => mockApiGet(url, opts) },
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
let currentStepId = '1';
jest.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    useParams: () => ({ id: currentStepId }),
    notFound: jest.fn(),
}));

const emptyState: Record<string, unknown> = {
    currentStep: 0,
    plantId: null,
    serviceType: null,
    serviceTypes: [],
    certificationPurposes: [],
    siteTypes: [],
    licensePdfUrl: null,
    consentedPDPA: false,
    acknowledgedStandards: false,
    applicantData: null,
    siteData: null,
    productionData: null,
    harvestData: null,
    securityData: null,
    documents: [],
    youtubeUrl: '',
    locationType: null,
    generalInfo: null,
    syncStatus: 'SYNCED',
    resumePending: false,
    requestType: null,
    certScope: null,
    applicantType: null,
    previousCertificateNumber: null,
    cultivationMethods: [],
    cultivationDetails: null,
    stepDocuments: [],
    plantTracking: [],
    qrCount: 0,
    estimatedQRCost: 0,
    farmData: null,
    plots: [],
    lots: [],
};

/** v2 steps 1 and 2 done (request type, then identity), nothing after. */
const throughStepTwo = {
    ...emptyState,
    requestType: 'NEW',
    plantId: 'cannabis',
    applicantType: 'INDIVIDUAL',
    certScope: 'PLANTING',
    applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1234567890123', address: '99 หมู่ 3', phone: '0812345678' },
};

const completeState = {
    ...throughStepTwo,
    farmData: {
        // 2026-09-06: ขั้น 3 เขียน siteName/siteAddress และไม่เคยสร้างแถว plots
        // fixture เดิมสร้างจากฟิลด์ที่ประตูอ่านผิด จึงเขียวอยู่ได้ทั้งที่ขั้นนั้นทำให้ครบไม่ได้จริง
        siteName: 'ไร่ใจดี', siteAddress: '99 หมู่ 3', landOwnership: 'OWNED',
        // จังหวัด/อำเภอ/ตำบล — required by step 3 since 43dd39c6 (the certificate
        // names them). Without them step 3 is incomplete and the guard sends the
        // "complete wizard" fixture back to step 3, which is not what it is testing.
        subDistrict: 'หนองหาร', district: 'สันทราย', province: 'เชียงใหม่',
        landDocumentDetail: { type: 'โฉนด', number: '12345' },
        areaTypes: ['OUTDOOR'], areaSqm: '1600',
      },
    plots: [{ id: 'p1', name: 'แปลง 1' }],
    plantId: 'cannabis',
    certificationPurposes: ['EXPORT'],
    cultivationMethods: ['OUTDOOR'],
    productionData: { propagationType: ['SEED'], plantParts: ['LEAF'] },
    harvestData: { harvestMethod: 'MANUAL' },
    documents: [{ id: 'd1', uploaded: true }],
};

// Referentially stable, per the note in the sibling single-indicator test: a
// fresh object per render re-fires every consuming effect and loops.
const mockStoreState: Record<string, unknown> = { ...emptyState };
const mockStoreValue = {
    state: mockStoreState,
    setCurrentStep: jest.fn(),
    // The real store applies the patch. A no-op mock here would make the
    // resume case below pass for the wrong reason (an empty store bounces).
    updateState: jest.fn((patch: Record<string, unknown>) => { Object.assign(mockStoreState, patch); }),
    // O1 (2026-09-30): the resume path loads through hydrateDraft — same write,
    // marked as a load so the autosave does not post it back.
    hydrateDraft: jest.fn((patch: Record<string, unknown>) => { Object.assign(mockStoreState, patch); }),
    // Round 2: the resume fetch tells the autosave to hold while it is in flight.
    setResumePending: jest.fn((pending: boolean) => { Object.assign(mockStoreState, { resumePending: pending }); }),
    consentPDPA: jest.fn(),
    acknowledgeStandards: jest.fn(),
    setPlant: jest.fn(),
    setServiceType: jest.fn(),
    setServiceTypes: jest.fn(),
    setCertificationPurposes: jest.fn(),
    setSiteTypes: jest.fn(),
    setLicensePdfUrl: jest.fn(),
    setApplicantData: jest.fn(),
    setFarmData: jest.fn(),
    setPlots: jest.fn(),
    setLots: jest.fn(),
    addPlot: jest.fn(),
    removePlot: jest.fn(),
    addLot: jest.fn(),
    removeLot: jest.fn(),
    setProductionData: jest.fn(),
    setHarvestData: jest.fn(),
    setDocuments: jest.fn(),
    setCultivationMethods: jest.fn(),
    setLocationType: jest.fn(),
    setGeneralInfo: jest.fn(),
    setSecurityData: jest.fn(),
    setSiteData: jest.fn(),
    setYoutubeUrl: jest.fn(),
    setApplicationId: jest.fn(),
    setSyncStatus: jest.fn(),
    resetWizard: jest.fn(),
    canProceedFromStep: jest.fn(),
    getCompletedSteps: jest.fn(() => []),
};
jest.mock('@/app/health/applications/hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => mockStoreValue,
}));

import ApplicationStepPage from '../application-step-page';

const STEP_TITLES: Record<string, string> = {
    '1': 'ประเภทคำขอและผู้ยื่น',
    '2': 'ตัวตนผู้ยื่นคำขอ',
    '3': 'สถานที่ปลูกและสิทธิในที่ดิน',
    '4': 'ชนิดพืช สายพันธุ์ และวัตถุประสงค์',
    '5': 'แผนการผลิตและเอกสารประกอบ',
    '6': 'ตรวจทานและส่งคำขอ',
    '10': 'ใบเสนอราคาและใบแจ้งหนี้',
};

describe('[F-G4-11] wizard step page — a step whose prerequisites are unmet does not render', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.assign(mockStoreState, emptyState);
        window.sessionStorage.clear();
        mockApiGet.mockReset();
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/applications/draft')) return Promise.resolve({ success: true, data: null });
            if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
            return Promise.resolve({ success: false, error: 'unexpected url in test' });
        });
    });

    afterEach(() => {
        unmount();
    });

    function mount(stepId: string, state: Record<string, unknown>) {
        currentStepId = stepId;
        Object.assign(mockStoreState, state);
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<ApplicationStepPage />);
        });
    }

    function unmount() {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    }

    async function flush() {
        for (let round = 0; round < 4; round++) {
            await act(async () => {
                for (let i = 0; i < 15; i++) await Promise.resolve();
            });
        }
    }

    function text() {
        return container!.textContent || '';
    }

    function replacedWith() {
        return mockRouter.replace.mock.calls.map((call) => String(call[0]));
    }

    it('refuses /step/6 for a wizard that only finished steps 1 and 2 — the reported defect', async () => {
        mount('6', throughStepTwo);
        await flush();

        // Before the fix: the review screen rendered and nothing was replaced.
        expect(text()).not.toContain(STEP_TITLES['6']);
        expect(replacedWith()).toEqual(['/health/applications/new/step/3']);
    }, 20000);

    it('refuses every forward step for an empty wizard, and does not paint the form first', async () => {
        for (const step of ['2', '3', '4', '5', '6']) {
            mount(step, emptyState);
            await flush();
            expect(text()).not.toContain(STEP_TITLES[step]);
            expect(replacedWith()).toEqual(['/health/applications/new/step/1']);
            unmount();
            jest.clearAllMocks();
        }
    }, 40000);

    it('tells the farmer why, in Thai, on the step they were sent to', async () => {
        mount('6', throughStepTwo);
        await flush();
        unmount();

        // The bounce lands: same component, the step the guard chose.
        jest.clearAllMocks();
        mount('3', throughStepTwo);
        await flush();

        const body = text();
        expect(body).toContain(STEP_TITLES['3']);
        // Names the step that was refused and the step that is blocking.
        expect(body).toContain('ยังไปที่ขั้นตอนที่ 6 ไม่ได้');
        expect(body).toContain('ขั้นตอนที่ 3');
        expect(body).toContain('คุณ');
        expect(replacedWith()).toEqual([]);
    }, 20000);

    it('does not repeat the notice on a later visit to the same step', async () => {
        mount('6', throughStepTwo);
        await flush();
        unmount();

        jest.clearAllMocks();
        mount('3', throughStepTwo);
        await flush();
        expect(text()).toContain('ยังไปที่ขั้นตอนที่ 6 ไม่ได้');
        unmount();

        jest.clearAllMocks();
        mount('3', throughStepTwo);
        await flush();
        expect(text()).not.toContain('ยังไปที่ขั้นตอนที่ 6 ไม่ได้');
    }, 20000);
});

describe('[F-G4-11] wizard step page — the legitimate cases still work', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.assign(mockStoreState, emptyState);
        window.sessionStorage.clear();
        mockApiGet.mockReset();
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/applications/draft')) return Promise.resolve({ success: true, data: null });
            if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
            return Promise.resolve({ success: false, error: 'unexpected url in test' });
        });
    });

    function unmount() {
        if (root) { act(() => { root?.unmount(); }); root = null; }
        if (container) { container.remove(); container = null; }
    }

    afterEach(() => {
        unmount();
    });

    function mount(stepId: string, state: Record<string, unknown>) {
        currentStepId = stepId;
        Object.assign(mockStoreState, state);
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<ApplicationStepPage />);
        });
    }

    async function flush() {
        for (let round = 0; round < 4; round++) {
            await act(async () => {
                for (let i = 0; i < 15; i++) await Promise.resolve();
            });
        }
    }

    it('renders step 1 for a brand-new applicant', async () => {
        mount('1', emptyState);
        await flush();
        expect(container!.textContent).toContain(STEP_TITLES['1']);
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }, 20000);

    it('renders the step the farmer is actually on', async () => {
        mount('3', throughStepTwo);
        await flush();
        expect(container!.textContent).toContain(STEP_TITLES['3']);
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }, 20000);

    it('lets a farmer go BACK to a completed step', async () => {
        mount('2', completeState);
        await flush();
        expect(container!.textContent).toContain(STEP_TITLES['2']);
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }, 20000);

    it('lets a complete wizard reach the payment step', async () => {
        // A farmer who has filed and is going to pay must not be bounced back
        // to review; the payment screens answer to the server's status, not to
        // the wizard's completeness rules.
        mount('10', completeState);
        await flush();
        expect(container!.textContent).toContain(STEP_TITLES['10']);
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }, 20000);

    it('lets an applicant correcting a draft jump straight to the flagged step', async () => {
        window.sessionStorage.setItem('gacp_edit_mode', JSON.stringify({
            isEditMode: true,
            applicationId: 'app-1',
            revisionComment: 'แก้เอกสาร',
            applicationNumber: 'APP-2569-000001',
        }));

        mount('5', throughStepTwo);
        await flush();
        expect(container!.textContent).toContain(STEP_TITLES['5']);
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }, 20000);

    it('resumes a server-side draft at the step it earned instead of bouncing to step 1', async () => {
        // Fresh browser, empty local store, draft on the server. The guard must
        // wait for that answer; judging the empty store first is how a resume
        // gets thrown back to the beginning.
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/applications/draft')) {
                return Promise.resolve({
                    success: true,
                    data: {
                        draftId: 'draft-1',
                        // Enough to EARN step 4 — steps 1, 2 and 3 answered. A draft
                        // that has not earned the step it asks for is bounced, and
                        // rightly so; this case is about the resume itself surviving.
                        formData: {
                            plantId: 'cannabis',
                            requestType: 'NEW',
                            plantId: 'cannabis',
                            applicantType: 'INDIVIDUAL',
                            certScope: 'PLANTING',
                            applicantData: {
                                applicantType: 'INDIVIDUAL',
                                firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1234567890123',
                                address: '99 หมู่ 3', phone: '0812345678',
                            },
                            farmData: {
        // 2026-09-06: ขั้น 3 เขียน siteName/siteAddress และไม่เคยสร้างแถว plots
        // fixture เดิมสร้างจากฟิลด์ที่ประตูอ่านผิด จึงเขียวอยู่ได้ทั้งที่ขั้นนั้นทำให้ครบไม่ได้จริง
        siteName: 'ไร่ใจดี', siteAddress: '99 หมู่ 3', landOwnership: 'OWNED',
        // จังหวัด/อำเภอ/ตำบล — required by step 3 since 43dd39c6 (the certificate
        // names them). Without them step 3 is incomplete and the guard sends the
        // "complete wizard" fixture back to step 3, which is not what it is testing.
        subDistrict: 'หนองหาร', district: 'สันทราย', province: 'เชียงใหม่',
        landDocumentDetail: { type: 'โฉนด', number: '12345' },
        areaTypes: ['OUTDOOR'], areaSqm: '1600',
      },
                            plots: [{ id: 'p1', name: 'แปลง 1' }],
                            certificationPurposes: ['EXPORT'],
                            cultivationMethods: ['OUTDOOR'],
                        },
                    },
                });
            }
            if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
            return Promise.resolve({ success: false, error: 'unexpected url in test' });
        });

        mount('4', emptyState);
        await flush();

        // The draft was pulled and loaded into the store (as a load — O1)…
        expect(mockStoreValue.hydrateDraft).toHaveBeenCalled();
        // …and the farmer was not sent back to step 1 while it was in flight.
        expect(mockRouter.replace).not.toHaveBeenCalled();
    }, 20000);
    /**
     * I-1 (fix round 1, 2026-10-02): the server-draft fetch runs while step 1 is already on
     * screen. An answer given while it is in flight used to be overwritten by the draft AND
     * baselined as "loaded", so it was never sent. It must survive the load and arrive
     * marked unsent (syncStatus PENDING) so the autosave posts it.
     */
    it('an answer given while the server draft is loading survives the load and is marked unsent', async () => {
        let resolveDraft: (value: unknown) => void = () => {};
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/applications/draft')) return new Promise((resolve) => { resolveDraft = resolve; });
            if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
            return Promise.resolve({ success: false, error: 'unexpected url in test' });
        });

        mount('1', emptyState);
        await flush();
        expect(mockStoreValue.hydrateDraft).not.toHaveBeenCalled();

        // The applicant answers step 1 while GET /applications/draft is in flight.
        Object.assign(mockStoreState, { requestType: 'RENEWAL', syncStatus: 'PENDING' });
        act(() => { root?.render(<ApplicationStepPage />); });

        resolveDraft({
            success: true,
            data: {
                id: 'draft-1',
                formData: { plantId: 'cannabis', requestType: 'NEW', applicantType: 'INDIVIDUAL', certScope: 'PLANTING' },
            },
        });
        await flush();

        const calls = (mockStoreValue.hydrateDraft as jest.Mock).mock.calls;
        expect(calls.length).toBe(1);
        const loaded = calls[0]![0] as Record<string, unknown>;
        expect(loaded.requestType).toBe('RENEWAL');      // the applicant's answer, not the server's
        expect(loaded.applicantType).toBe('INDIVIDUAL'); // the rest of the draft still loads
        expect(loaded.syncStatus).toBe('PENDING');       // and the autosave knows it is unsent
    }, 20000);

    it('a draft loaded with nobody touching the form is marked saved (SYNCED)', async () => {
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/applications/draft')) {
                return Promise.resolve({ success: true, data: { id: 'draft-1', formData: { plantId: 'cannabis', requestType: 'NEW' } } });
            }
            if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
            return Promise.resolve({ success: false, error: 'unexpected url in test' });
        });

        mount('1', emptyState);
        await flush();

        const loaded = (mockStoreValue.hydrateDraft as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
        expect(loaded.requestType).toBe('NEW');
        expect(loaded.syncStatus).toBe('SYNCED');
    }, 20000);

    /**
     * Round 2 I-1: the autosave must hold while GET /applications/draft is in flight, or a
     * near-empty store is POSTed over the real draft. The page raises resumePending before
     * the fetch and lowers it however the fetch ends.
     */
    describe('round 2: the resume fetch holds the autosave until it settles', () => {
        function respondDraftWith(answer: () => Promise<unknown>) {
            mockApiGet.mockImplementation((url: string) => {
                if (url.includes('/applications/draft')) return answer();
                if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
                return Promise.resolve({ success: false, error: 'unexpected url in test' });
            });
        }

        it('raises the hold before the fetch, and the loaded draft lowers it', async () => {
            let resolveDraft: (value: unknown) => void = () => {};
            respondDraftWith(() => new Promise((resolve) => { resolveDraft = resolve; }));
            mount('1', emptyState);
            await flush();
            expect(mockStoreValue.setResumePending).toHaveBeenCalledWith(true);
            expect(mockStoreState.resumePending).toBe(true);

            resolveDraft({ success: true, data: { id: 'draft-1', formData: { plantId: 'cannabis', requestType: 'NEW' } } });
            await flush();
            const loaded = (mockStoreValue.hydrateDraft as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
            expect(loaded.resumePending).toBe(false);
            expect(mockStoreState.resumePending).toBe(false);
        }, 20000);

        it.each([
            ['no draft (200 data:null)', () => Promise.resolve({ success: true, data: null })],
            ['404', () => Promise.resolve({ success: false, status: 404, error: 'NOT_FOUND' })],
        ])('lowers the hold when the server says there is no draft: %s', async (_label, answer) => {
            respondDraftWith(answer as () => Promise<unknown>);
            mount('1', emptyState);
            await flush();
            expect(mockStoreValue.setResumePending).toHaveBeenCalledWith(true);
            expect(mockStoreState.resumePending).toBe(false);
        }, 20000);

        // A 503 or a dropped request does NOT say "no draft" — the draft may be there. Saving
        // now would POST the near-empty store over it, which is the defect itself. The page
        // shows the retry card; the hold stays until a retry settles. The held edit is marked
        // PENDING, so it is sent once the draft has loaded (or a reload starts fresh).
        it.each([
            ['503', () => Promise.resolve({ success: false, status: 503, error: 'UNAVAILABLE' })],
            ['a rejected request', () => Promise.reject(new Error('network'))],
        ])('keeps the hold when the fetch cannot answer: %s', async (_label, answer) => {
            respondDraftWith(answer as () => Promise<unknown>);
            mount('1', emptyState);
            await flush();
            expect(mockStoreValue.setResumePending).toHaveBeenCalledWith(true);
            expect(mockStoreValue.setResumePending).not.toHaveBeenCalledWith(false);
            expect(mockStoreState.resumePending).toBe(true);
        }, 20000);
    });

    /**
     * Round 3: a hold raised by a fetch that never answered must not outlive that fetch's
     * page, and a late answer from an old fetch must not touch a newer one's hold.
     */
    describe('round 3: the resume hold cannot get stuck', () => {
        function respondDraftWith(answer: () => Promise<unknown>) {
            mockApiGet.mockImplementation((url: string) => {
                if (url.includes('/applications/draft')) return answer();
                if (url.includes('/api/applications/config')) return Promise.resolve({ success: true, data: {} });
                return Promise.resolve({ success: false, error: 'unexpected url in test' });
            });
        }

        it('503, then the applicant navigates away: leaving lowers the hold', async () => {
            respondDraftWith(() => Promise.resolve({ success: false, status: 503, error: 'UNAVAILABLE' }));
            mount('1', emptyState);
            await flush();
            expect(mockStoreState.resumePending).toBe(true);

            unmount();
            expect(mockStoreState.resumePending).toBe(false);
        }, 20000);

        it('a populated store (e.g. the edit page just loaded a draft) lowers a stale hold', async () => {
            mount('1', { ...throughStepTwo, resumePending: true });
            await flush();
            expect(mockStoreState.resumePending).toBe(false);
        }, 20000);

        /**
         * Round 4 I-2: StrictMode (dev) runs the unmount cleanup right after mount. The
         * cleanup cancelled the attempt, the re-mount found hydrationAttempted already true
         * and started no new fetch, and the first answer was ignored as stale — the
         * spinner ran forever.
         */
        it('under React.StrictMode the draft still loads exactly once and the hold settles', async () => {
            respondDraftWith(() => Promise.resolve({
                success: true,
                data: { id: 'draft-strict', formData: { plantId: 'cannabis', requestType: 'NEW' } },
            }));
            currentStepId = '1';
            Object.assign(mockStoreState, emptyState);
            container = document.createElement('div');
            document.body.appendChild(container);
            act(() => {
                root = createRoot(container!);
                root.render(<React.StrictMode><ApplicationStepPage /></React.StrictMode>);
            });
            await flush();

            expect(mockStoreValue.hydrateDraft).toHaveBeenCalledTimes(1);
            const loaded = (mockStoreValue.hydrateDraft as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
            expect(loaded.requestType).toBe('NEW');
            expect(mockStoreState.resumePending).toBe(false);
        }, 20000);

        it('a late answer from an old fetch is ignored: it neither loads nor lowers the newer hold', async () => {
            const resolvers: Array<(value: unknown) => void> = [];
            respondDraftWith(() => new Promise((resolve) => { resolvers.push(resolve); }));

            mount('1', emptyState);
            await flush();
            unmount();
            mount('1', emptyState);
            await flush();
            expect(resolvers.length).toBe(2);
            expect(mockStoreState.resumePending).toBe(true);

            resolvers[0]!({ success: true, data: { id: 'old', formData: { plantId: 'cannabis', requestType: 'RENEWAL' } } });
            await flush();
            expect(mockStoreValue.hydrateDraft).not.toHaveBeenCalled();
            expect(mockStoreState.resumePending).toBe(true);

            resolvers[1]!({ success: true, data: { id: 'new', formData: { plantId: 'cannabis', requestType: 'NEW' } } });
            await flush();
            expect(mockStoreValue.hydrateDraft).toHaveBeenCalledTimes(1);
            const loaded = (mockStoreValue.hydrateDraft as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
            expect(loaded.requestType).toBe('NEW');
            expect(mockStoreState.resumePending).toBe(false);
        }, 20000);
    });
});

