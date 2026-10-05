/**
 * autosave-lost-reply, fix round 1: the reviewer's probes (zz-review-probes*.test.tsx)
 * turned into assertions. Same harness as autosave-lost-reply.test.tsx.
 *
 * Original header follows.
 *
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

import { useAutoSave, ensureLatestDraftSaved } from '@/app/health/applications/new/_steps/hooks/use-auto-save';
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
async function advance(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }

beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    sent = [];
    replies = [];
    fallback = SAVED;
    installFetch();
    localStorage.clear();
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


function deferred() {
    let resolve!: (v: unknown) => void;
    const p = new Promise((r) => { resolve = r; });
    return { p, resolve };
}
const formDataOf = (s: Sent) => s.body.formData as Record<string, unknown>;

describe('C1: saves never overlap, and the newest answers are the ones that land', () => {
    it('P3: a debounce save waits for the in-flight retry, then sends the CURRENT store; the pill and store end correct', async () => {
        replies = [LOST_BODY];
        await editAndSave('JURISTIC');
        const retryReply = deferred();
        replies = [() => retryReply.p];
        await advance(2000); // retry R leaves and hangs
        expect(sent).toHaveLength(2);
        act(() => { useWizardStoreBase.getState().updateState({ previousCertificateNumber: 'NEWER' }); });
        await advance(3100); // the debounce fires while R is still in flight
        expect(sent).toHaveLength(2); // nothing overlaps R
        await act(async () => { retryReply.resolve(SAVED()); });
        await advance(1000);
        expect(sent).toHaveLength(3); // the queued save left after R answered
        expect(formDataOf(sent[2]!).previousCertificateNumber).toBe('NEWER');
        await advance(60_000);
        expect(formDataOf(sent.at(-1)!).previousCertificateNumber).toBe('NEWER');
        expect(pillState()).toBe('synced');
        expect(useWizardStoreBase.getState().syncStatus).toBe('SYNCED');
    });

    it('every save carries one session and a strictly increasing sequence, beside applicationId and never inside formData', async () => {
        replies = [LOST_BODY, LOST_BODY];
        await editAndSave();
        await advance(2000);
        await advance(4000);
        expect(sent.length).toBeGreaterThanOrEqual(3);
        const sessions = new Set(sent.map((s) => s.body.saveSession));
        expect(sessions.size).toBe(1);
        expect(typeof [...sessions][0]).toBe('string');
        const seqs = sent.map((s) => s.body.saveSeq as number);
        seqs.slice(1).forEach((seq, i) => expect(seq).toBeGreaterThan(seqs[i]!));
        for (const s of sent) {
            expect(formDataOf(s)).not.toHaveProperty('saveSeq');
            expect(formDataOf(s)).not.toHaveProperty('saveSession');
        }
    });

    it('409 DRAFT_OUT_OF_ORDER is "already superseded": no retry, not red, no detach', async () => {
        replies = [STATUS(409, { success: false, code: 'DRAFT_OUT_OF_ORDER', error: 'Draft save is older than the last one applied' })];
        await editAndSave();
        await advance(120_000);
        expect(sent).toHaveLength(1);
        expect(pillState()).not.toBe('error');
        expect(pillState()).not.toBe('retrying');
        expect(useWizardStoreBase.getState().applicationId).toBe('app-X');
    });

    it('the submit gate saving while the autosave is in flight waits, then sends the current store', async () => {
        replies = [LOST_BODY];
        await editAndSave('JURISTIC');
        const retryReply = deferred();
        replies = [() => retryReply.p];
        await advance(2000);
        act(() => { useWizardStoreBase.getState().updateState({ previousCertificateNumber: 'AT-GATE' }); });
        let gate: string | null = null;
        void ensureLatestDraftSaved('app-X').then((r) => { gate = r; });
        await advance(100);
        expect(sent).toHaveLength(2);
        await act(async () => { retryReply.resolve(SAVED()); });
        await advance(1000);
        expect(gate).toBe('SAVED');
        expect(formDataOf(sent.at(-1)!).previousCertificateNumber).toBe('AT-GATE');
    });
});

describe('I1: a tap-only failure is not retried by page events', () => {
    it.each([
        ['500 + focus', 500, () => window.dispatchEvent(new Event('focus'))],
        ['429 + visibilitychange', 429, () => document.dispatchEvent(new Event('visibilitychange'))],
        ['500 + online', 500, () => window.dispatchEvent(new Event('online'))],
    ])('%s', async (_name, status, fire) => {
        fallback = STATUS(status as number, { success: false, error: 'x' });
        await editAndSave();
        const before = sent.length;
        for (let i = 0; i < 5; i += 1) { await act(async () => { fire(); }); await advance(3000); }
        expect(sent).toHaveLength(before);
    });
});

describe('I2: a body that never arrives ends as a timeout and is retried', () => {
    const STALL = () => ({
        ok: true, status: 200,
        headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: () => new Promise(() => {}), text: () => new Promise(() => {}),
    });

    it('stalled body → TIMEOUT after 30 s → amber retrying → the retry lands', async () => {
        replies = [STALL];
        await editAndSave();
        expect(sent).toHaveLength(1);
        await advance(30_500);
        expect(pillState()).toBe('retrying');
        await advance(2000);
        expect(sent).toHaveLength(2);
        expect(pillState()).toBe('synced');
    });

    it('the submit gate resolves instead of hanging', async () => {
        replies = [STALL];
        await editAndSave();
        let gate: string | null = null;
        void ensureLatestDraftSaved('app-X').then((r) => { gate = r; });
        await advance(10 * 60_000);
        expect(gate).not.toBeNull();
    });
});

describe('I3: never send one user\'s answers under another user\'s session', () => {
    it('an armed retry, answers owned by A, stored user now B: zero POSTs, nothing detached', async () => {
        act(() => { useWizardStoreBase.setState({ ownerUserId: 'user-A' }); });
        replies = [LOST_BODY];
        await editAndSave();
        expect(sent).toHaveLength(1);
        localStorage.setItem('user', JSON.stringify({ id: 'user-B', role: 'HEALTH' }));
        await advance(120_000);
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await advance(10_000);
        expect(sent).toHaveLength(1);
        expect(useWizardStoreBase.getState().applicationId).toBe('app-X');
        expect(useWizardStoreBase.getState().applicantType).toBe('JURISTIC');
    });

    it('no stored user (signed out in another tab): zero POSTs', async () => {
        act(() => { useWizardStoreBase.setState({ ownerUserId: 'user-A' }); });
        replies = [LOST_BODY];
        await editAndSave();
        localStorage.removeItem('user');
        await advance(120_000);
        expect(sent).toHaveLength(1);
        let gate: string | null = null;
        await act(async () => { gate = await ensureLatestDraftSaved('app-X'); });
        expect(gate).toBe('NOT_SAVED');
        expect(sent).toHaveLength(1);
    });
});

describe('M1 / M2', () => {
    it('M1: after the retries are spent, a NEW edit that fails is retried automatically again', async () => {
        fallback = LOST_BODY;
        await editAndSave();
        await advance(5 * 60_000);
        expect(pillState()).toBe('retry-exhausted');
        const before = sent.length;
        await editAndSave('INDIVIDUAL');
        expect(sent).toHaveLength(before + 1);
        await advance(2000);
        expect(sent).toHaveLength(before + 2);
    });

    it('M2: page events less than 2 s apart trigger one retry, not one each', async () => {
        fallback = LOST_BODY;
        await editAndSave();
        await advance(500);
        const before = sent.length;
        for (let i = 0; i < 4; i += 1) { await act(async () => { window.dispatchEvent(new Event('focus')); }); await advance(200); }
        expect(sent).toHaveLength(before + 1);
    });
});

it('P1: a retry that falls inside the resume hold is not lost: the edit is saved once the hold lifts', async () => {
    replies = [LOST_BODY];
    await editAndSave();
    act(() => { useWizardStoreBase.getState().setResumePending(true); });
    await advance(2500);
    act(() => { useWizardStoreBase.getState().setResumePending(false); });
    await advance(120_000);
    expect(pillState()).toBe('synced');
    expect(useWizardStoreBase.getState().syncStatus).toBe('SYNCED');
});

describe('fix round 2 (P8): the pill says why nothing is sent, instead of promising a retry', () => {
    it('another account signed in: red, "บันทึกในบัญชีนี้ไม่ได้", the other-account cause', async () => {
        act(() => { useWizardStoreBase.setState({ ownerUserId: 'user-A' }); });
        replies = [LOST_BODY];
        await editAndSave();
        localStorage.setItem('user', JSON.stringify({ id: 'user-B', role: 'HEALTH' }));
        await advance(2500);
        expect(sent).toHaveLength(1);
        expect(pillState()).toBe('error');
        expect(pill()!.textContent).toContain('บันทึกในบัญชีนี้ไม่ได้');
        expect(pill()!.getAttribute('title')).toBe('คำตอบในหน้านี้เป็นของบัญชีอื่น ระบบจึงไม่บันทึกด้วยบัญชีของคุณ เข้าสู่ระบบด้วยบัญชีเดิมเพื่อบันทึกต่อ');
    });

    it('signed out: "เซสชันหมดอายุ" with the signed-out cause', async () => {
        act(() => { useWizardStoreBase.setState({ ownerUserId: 'user-A' }); });
        replies = [LOST_BODY];
        await editAndSave();
        localStorage.removeItem('user');
        await advance(2500);
        expect(sent).toHaveLength(1);
        expect(pillState()).toBe('auth-error');
        expect(pill()!.getAttribute('title')).toBe('คุณออกจากระบบแล้ว คำตอบของคุณยังอยู่ในเครื่องนี้ เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ');
    });
});
