/**
 * Round 5 minor 2 (privacy): logout never cleared the wizard's persisted state
 * (`gacp_application_flow_state_v4` in IndexedDB) nor the in-memory store. On a shared
 * device user B signed in after user A and the wizard rehydrated A's answers: names,
 * addresses, plots, and A's application id.
 *
 * Logout and an account switch now empty both. A same-user sign-in (a token refresh, a
 * second tab) keeps them.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';

const mockPost = jest.fn<(url: string, body?: unknown) => Promise<Record<string, unknown>>>();
jest.mock('../../api/api-client', () => ({
    apiClient: { post: jest.fn(), get: jest.fn() },
    api: { post: (u: string, b?: unknown) => mockPost(u, b), get: jest.fn(), delete: jest.fn() },
}));

const mockRemoveItem = jest.fn<(name: string) => Promise<void>>(async () => undefined);
const mockGetItem = jest.fn<(name: string) => Promise<string | null>>(async () => null);
jest.mock('@/lib/indexeddb-storage', () => ({
    indexedDBStorage: {
        getItem: (name: string) => mockGetItem(name),
        setItem: async () => undefined,
        removeItem: (name: string) => mockRemoveItem(name),
    },
}));

import { AuthService } from '../auth-service';
import { setupActivityTracking, type ActivityHandles } from '../auth-service-activity';
import { useWizardStoreBase } from '@/app/health/applications/new/_steps/hooks/use-application-flow-store';
import { useAutoSave } from '@/app/health/applications/new/_steps/hooks/use-auto-save';

const STORAGE_KEY = 'gacp_application_flow_state_v4';

function userAAnsweredTheWizard() {
    useWizardStoreBase.getState().hydrateDraft({
        applicationId: 'app-of-A',
        requestType: 'NEW',
        applicantData: { firstName: 'ผู้ใช้ A' } as never,
    });
}

beforeEach(() => {
    localStorage.clear();
    mockRemoveItem.mockClear();
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue(null);
    mockPost.mockReset();
    useWizardStoreBase.getState().resetWizard();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
});

describe('round 5: the wizard does not outlive its user', () => {
    it('logout empties the wizard store and removes its persisted copy', async () => {
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        userAAnsweredTheWizard();

        await AuthService.logout(true);

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().applicantData).toBeNull();
        expect(useWizardStoreBase.getState().requestType).toBeNull();
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('a sign-in as a DIFFERENT account empties it too (no logout in between)', async () => {
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        userAAnsweredTheWizard();
        mockRemoveItem.mockClear();

        await AuthService.saveSession({ user: { id: 'user-B', role: 'health' } } as never);

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().applicantData).toBeNull();
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('the same account signing in again keeps the wizard', async () => {
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        userAAnsweredTheWizard();
        mockRemoveItem.mockClear();

        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);

        expect(useWizardStoreBase.getState().applicationId).toBe('app-of-A');
        expect(mockRemoveItem).not.toHaveBeenCalled();
    });
});

/**
 * Round 5b (reviewer P2, a regression versus main): the idle timeout calls logout(), and
 * logout wiped the wizard. clearSession also removes the stored user, so the next sign-in
 * saw no prior user and wiped again even for the same account. An edit that had not been
 * sent yet was lost on every expiry. The wizard now records whose it is; only an explicit
 * logout, or a sign-in by someone else, empties it.
 */
describe('round 5b: an expiry is not a logout', () => {
    function Wizard() { useAutoSave(); return null; }

    beforeEach(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        jest.useFakeTimers();
    });
    afterEach(() => { jest.useRealTimers(); });

    async function userAHasAnUnsentEdit() {
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        useWizardStoreBase.getState().hydrateDraft({
            applicationId: 'app-of-A',
            requestType: 'NEW',
            plantId: 'cannabis',
            applicantData: { firstName: 'แก้แล้วยังไม่ได้ส่ง' } as never,
            syncStatus: 'PENDING',
        });
    }

    async function idleTimeout() {
        localStorage.setItem('lastActivity', String(Date.now() - 5 * 60 * 1000));
        const handles: ActivityHandles = { activityTimer: null };
        setupActivityTracking(AuthService, handles, 30);
        await jest.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000);
        for (let i = 0; i < 5; i++) { await Promise.resolve(); }
    }

    it('idle timeout, then the SAME user signs in: the unsent edit is still there and is sent once', async () => {
        await userAHasAnUnsentEdit();
        await idleTimeout();
        expect(localStorage.getItem('user')).toBeNull(); // the session really ended
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);

        expect(useWizardStoreBase.getState().applicationId).toBe('app-of-A');
        expect(mockRemoveItem).not.toHaveBeenCalled();

        mockPost.mockResolvedValue({ success: true, data: { id: 'app-of-A', version: 2 } });
        const container = document.createElement('div');
        const root = createRoot(container);
        act(() => { root.render(React.createElement(Wizard)); });
        await act(async () => { await jest.advanceTimersByTimeAsync(3500); });
        await act(async () => { await jest.advanceTimersByTimeAsync(3500); });
        act(() => { root.unmount(); });

        const drafts = mockPost.mock.calls.filter(([url]) => url === '/applications/draft');
        expect(drafts).toHaveLength(1);
        expect((drafts[0]![1] as Record<string, unknown>).applicationId).toBe('app-of-A');
        expect(((drafts[0]![1] as { formData: Record<string, unknown> }).formData.applicantData as Record<string, unknown>).firstName)
            .toBe('แก้แล้วยังไม่ได้ส่ง');
    });

    it('idle timeout, then a DIFFERENT user signs in: emptied', async () => {
        await userAHasAnUnsentEdit();
        await idleTimeout();
        await AuthService.saveSession({ user: { id: 'user-B', role: 'health' } } as never);

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().applicantData).toBeNull();
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('an explicit logout still empties it', async () => {
        await userAHasAnUnsentEdit();
        await AuthService.logout(true);

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });
});

describe('round 5b: how the wizard knows whose answers it holds', () => {
    it('answers written while A is signed in are stamped as A\'s', async () => {
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        userAAnsweredTheWizard();
        expect(useWizardStoreBase.getState().ownerUserId).toBe('user-A');
    });

    it('a sign-in by A empties a persisted copy stamped for B, even with nothing in memory', async () => {
        mockGetItem.mockResolvedValue(JSON.stringify({ state: { ownerUserId: 'user-B', applicationId: 'app-of-B', requestType: 'NEW' }, version: 0 }));
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('a sign-in by A keeps a persisted copy stamped for A', async () => {
        mockGetItem.mockResolvedValue(JSON.stringify({ state: { ownerUserId: 'user-A', applicationId: 'app-of-A', requestType: 'NEW' }, version: 0 }));
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        expect(mockRemoveItem).not.toHaveBeenCalled();
    });

    it('answers persisted before the stamp existed (no owner) are not rehydrated into whoever is signed in', async () => {
        await AuthService.saveSession({ user: { id: 'user-A', role: 'health' } } as never);
        mockGetItem.mockResolvedValue(JSON.stringify({ state: { applicationId: 'app-unknown', requestType: 'NEW', plantId: 'cannabis' }, version: 0 }));
        await useWizardStoreBase.persist.rehydrate();
        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().plantId).toBeNull();
    });
});
