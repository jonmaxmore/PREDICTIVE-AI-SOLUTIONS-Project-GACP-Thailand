/**
 * A2 (UAT) — logout POST returned 403 CSRF_MISMATCH because the fetch carried
 * NO x-csrf-token header. The backend csrf-middleware requires the double-submit
 * pair (cookie csrf_token === header x-csrf-token) on every mutation, so logout
 * 403'd and the server never revoked the session/JTI (it failed soft: the local
 * session cleared and the UI redirected, masking the server-side leak).
 *
 * Fix: logout() now sends x-csrf-token equal to the csrf_token cookie (minting
 * the cookie if the session never seeded one), mirroring apiClient.getCsrfToken.
 *
 * Note: logout() fires TWO fetches — the auth logout endpoint (/…/logout) then
 * clearSession()'s /api/session/clear-cookie — and clearSession wipes the
 * csrf_token cookie afterwards, so the test captures the /logout call's init and
 * the cookie snapshot AT fetch time.
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';

// Keep the (heavy, api-client-coupled) login graph out of this unit —
// we only exercise logout(), which touches neither.
jest.mock('../../api/api-client', () => ({
    apiClient: { post: jest.fn(), get: jest.fn() },
}));

import { AuthService, buildLogoutHeaders } from '../auth-service';

function clearAllCookies(): void {
    for (const c of document.cookie.split(';')) {
        const name = c.split('=')[0].trim();
        if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
}

describe('buildLogoutHeaders (pure helper)', () => {
    it('extracts x-csrf-token from the csrf_token cookie value', () => {
        expect(buildLogoutHeaders('foo=1; csrf_token=tok-xyz; bar=2')).toEqual({ 'x-csrf-token': 'tok-xyz' });
    });

    it('returns empty headers when no csrf_token cookie is present', () => {
        expect(buildLogoutHeaders('foo=1; bar=2')).toEqual({});
        expect(buildLogoutHeaders('')).toEqual({});
        expect(buildLogoutHeaders(null)).toEqual({});
    });

    it('url-decodes the token so it matches the raw cookie value (double-submit)', () => {
        expect(buildLogoutHeaders('csrf_token=a%2Bb')).toEqual({ 'x-csrf-token': 'a+b' });
    });
});

describe('AuthService.logout — CSRF double-submit', () => {
    let fetchMock: jest.Mock;
    let logoutInit: RequestInit | null;
    let logoutUrl: string;
    let cookieAtLogout: string;

    beforeEach(() => {
        clearAllCookies();
        logoutInit = null;
        logoutUrl = '';
        cookieAtLogout = '';
        fetchMock = jest.fn().mockImplementation((url: string, init: RequestInit) => {
            if (String(url).includes('/logout')) {
                logoutUrl = String(url);
                logoutInit = init;
                cookieAtLogout = document.cookie; // before clearSession wipes csrf_token
            }
            return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        });
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        clearAllCookies();
    });

    it('sends x-csrf-token equal to the csrf_token cookie value on the logout POST', async () => {
        document.cookie = 'csrf_token=tok-abc-123; path=/';

        await AuthService.logout(true);

        expect(logoutInit).not.toBeNull();
        expect(logoutUrl).toContain('/logout');
        expect(logoutInit!.method).toBe('POST');
        expect(logoutInit!.credentials).toBe('include');
        const headers = logoutInit!.headers as Record<string, string> | undefined;
        expect(headers?.['x-csrf-token']).toBe('tok-abc-123'); // pre-fix: undefined (RED)
    });

    it('mints a csrf_token cookie and sends a matching header when the session never seeded one', async () => {
        // No csrf_token cookie exists (un-seeded session).
        expect(document.cookie).not.toContain('csrf_token=');

        await AuthService.logout(true);

        expect(logoutInit).not.toBeNull();
        const headers = logoutInit!.headers as Record<string, string> | undefined;
        const sent = headers?.['x-csrf-token'];
        expect(sent).toBeTruthy(); // pre-fix: undefined (RED)
        // The header MUST equal the (minted) cookie value at fetch time — the
        // double-submit invariant.
        const cookieVal = cookieAtLogout.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
        expect(cookieVal).toBe(sent);
    });
});
