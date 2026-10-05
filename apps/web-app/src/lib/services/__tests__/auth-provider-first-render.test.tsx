/**
 * W1-HYDRATION — AuthProvider first-render contract.
 *
 * The server renders every session page with user=null (localStorage does
 * not exist during SSR). React hydration requires the FIRST client render
 * to produce identical output — so AuthProvider must NOT read the stored
 * session during the initial render. Reading it lazily in the useState
 * initializer caused "Hydration failed because the server rendered HTML
 * didn't match the client" pageerrors on /health/account/erasure and
 * /provider/accounting/reports (proven via Playwright pageerror probe).
 *
 * Contract:
 *   render #1  → user=null, isLoading=true   (matches the SSR snapshot)
 *   post-mount → user=<stored session>, isLoading=false
 *
 * Pattern: createRoot + act (matches RootLangUpdater.test.tsx — this repo
 * does not ship @testing-library/react).
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AuthProvider, useAuth } from '../auth-provider';
import { AuthService } from '../auth-service';

function makeJwt(payload: Record<string, unknown>): string {
    const enc = (obj: Record<string, unknown>) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.fakesig`;
}

const STORED_USER = {
    id: 'probe-user',
    healthId: 'HID-PROBE',
    firstName: 'สมชาย',
    lastName: 'ทดสอบ',
    email: 'probe@example.com',
    role: 'HEALTH',
};

const renderLog: Array<{ userId: string | null; isLoading: boolean }> = [];

function Recorder() {
    const { user, isLoading } = useAuth();
    renderLog.push({ userId: user?.id ?? null, isLoading });
    return <div data-testid="who">{user ? user.id : 'anonymous'}</div>;
}

describe('AuthProvider first-render hydration contract', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeAll(() => {
        // jsdom in this jest setup has no fetch; AuthService.clearSession
        // (teardown below) fire-and-forgets a cookie-clear POST.
        if (!globalThis.fetch) {
            (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true }));
        }
    });

    beforeEach(() => {
        renderLog.length = 0;
        localStorage.setItem('accessToken', makeJwt({ sub: 'probe-user', role: 'HEALTH', exp: 1900000000 }));
        localStorage.setItem('user', JSON.stringify(STORED_USER));
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        if (root) {
            const r = root;
            act(() => { r.unmount(); });
            root = null;
        }
        container?.remove();
        container = null;
        // Tear down the singleton's refresh/activity timers so jest exits cleanly.
        AuthService.clearSession();
        localStorage.clear();
    });

    it('first render matches the SSR snapshot (null user, loading) even when a session exists in localStorage', async () => {
        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AuthProvider>
                    <Recorder />
                </AuthProvider>,
            );
        });

        // Render #1 must be identical to what the server produced:
        // no user, still loading. Anything else is a hydration mismatch.
        expect(renderLog[0]).toEqual({ userId: null, isLoading: true });

        // ...and the stored session must still arrive right after mount.
        expect(renderLog[renderLog.length - 1]).toEqual({ userId: 'probe-user', isLoading: false });
        expect(container!.textContent).toContain('probe-user');
    });

    it('settles to anonymous, not-loading after mount when no session is stored', async () => {
        localStorage.clear();

        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AuthProvider>
                    <Recorder />
                </AuthProvider>,
            );
        });

        expect(renderLog[0]).toEqual({ userId: null, isLoading: true });
        // isLoading must resolve to false so guards (useRequireAuth, the
        // erasure redirect) can act on the settled anonymous state.
        expect(renderLog[renderLog.length - 1]).toEqual({ userId: null, isLoading: false });
        expect(container!.textContent).toContain('anonymous');
    });
});
