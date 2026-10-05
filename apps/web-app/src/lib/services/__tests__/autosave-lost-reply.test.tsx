/**
 * autosave-lost-reply (staging walk 2026-10-02): the operator saw the wizard's pill read
 * "บันทึกไม่สำเร็จ" in red on staging and demo while nginx logged 0 non-200 draft saves and
 * the backend 0 errors. Red came only from an HTTP error, from a 200 whose body could not be
 * read, or from an exception. The likely real trigger is a mobile connection dropping after
 * the headers arrived: the server SAVED, the client said "server failure", and never retried.
 *
 * This file runs the REAL api-client (only `fetch` is stubbed), the real store, the real
 * autosave hook and the real pill, and asserts what the applicant sees and what is sent:
 *   - a lost reply (unreadable 200, dropped connection) is amber and retried, never red;
 *   - 502/503/504 are retried; a 4xx is not;
 *   - the retries back off 2 s, 4 s, 8 s, 16 s, 30 s, then stop with a retry button;
 *   - coming back to the page (visible / focus / online) retries at once;
 *   - every retry sends the CURRENT store, through the same payload builder;
 *   - the red pill states its cause in Thai, never the server's text.
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

import { useAutoSave } from '@/app/health/applications/new/_steps/hooks/use-auto-save';
import { useWizardStoreBase } from '@/app/health/applications/new/_steps/hooks/use-application-flow-store';
import { AutoSaveIndicator } from '@/components/application-flow/auto-save-indicator';

type Sent = { at: number; body: Record<string, unknown> };
let sent: Sent[] = [];
type Reply = () => unknown;
let replies: Reply[] = [];
let fallback: Reply;

function jsonReply(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}
const SAVED = () => jsonReply(200, { success: true, data: { id: 'app-X', draftId: 'app-X' } });
/** The headers arrived, then the connection dropped: the body cannot be read. */
const LOST_BODY = () => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.reject(new TypeError('network error')),
    text: () => Promise.reject(new TypeError('network error')),
});
const DROPPED = () => { throw new TypeError('Failed to fetch'); };
const STATUS = (status: number, body: unknown) => () => jsonReply(status, body);

function installFetch() {
    global.fetch = jest.fn(async (url: unknown, init?: { body?: unknown }) => {
        if (!String(url).endsWith('/applications/draft')) { return jsonReply(200, { success: true, data: null }); }
        sent.push({ at: Date.now(), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} });
        const next = replies.shift() ?? fallback;
        return next();
    }) as unknown as typeof fetch;
}

// The pill exactly as the wizard layout wires it, plus the retry the hook offers.
const Pill = AutoSaveIndicator as unknown as React.FC<Record<string, unknown>>;
function Wizard() {
    const autoSave = useAutoSave() as unknown as Record<string, unknown>;
    return <Pill {...autoSave} onRetry={autoSave.retryNow} syncStatus={useWizardStoreBase.getState().syncStatus} />;
}

let container: HTMLDivElement;
let root: Root;

function pill() { return container.querySelector('[data-testid="auto-save-indicator"]') as HTMLElement | null; }
function pillState() { return pill()?.getAttribute('data-state') ?? null; }
function pillCause() {
    const p = pill();
    const tip = container.querySelector('[data-testid="auto-save-cause"]');
    return `${p?.getAttribute('title') ?? ''} ${tip?.textContent ?? ''}`.trim();
}
async function advance(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    sent = [];
    replies = [];
    fallback = SAVED;
    installFetch();
    localStorage.clear();
    // Fix round 1 (I3): the autosave sends only while a user is signed in.
    localStorage.setItem('user', JSON.stringify({ id: 'user-A', role: 'HEALTH' }));
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { useWizardStoreBase.getState().resetWizard(); });
    act(() => {
        useWizardStoreBase.getState().hydrateDraft({
            applicationId: 'app-X', requestType: 'NEW', plantId: 'cannabis', applicantType: 'INDIVIDUAL',
        });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<Wizard />); });
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    jest.useRealTimers();
});

/** An edit, then the 3 s debounce: the first save leaves. */
async function editAndSave(applicantType = 'JURISTIC') {
    act(() => { useWizardStoreBase.getState().updateState({ applicantType }); });
    await advance(3100);
}

describe('a lost reply is amber and retried, never red', () => {
    it('200 with an unreadable body: amber retrying, then the retry lands and the pill reads saved', async () => {
        replies = [LOST_BODY];
        await editAndSave();
        expect(sent).toHaveLength(1);
        expect(pillState()).not.toBe('error');
        expect(pillState()).toBe('retrying');

        await advance(2000);
        expect(sent).toHaveLength(2);
        expect(pillState()).toBe('synced');
        expect(useWizardStoreBase.getState().syncStatus).toBe('SYNCED');
    });

    it('a dropped connection with navigator.onLine still true: retried by the timer, not stuck amber', async () => {
        replies = [DROPPED];
        await editAndSave();
        expect(pillState()).toBe('retrying');
        await advance(2000);
        expect(sent).toHaveLength(2);
        expect(pillState()).toBe('synced');
    });

    it('backoff 2 s, 4 s, 8 s, 16 s, 30 s, then it stops and offers a retry button', async () => {
        fallback = LOST_BODY;
        await editAndSave();
        await advance(5 * 60_000);
        const gaps = sent.slice(1).map((s, i) => s.at - sent[i]!.at);
        expect(gaps).toEqual([2000, 4000, 8000, 16000, 30000]);
        expect(pillState()).toBe('retry-exhausted');

        const button = pill()!.closest('button') ?? pill()!.querySelector('button');
        expect(button).not.toBeNull();
        fallback = SAVED;
        await act(async () => { button!.click(); });
        await advance(0);
        expect(sent).toHaveLength(7);
        expect(pillState()).toBe('synced');
    });

    it.each([502, 503, 504])('an HTTP %s is retried', async (status) => {
        replies = [STATUS(status, { success: false, error: 'Backend service unavailable', code: 'BACKEND_UNREACHABLE' })];
        await editAndSave();
        expect(pillState()).toBe('retrying');
        await advance(2000);
        expect(sent).toHaveLength(2);
        expect(pillState()).toBe('synced');
    });
});

describe('a refusal is red, not retried, and says why in Thai', () => {
    it('400: no retry for two minutes, red, the cause in Thai and never the server text', async () => {
        replies = [STATUS(400, { success: false, error: 'Validation failed: plantId must be one of ...', code: 'VALIDATION_ERROR' })];
        await editAndSave();
        await advance(120_000);
        expect(sent).toHaveLength(1);
        expect(pillState()).toBe('error');
        const cause = pillCause();
        expect(cause).toMatch(/คุณ/);
        expect(cause).not.toMatch(/Validation failed|VALIDATION_ERROR|HTTP|Invalid server response/);
        expect(cause).not.toMatch(/—/);

        // Coming back to the page does not turn a refusal into a loop either.
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await advance(10_000);
        expect(sent).toHaveLength(1);
    });
});

describe.each([
    ['online', () => window.dispatchEvent(new Event('online'))],
    ['visibilitychange → visible', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['focus', () => window.dispatchEvent(new Event('focus'))],
])('%s retries at once', (_name, fire) => {
    it('while a retry is waiting', async () => {
        replies = [LOST_BODY];
        await editAndSave();
        await advance(500);
        expect(sent).toHaveLength(1);
        await act(async () => { fire(); });
        await advance(0);
        expect(sent).toHaveLength(2);
        expect(pillState()).toBe('synced');
    });

    it('after the retries have given up', async () => {
        fallback = LOST_BODY;
        await editAndSave();
        await advance(5 * 60_000);
        expect(pillState()).toBe('retry-exhausted');
        const before = sent.length;
        fallback = SAVED;
        await act(async () => { fire(); });
        await advance(0);
        expect(sent).toHaveLength(before + 1);
        expect(pillState()).toBe('synced');
    });
});

it('a retry sends the CURRENT store, not the payload that was lost', async () => {
    replies = [LOST_BODY];
    await editAndSave('JURISTIC');
    const firstAt = sent[0]!.at;
    // The applicant keeps typing before the retry fires (2 s, earlier than the 3 s debounce).
    await advance(500);
    act(() => { useWizardStoreBase.getState().updateState({ previousCertificateNumber: 'GACP-NEW-EDIT' }); });
    await advance(1500);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.at - firstAt).toBe(2000);
    const formData = sent[1]!.body.formData as Record<string, unknown>;
    expect(formData.applicantType).toBe('JURISTIC');
    expect(formData.previousCertificateNumber).toBe('GACP-NEW-EDIT');
    expect(sent[1]!.body.applicationId).toBe('app-X');
});
