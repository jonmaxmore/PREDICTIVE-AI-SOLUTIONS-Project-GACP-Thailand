/**
 * Round 5b, found by the view-pack walk: the detach (round 5 (b)) never fired against the
 * real error envelope.
 *
 * The backend answers a refused draft save with
 *   409 { success:false, code:'APPLICATION_NOT_EDITABLE', error:'Failed to save application', ... }
 * (respondError keeps the route's own message in `error`, applications.js POST /draft catch).
 * api-client harvests `rawCode = data.error || data.code`, so the response the hook saw had
 * `code: 'Failed to save application'`: the machine code was gone, the detach check found
 * nothing, and the wizard showed "บันทึกไม่สำเร็จ" and retried under the refused id forever.
 * The unit tests handed the hook `{ code: 'APPLICATION_NOT_EDITABLE' }` directly and passed.
 *
 * This file goes through the REAL api-client with only `fetch` stubbed, answering with the
 * envelope the backend actually sends.
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

import { useAutoSave, ensureLatestDraftSaved } from '@/app/health/applications/new/_steps/hooks/use-auto-save';
import { useWizardStoreBase } from '@/app/health/applications/new/_steps/hooks/use-application-flow-store';

type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];

/** The envelope shared/api-response.js sendErrorResponse writes for the /draft catch. */
function refusedEnvelope(status: number, code: string) {
    return {
        success: false, code,
        error: 'Failed to save application', message: 'Failed to save application',
        messageTh: 'เกิดข้อผิดพลาด', requestId: 'req-1', timestamp: '2026-10-02T00:00:00.000Z',
    };
}

function respond(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

function backendRefuses(status: number, code: string) {
    global.fetch = jest.fn(async (url: unknown, init?: { body?: unknown }) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        sent.push({ url: String(url), body });
        if (String(url).endsWith('/applications/draft') && body.applicationId === 'app-X') {
            return respond(status, refusedEnvelope(status, code));
        }
        return respond(200, { success: true, data: { id: 'app-Y', draftId: 'app-Y', version: 1 } });
    }) as unknown as typeof fetch;
}

const draftPosts = () => sent.filter((s) => s.url.endsWith('/applications/draft'));

function Wizard() { useAutoSave(); return null; }
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    sent = [];
    localStorage.clear();
    // Fix round 1 (I3): the autosave sends only while a user is signed in.
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', role: 'HEALTH' }));
    act(() => { useWizardStoreBase.getState().resetWizard(); });
    act(() => {
        useWizardStoreBase.getState().hydrateDraft({
            applicationId: 'app-X', requestType: 'NEW', plantId: 'cannabis', applicantType: 'INDIVIDUAL',
        });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    jest.useRealTimers();
});

async function pastDebounce() {
    await act(async () => { await jest.advanceTimersByTimeAsync(3500); });
}

describe.each([
    [409, 'APPLICATION_NOT_EDITABLE'],
    [404, 'APPLICATION_NOT_FOUND'],
])('round 5b: the real %s envelope (%s) reaches the detach', (status, code) => {
    it('autosave: the refused id is dropped and the next save carries no id', async () => {
        backendRefuses(status, code);
        act(() => { root.render(<Wizard />); });
        act(() => { useWizardStoreBase.getState().updateState({ applicantType: 'JURISTIC' }); });
        await pastDebounce();
        expect(draftPosts()).toHaveLength(1);
        expect(draftPosts()[0]!.body.applicationId).toBe('app-X');

        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
        await pastDebounce();
        expect(draftPosts()).toHaveLength(2);
        expect(draftPosts()[1]!.body.applicationId).toBeUndefined();
        expect(useWizardStoreBase.getState().applicationId).toBe('app-Y');
    });

    it('submit gate, no wizard on screen: DETACHED, not "try again"', async () => {
        backendRefuses(status, code);
        act(() => { useWizardStoreBase.getState().setSyncStatus('PENDING'); });
        let result: unknown;
        await act(async () => { result = await ensureLatestDraftSaved('app-X'); });
        expect(result).toBe('DETACHED');
        expect(useWizardStoreBase.getState().applicationId).toBeUndefined();
    });
});
