/**
 * autosave-lost-reply fix round 3 (I1): finding 3's client side through the REAL modules.
 *
 * The submit-and-hand-over unit test mocks `submitClockFor` and `saveCurrentDraftNow`, so a
 * deleted or mis-keyed `rememberAppliedClock` would send every submit without a clock (the
 * server then skips its DRAFT_NOT_LATEST check) with every test green. Here only `fetch` is
 * stubbed: the real api-client, store, autosave hook, gate and submit run.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('@/lib/indexeddb-storage', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}));

import {
    useAutoSave,
    ensureLatestDraftSaved,
    saveCurrentDraftNow,
    submitClockFor,
} from '@/app/health/applications/new/_steps/hooks/use-auto-save';
import { useWizardStoreBase } from '@/app/health/applications/new/_steps/hooks/use-application-flow-store';
import { submitAndHandOver } from '@/lib/services/submit-and-hand-over';

type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];
type Reply = (body: Record<string, unknown>) => unknown;
let draftReplies: Reply[] = [];
let submitReplies: Reply[] = [];

function jsonReply(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}
const SAVED: Reply = (body) => jsonReply(200, { success: true, data: { id: body.applicationId, draftId: body.applicationId } });
const SERVER_ERROR: Reply = () => jsonReply(500, { success: false, error: 'Internal server error' });
const NOT_LATEST: Reply = () => jsonReply(409, { success: false, code: 'DRAFT_NOT_LATEST', error: 'The stored draft is not the last save from this page' });
const FILED: Reply = () => jsonReply(200, { success: true, data: { status: 'PENDING_DOC_FEE' } });

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    sent = [];
    draftReplies = [];
    submitReplies = [];
    global.fetch = jest.fn(async (url: unknown, init?: { body?: unknown }) => {
        const u = String(url);
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        if (u.endsWith('/applications/draft')) { sent.push({ url: 'draft', body }); return (draftReplies.shift() ?? SAVED)(body); }
        if (u.endsWith('/applications/submit')) { sent.push({ url: 'submit', body }); return (submitReplies.shift() ?? FILED)(body); }
        return jsonReply(200, { success: true, data: null });
    }) as unknown as typeof fetch;
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', role: 'HEALTH' }));
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    act(() => { useWizardStoreBase.getState().resetWizard(); });
});

afterEach(() => {
    jest.useRealTimers();
});

function load(applicationId: string, syncStatus: 'SYNCED' | 'PENDING' = 'SYNCED') {
    act(() => {
        useWizardStoreBase.getState().hydrateDraft({
            applicationId, requestType: 'NEW', plantId: 'cannabis', applicantType: 'INDIVIDUAL', syncStatus,
        });
    });
}
const drafts = () => sent.filter((s) => s.url === 'draft');
const submits = () => sent.filter((s) => s.url === 'submit');
const clockOf = (s: Sent) => ({ saveSession: s.body.saveSession, lastAppliedSeq: s.body.saveSeq });
async function advance(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }

function Wizard() { useAutoSave(); return null; }
function mountWizard(): { unmount: () => void } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => { root.render(<Wizard />); });
    return { unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

describe('submitClockFor reports the save the server APPLIED', () => {
    it('wizard autosave: after a 200, the clock is that save\'s session and seq', async () => {
        load('app-W1');
        const wizard = mountWizard();
        act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'JURISTIC' }); });
        await advance(3100);
        expect(drafts()).toHaveLength(1);
        expect(submitClockFor('app-W1')).toEqual(clockOf(drafts()[0]!));
        wizard.unmount();
    });

    it('a save that failed is not remembered; the next applied one is', async () => {
        load('app-W2');
        const wizard = mountWizard();
        draftReplies = [SERVER_ERROR];
        act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'JURISTIC' }); });
        await advance(3100);
        expect(submitClockFor('app-W2')).toBeNull();
        act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'COMMUNITY_ENTERPRISE' }); });
        await advance(3100);
        expect(drafts()).toHaveLength(2);
        expect(submitClockFor('app-W2')).toEqual(clockOf(drafts()[1]!));
        wizard.unmount();
    });

    it('the submit gate with no wizard on screen: the clock is the gate\'s own save', async () => {
        load('app-G1', 'PENDING');
        let gate: string | null = null;
        await act(async () => { gate = await ensureLatestDraftSaved('app-G1'); });
        expect(gate).toBe('SAVED');
        expect(drafts()).toHaveLength(1);
        expect(submitClockFor('app-G1')).toEqual(clockOf(drafts()[0]!));
    });
});

describe('submit carries the clock, and saveCurrentDraftNow really saves', () => {
    it('submitAndHandOver sends the last applied save\'s clock in the request body', async () => {
        load('app-S1');
        const wizard = mountWizard();
        act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'JURISTIC' }); });
        await advance(3100);
        await act(async () => { await submitAndHandOver({ applicationId: 'app-S1', isInitialSubmit: true, isResubmit: false }); });
        expect(submits()).toHaveLength(1);
        expect(submits()[0]!.body).toMatchObject({ applicationId: 'app-S1', ...clockOf(drafts()[0]!) });
        expect(typeof submits()[0]!.body.saveSession).toBe('string');
        expect(typeof submits()[0]!.body.lastAppliedSeq).toBe('number');
        wizard.unmount();
    });

    it('saveCurrentDraftNow on a SYNCED store POSTs the current answers and is SAVED only after the 200', async () => {
        load('app-N1');
        act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'JURISTIC' }); });
        act(() => { useWizardStoreBase.getState().setSyncStatus('SYNCED'); });
        let result: string | null = null;
        await act(async () => { result = await saveCurrentDraftNow('app-N1'); });
        expect(result).toBe('SAVED');
        expect(drafts()).toHaveLength(1);
        expect((drafts()[0]!.body.formData as Record<string, unknown>).applicantType).toBe('JURISTIC');
        expect(drafts()[0]!.body.applicationId).toBe('app-N1');
        expect(submitClockFor('app-N1')).toEqual(clockOf(drafts()[0]!));
    });

    it('saveCurrentDraftNow when the server refuses: NOT_SAVED, and no clock is claimed', async () => {
        load('app-N2');
        draftReplies = [SERVER_ERROR];
        let result: string | null = null;
        await act(async () => { result = await saveCurrentDraftNow('app-N2'); });
        expect(drafts()).toHaveLength(1);
        expect(result).toBe('NOT_SAVED');
        expect(submitClockFor('app-N2')).toBeNull();
    });

    it('saveCurrentDraftNow with the wizard on screen goes through the wizard\'s save and POSTs', async () => {
        load('app-N3');
        const wizard = mountWizard();
        let result: string | null = null;
        await act(async () => { result = await saveCurrentDraftNow('app-N3'); });
        expect(result).toBe('SAVED');
        expect(drafts()).toHaveLength(1);
        expect(submitClockFor('app-N3')).toEqual(clockOf(drafts()[0]!));
        wizard.unmount();
    });
});

it('two tabs: 409 DRAFT_NOT_LATEST → this page re-saves its current answers once → the second submit names the NEW save', async () => {
    load('app-T1');
    const wizard = mountWizard();
    act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'JURISTIC' }); });
    await advance(3100);
    const firstSave = drafts()[0]!;
    submitReplies = [NOT_LATEST, FILED];
    let outcome: { kind: string } | null = null;
    await act(async () => { outcome = await submitAndHandOver({ applicationId: 'app-T1', isInitialSubmit: true, isResubmit: false }); });
    expect(sent.map((s) => s.url)).toEqual(['draft', 'submit', 'draft', 'submit']);
    const resave = drafts()[1]!;
    expect((resave.body.formData as Record<string, unknown>).applicantType).toBe('JURISTIC');
    expect(resave.body.saveSeq as number).toBeGreaterThan(firstSave.body.saveSeq as number);
    expect(submits()[0]!.body).toMatchObject(clockOf(firstSave));
    expect(submits()[1]!.body).toMatchObject(clockOf(resave));
    expect(outcome!.kind).toBe('FILED');
    wizard.unmount();
});
