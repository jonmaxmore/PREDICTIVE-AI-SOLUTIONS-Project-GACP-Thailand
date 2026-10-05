/**
 * auth-service-activity.ts — Item 3 (council final-fix round, ThaID sandbox
 * readiness final-fix-report).
 *
 * Bug: `resetActivityTimer` (and `setupActivityTracking`'s throttled
 * handler) armed the 30-min idle timer only when `host.isAuthenticated()`
 * was true — and `isAuthenticated()` (auth-service.ts) requires a stored
 * localStorage TOKEN. A ThaID session is cookie-only
 * (`AuthService.saveSession({ user })`, no token — "session = httpOnly
 * cookie เท่านั้น", auth-idp.js) and therefore never armed the idle timer:
 * an unattended ThaID session on a shared PC stayed live for its full 8h
 * cookie lifetime instead of the 30-min window every other session gets.
 *
 * Fix: the arm condition is now "is there a stored IDENTITY"
 * (`host.getUser()` non-null), token or not.
 *
 * This file also proves the SECOND half of the fix requirement: that firing
 * the timeout actually ENDS the cookie session — `AuthService.logout()`
 * already calls the backend logout endpoint (which clears the httpOnly
 * cookie server-side via `res.clearCookie`), so the idle-timeout path
 * calling `host.logout()` is sufficient; this test drives the REAL
 * `AuthService` singleton through the REAL `setupActivityTracking` to prove
 * that wiring end-to-end rather than asserting on a mock.
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import {
    setupActivityTracking,
    type ActivityHost,
    type ActivityHandles,
} from '../auth-service-activity';
import { AuthService } from '../auth-service';
import type { AuthUser } from '../auth-service.types';

function makeHost(overrides: Partial<ActivityHost> = {}): ActivityHost {
    return {
        isBrowser: () => true,
        isAuthenticated: () => false,
        getUser: () => null,
        logout: jest.fn(async () => undefined),
        emit: jest.fn(),
        ...overrides,
    };
}

describe('auth-service-activity — Item 3: identity-based arm condition', () => {
    it('cookie-only session (isAuthenticated()===false, but getUser() non-null) ARMS the idle timer', () => {
        const host = makeHost({ isAuthenticated: () => false, getUser: () => ({ id: 'citizen-1' } as AuthUser) });
        const handles: ActivityHandles = { activityTimer: null };

        setupActivityTracking(host, handles, 30);

        expect(handles.activityTimer).not.toBeNull();
    });

    it('token-based (password-path) session still arms — baseline unchanged', () => {
        const host = makeHost({ isAuthenticated: () => true, getUser: () => ({ id: 'officer-1' } as AuthUser) });
        const handles: ActivityHandles = { activityTimer: null };

        setupActivityTracking(host, handles, 30);

        expect(handles.activityTimer).not.toBeNull();
    });

    it('no stored identity at all → does NOT arm (nothing to time out)', () => {
        const host = makeHost({ isAuthenticated: () => false, getUser: () => null });
        const handles: ActivityHandles = { activityTimer: null };

        setupActivityTracking(host, handles, 30);

        expect(handles.activityTimer).toBeNull();
    });

    it('not a browser → never arms (existing guard unaffected by the fix)', () => {
        const host = makeHost({ isBrowser: () => false, getUser: () => ({ id: 'citizen-1' } as AuthUser) });
        const handles: ActivityHandles = { activityTimer: null };

        setupActivityTracking(host, handles, 30);

        expect(handles.activityTimer).toBeNull();
    });
});

describe('auth-service-activity — Item 3: idle timeout ends a cookie-only ThaID session end-to-end', () => {
    const realFetch = globalThis.fetch;
    let fetchMock: jest.Mock;

    function clearAllCookies(): void {
        for (const c of document.cookie.split(';')) {
            const name = c.split('=')[0].trim();
            if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }
    }

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        clearAllCookies();
        fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    });

    afterEach(() => {
        jest.useRealTimers();
        (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
        localStorage.clear();
        clearAllCookies();
    });

    it('cookie-only session: idle timeout invokes AuthService.logout(), which POSTs the backend logout endpoint (ends the httpOnly cookie server-side)', async () => {
        // Exactly the ThaID success path: client-view.tsx calls
        // AuthService.saveSession({ user }) — no token field at all.
        await AuthService.saveSession({
            user: {
                id: 'citizen-1', role: 'HEALTH', authType: 'HEALTH_ID',
                firstName: 'สมชาย', lastName: 'ใจดี',
            } as AuthUser,
        });

        // Sanity: this really is the cookie-only shape the OLD arm
        // condition (isAuthenticated()) would have missed.
        expect(AuthService.getToken()).toBeNull();
        expect(AuthService.isAuthenticated()).toBe(false);
        expect(AuthService.getUser()).not.toBeNull();

        // Backdate lastActivity by 5 extra minutes: saveSession() and the
        // timer's arm both happen "now", so a timer that fires exactly
        // `timeoutMinutes` later would land EXACTLY at the threshold —
        // `isSessionTimedOut` uses a strict `>`, and fake timers give none
        // of the real wall-clock jitter that nudges a real run past it.
        // Backdating clears that boundary case without changing what's
        // under test (the arm condition and the logout wiring).
        localStorage.setItem('lastActivity', String(Date.now() - 5 * 60 * 1000));

        const handles: ActivityHandles = { activityTimer: null };
        setupActivityTracking(AuthService, handles, 30);
        expect(handles.activityTimer).not.toBeNull();

        // Idle past the 30-min window; advanceTimersByTimeAsync also pumps
        // the microtask queue so the async logout()/.finally() chain (and
        // the mocked fetch's promise) actually settles.
        await jest.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000);
        // Extra flush for the .finally() continuation, belt-and-suspenders.
        for (let i = 0; i < 5; i++) { await Promise.resolve(); }

        // The decisive assertion: logout() reached the BACKEND — not just a
        // local state clear. For a HEALTH (non-provider) user this is the
        // health logout route, which server-side res.clearCookie('auth_token', ...)
        // (auth-session-security-handlers.js) — the correct cookie per Item 1.
        const logoutCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/logout'));
        expect(logoutCall).toBeTruthy();
        expect(String(logoutCall?.[0])).toContain('/api/auth/health/logout');
        const init = logoutCall?.[1] as RequestInit | undefined;
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('include');

        // Local session state is also gone (clearSession ran).
        expect(AuthService.getUser()).toBeNull();
    });

    it('does NOT time out before the idle window elapses (no false-positive logout)', async () => {
        await AuthService.saveSession({
            user: { id: 'citizen-2', role: 'HEALTH', authType: 'HEALTH_ID' } as AuthUser,
        });

        const handles: ActivityHandles = { activityTimer: null };
        setupActivityTracking(AuthService, handles, 30);

        await jest.advanceTimersByTimeAsync(10 * 60 * 1000); // only 10 of 30 minutes
        for (let i = 0; i < 5; i++) { await Promise.resolve(); }

        const logoutCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/logout'));
        expect(logoutCall).toBeFalsy();
        expect(AuthService.getUser()).not.toBeNull();
    });
});
