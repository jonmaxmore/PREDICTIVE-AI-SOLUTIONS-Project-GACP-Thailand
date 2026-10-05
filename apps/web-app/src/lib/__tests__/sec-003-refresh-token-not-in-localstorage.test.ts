/**
 * SEC-003 — refresh token must NOT be mirrored to localStorage.
 *
 * The httpOnly refresh_token cookie is set server-side at login. The frontend
 * relies entirely on that cookie (sent via credentials:'include') and must
 * never write the refresh token value to localStorage where XSS can read it.
 *
 * Three invariants:
 *  A) auth-service-session no longer exports get/setStoredRefreshToken
 *  B) refreshToken() posts with credentials:'include' and no refresh-token body
 *  C) saveSession() (called at login) no longer writes refreshToken to localStorage
 */

import * as session from '../services/auth-service-session';
import { AuthService } from '../services/auth-service';

/* ── A: surface-area check ──────────────────────────────────────────── */

describe('SEC-003 session module surface area', () => {
    it('does NOT export getStoredRefreshToken', () => {
        expect((session as Record<string, unknown>).getStoredRefreshToken).toBeUndefined();
    });

    it('does NOT export setStoredRefreshToken', () => {
        expect((session as Record<string, unknown>).setStoredRefreshToken).toBeUndefined();
    });

    it('clearStoredAuthSession still removes the refreshToken key (migration eviction)', () => {
        const removedKeys: string[] = [];
        const mockStorage = {
            removeItem: (k: string) => removedKeys.push(k),
            getItem: jest.fn(() => null),
            setItem: jest.fn(),
        };
        Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true, configurable: true });
        session.clearStoredAuthSession();
        expect(removedKeys).toContain('refreshToken');
    });
});

/* ── B: network call is cookie-only ────────────────────────────────── */

describe('SEC-003 refreshToken() uses cookie, not localStorage body', () => {
    beforeEach(() => {
        // Stub localStorage so session helpers don't throw.
        Object.defineProperty(window, 'localStorage', {
            value: { getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn() },
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('posts credentials:include with no refreshToken body field', async () => {
        let capturedInit: RequestInit | undefined;
        const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
            capturedInit = init;
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true, data: { accessToken: 'new-tok' } }),
            });
        }) as jest.MockedFunction<typeof fetch>;
        global.fetch = fetchMock;

        await AuthService.refreshToken();

        expect(capturedInit?.credentials).toBe('include');

        if (capturedInit?.body) {
            const parsed = JSON.parse(capturedInit.body as string) as Record<string, unknown>;
            expect(parsed).not.toHaveProperty('refreshToken');
        }
        // No body at all is the preferred outcome — the cookie carries the token.
    });

    it('does NOT write refreshToken to localStorage on successful refresh', async () => {
        const setItemKeys: string[] = [];
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: jest.fn(() => null),
                setItem: (k: string) => setItemKeys.push(k),
                removeItem: jest.fn(),
            },
            writable: true,
            configurable: true,
        });

        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true, data: { accessToken: 'tok' } }),
            }),
        ) as jest.MockedFunction<typeof fetch>;

        await AuthService.refreshToken();

        // Only accessToken may be written; refresh token must not.
        expect(setItemKeys).not.toContain('refreshToken');
    });
});
