/**
 * Round 5 (staging-walk-0930), Important: after one filing, the next new application
 * could not be saved or submitted.
 *
 * Round 4 made every save name its application. Nothing cleared the wizard after a
 * filing, so the store still held application X (now PENDING_DOC_FEE) and its answers,
 * in memory and in IndexedDB. "ยื่นคำขอใหม่" opened the wizard on X; every autosave sent
 * `applicationId: X` and got 409 APPLICATION_NOT_EDITABLE; the submit gate refused forever.
 *
 * Real store, real autosave hook, real submitAndHandOver. Only the network, IndexedDB and
 * the checkout flag are stand-ins.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

type Resp = { success: boolean; data?: unknown; error?: string; code?: string };
const mockPost = jest.fn<(url: string, body?: unknown) => Promise<Resp>>();
jest.mock('@/lib/api/api-client', () => {
    const client = {
        post: (u: string, b?: unknown) => mockPost(u, b),
        get: jest.fn(async () => ({ success: false })),
        delete: jest.fn(async () => ({ success: true })),
    };
    return { api: client, apiClient: client, default: client };
});

const mockRemoveItem = jest.fn<(name: string) => Promise<void>>(async () => undefined);
jest.mock('@/lib/indexeddb-storage', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: (name: string) => mockRemoveItem(name),
    },
}));

jest.mock('@/lib/config/checkout-mode', () => ({ isCheckoutUiEnabled: () => true }));

import { submitAndHandOver } from '../submit-and-hand-over';
import { useAutoSave } from '@/app/health/applications/new/_steps/hooks/use-auto-save';
import { useWizardStoreBase } from '@/app/health/applications/new/_steps/hooks/use-application-flow-store';

const STORAGE_KEY = 'gacp_application_flow_state_v4';

/** The applicant has answered and saved application X; it is DRAFT and about to be filed. */
function storeHoldsSavedX() {
    act(() => {
        useWizardStoreBase.getState().hydrateDraft({
            applicationId: 'app-X',
            requestType: 'NEW',
            applicantType: 'INDIVIDUAL',
            plantId: 'cannabis',
            certScope: 'PLANTING',
            applicantData: { firstName: 'คำตอบของ X' } as never,
        });
    });
}

function Wizard() { useAutoSave(); return null; }

let container: HTMLDivElement;
let root: Root;
function openWizard() { act(() => { root.render(<Wizard />); }); }
function leaveWizard() { act(() => { root.render(<></>); }); }

const draftPosts = () => mockPost.mock.calls.filter(([url]) => url === '/applications/draft');

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    mockPost.mockReset();
    mockRemoveItem.mockClear();
    // Fix round 1 (I3): the autosave sends only while a user is signed in.
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', role: 'HEALTH' }));
    act(() => { useWizardStoreBase.getState().resetWizard(); });
    act(() => { useWizardStoreBase.setState({ applicationId: undefined }); });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
});

async function pastDebounce() {
    await act(async () => { jest.advanceTimersByTime(3500); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}

describe('round 5: a filing leaves the wizard empty for the next application', () => {
    it('step 6 path: file X, leave, "ยื่นคำขอใหม่", edit gives exactly 1 POST with no id, and a new draft', async () => {
        storeHoldsSavedX();
        openWizard(); // step 6 is part of the wizard: the autosave hook is mounted
        // The server as it really answers once X is filed: a save naming X is refused.
        mockPost.mockImplementation(async (url, body) => {
            if (url === '/applications/submit') { return { success: true, data: { status: 'PENDING_DOC_FEE' } }; }
            if ((body as Record<string, unknown>).applicationId === 'app-X') {
                return { success: false, error: 'APPLICATION_NOT_EDITABLE', code: 'APPLICATION_NOT_EDITABLE' };
            }
            return { success: true, data: { id: 'app-Y' } };
        });

        let outcome: Awaited<ReturnType<typeof submitAndHandOver>> | undefined;
        await act(async () => {
            outcome = await submitAndHandOver({ applicationId: 'app-X', isInitialSubmit: true, isResubmit: false });
        });
        expect(outcome?.kind).toBe('FILED');
        leaveWizard(); // router.push to the payments page

        openWizard(); // "ยื่นคำขอใหม่"
        act(() => {
            useWizardStoreBase.getState().updateState({
                requestType: 'NEW',
                applicantData: { firstName: 'ผู้ยื่นรายใหม่' } as never,
            });
        });
        await pastDebounce();

        expect(draftPosts()).toHaveLength(1);
        const body = draftPosts()[0]![1] as Record<string, unknown>;
        expect(body.applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().applicationId).toBe('app-Y');
        // The new filing starts from nothing: X's answers did not come along.
        expect(useWizardStoreBase.getState().plantId).toBeNull();
        // The persisted copy of X was removed, so a reload cannot bring X back either.
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('step 6 path: the wizard is NOT emptied while it is still on screen (no bounce to step 1 mid-navigation)', async () => {
        storeHoldsSavedX();
        openWizard();
        mockPost.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });

        await act(async () => {
            await submitAndHandOver({ applicationId: 'app-X', isInitialSubmit: true, isResubmit: false });
        });

        // Still mounted: emptying now would make the step page bounce to step 1 while the
        // push to the payments page is in flight. It is emptied on the way out.
        expect(useWizardStoreBase.getState().applicationId).toBe('app-X');
        leaveWizard();
        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
    });

    it('preview path (no wizard on screen): emptied as soon as the filing is accepted', async () => {
        storeHoldsSavedX();
        mockPost.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });

        await act(async () => {
            await submitAndHandOver({ applicationId: 'app-X', isInitialSubmit: true, isResubmit: false });
        });

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().requestType).toBeNull();
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('a resubmit leaves the wizard too (the application is no longer editable)', async () => {
        storeHoldsSavedX();
        mockPost.mockResolvedValue({ success: true, data: { status: 'SUBMITTED' } });

        await act(async () => {
            await submitAndHandOver({ applicationId: 'app-X', isInitialSubmit: false, isResubmit: true });
        });

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
    });

    it('filing X from the preview page does not touch a store that is about another application', async () => {
        act(() => {
            useWizardStoreBase.getState().hydrateDraft({ applicationId: 'app-OTHER', requestType: 'RENEWAL' });
        });
        mockPost.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });

        await act(async () => {
            await submitAndHandOver({ applicationId: 'app-X', isInitialSubmit: true, isResubmit: false });
        });

        expect(useWizardStoreBase.getState().applicationId).toBe('app-OTHER');
        expect(useWizardStoreBase.getState().requestType).toBe('RENEWAL');
        expect(mockRemoveItem).not.toHaveBeenCalled();
    });

    it('a refused filing keeps everything (nothing was filed)', async () => {
        storeHoldsSavedX();
        mockPost.mockResolvedValue({ success: false, error: 'APPLICATION_INCOMPLETE', code: 'APPLICATION_INCOMPLETE' });

        let outcome: Awaited<ReturnType<typeof submitAndHandOver>> | undefined;
        await act(async () => {
            outcome = await submitAndHandOver({ applicationId: 'app-X', isInitialSubmit: true, isResubmit: false });
        });

        expect(outcome?.kind).toBe('REFUSED');
        expect(useWizardStoreBase.getState().applicationId).toBe('app-X');
        expect(mockRemoveItem).not.toHaveBeenCalled();
    });
});
