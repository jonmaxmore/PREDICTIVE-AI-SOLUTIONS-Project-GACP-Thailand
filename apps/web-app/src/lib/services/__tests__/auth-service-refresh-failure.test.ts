/**
 * W1-CORE — a FAILED token refresh must not wipe the session unless the
 * auth server DEFINITIVELY rejected the refresh credential.
 *
 * The king bug: with the backend down, /api/auth/health/refresh returns 503
 * and the old refreshToken() treated EVERY failure as "session dead" —
 * clearSession() wiped localStorage + cookies (POST /api/session/clear-cookie)
 * and emitted session_expired, kicking a validly-logged-in farmer to login.
 *
 * Contract:
 *  - DEFINITIVE rejection (HTTP 401/403 from the refresh endpoint)
 *      → clear session, emit session_expired.
 *  - INDETERMINATE failure (network error, 5xx, timeout, malformed body)
 *      → KEEP the current token (it may still be valid; genuine 401s on real
 *        API calls handle true expiry) and schedule a bounded backoff retry.
 *  - scheduleTokenRefresh must clamp its delay: a far-future exp overflows
 *    setTimeout's 32-bit signed delay and fires IMMEDIATELY, which is what
 *    triggered the refresh (and the wipe) on every page load.
 */

import {
    AuthServiceClass,
    computeRefreshDelayMs,
    computeRefreshRetryDelayMs,
    MAX_TIMEOUT_DELAY_MS,
    REFRESH_RETRY_BASE_DELAY_MS,
    REFRESH_RETRY_MAX_ATTEMPTS,
} from '../auth-service';

/* ── helpers ─────────────────────────────────────────────────────────── */

function b64url(obj: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// 3-part JWT, exp 1900000000 (far future) — matches the live-probe session.
const FAKE_JWT = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ userId: 'u-1', role: 'HEALTH', exp: 1900000000 })}.sig`;

const FAKE_USER = JSON.stringify({
    id: 'u-1',
    healthId: 'HID-001',
    firstName: 'Somchai',
    lastName: 'Tester',
    email: 'somchai@example.com',
    role: 'HEALTH',
});

function installMemoryStorage(): Map<string, string> {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
        value: {
            getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            clear: () => { store.clear(); },
        },
        writable: true,
        configurable: true,
    });
    store.set('accessToken', FAKE_JWT);
    store.set('user', FAKE_USER);
    return store;
}

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(refreshResponse: () => Promise<Partial<Response>> | Partial<Response>): FetchCall[] {
    const calls: FetchCall[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('/api/auth/health/refresh')) {
            return refreshResponse();
        }
        // clear-cookie / set-cookie side channels always "succeed"
        return { ok: true, status: 200, json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;
    return calls;
}

function trackEvents(svc: AuthServiceClass): string[] {
    const events: string[] = [];
    svc.onAuthChange((event) => events.push(event));
    return events;
}

/* ── indeterminate failures keep the session ─────────────────────────── */

describe('refreshToken() on INDETERMINATE failure (5xx / network)', () => {
    let store: Map<string, string>;

    beforeEach(() => {
        jest.useFakeTimers();
        store = installMemoryStorage();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('503 keeps token + user, does NOT clear the cookie, does NOT emit session_expired', async () => {
        const calls = installFetchMock(() => ({
            ok: false,
            status: 503,
            json: async () => ({ success: false, error: 'Auth service unavailable', code: 'BACKEND_UNREACHABLE' }),
        }));
        const svc = new AuthServiceClass();
        const events = trackEvents(svc);

        const result = await svc.refreshToken();

        expect(result).toBe(false);
        expect(store.get('accessToken')).toBe(FAKE_JWT);
        expect(store.get('user')).toBe(FAKE_USER);
        expect(calls.some((c) => c.url.includes('/api/session/clear-cookie'))).toBe(false);
        expect(events).not.toContain('session_expired');
        expect(events).not.toContain('logout');
    });

    it('network error (fetch rejects) keeps token + user, no cookie clear, no session_expired', async () => {
        const calls = installFetchMock(() => Promise.reject(new TypeError('Failed to fetch')));
        const svc = new AuthServiceClass();
        const events = trackEvents(svc);

        const result = await svc.refreshToken();

        expect(result).toBe(false);
        expect(store.get('accessToken')).toBe(FAKE_JWT);
        expect(store.get('user')).toBe(FAKE_USER);
        expect(calls.some((c) => c.url.includes('/api/session/clear-cookie'))).toBe(false);
        expect(events).not.toContain('session_expired');
    });

    it('malformed 2xx body keeps the session (backend/proxy bug is not proof of expiry)', async () => {
        const calls = installFetchMock(() => ({
            ok: true,
            status: 200,
            json: async () => ({ weird: true }),
        }));
        const svc = new AuthServiceClass();
        const events = trackEvents(svc);

        const result = await svc.refreshToken();

        expect(result).toBe(false);
        expect(store.get('accessToken')).toBe(FAKE_JWT);
        expect(calls.some((c) => c.url.includes('/api/session/clear-cookie'))).toBe(false);
        expect(events).not.toContain('session_expired');
    });

    it('503 schedules a bounded backoff retry that re-attempts the refresh', async () => {
        const calls = installFetchMock(() => ({
            ok: false,
            status: 503,
            json: async () => ({ success: false, error: 'Auth service unavailable' }),
        }));
        const svc = new AuthServiceClass();

        const refreshCalls = () => calls.filter((c) => c.url.includes('/api/auth/health/refresh')).length;

        await svc.refreshToken();
        expect(refreshCalls()).toBe(1);

        // First retry fires after the base delay — exactly one more attempt.
        await jest.advanceTimersByTimeAsync(REFRESH_RETRY_BASE_DELAY_MS + 1000);
        expect(refreshCalls()).toBe(2);

        // Bounded: even hours later the total attempts never exceed
        // 1 initial + REFRESH_RETRY_MAX_ATTEMPTS retries.
        await jest.advanceTimersByTimeAsync(6 * 60 * 60_000);
        expect(refreshCalls()).toBeLessThanOrEqual(1 + REFRESH_RETRY_MAX_ATTEMPTS);
        expect(computeRefreshRetryDelayMs(REFRESH_RETRY_MAX_ATTEMPTS)).toBeNull();

        // Session still intact throughout.
        expect(store.get('accessToken')).toBe(FAKE_JWT);
        expect(calls.some((c) => c.url.includes('/api/session/clear-cookie'))).toBe(false);
    });
});

/* ── definitive rejection clears the session ─────────────────────────── */

describe('refreshToken() on DEFINITIVE rejection (401/403)', () => {
    let store: Map<string, string>;

    beforeEach(() => {
        jest.useFakeTimers();
        store = installMemoryStorage();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('401 clears the session, POSTs clear-cookie, emits session_expired', async () => {
        const calls = installFetchMock(() => ({
            ok: false,
            status: 401,
            json: async () => ({ success: false, error: 'Invalid refresh token' }),
        }));
        const svc = new AuthServiceClass();
        const events = trackEvents(svc);

        const result = await svc.refreshToken();

        expect(result).toBe(false);
        expect(store.has('accessToken')).toBe(false);
        expect(store.has('user')).toBe(false);
        expect(calls.some((c) => c.url.includes('/api/session/clear-cookie'))).toBe(true);
        expect(events).toContain('session_expired');
    });

    it('403 also counts as definitive rejection', async () => {
        installFetchMock(() => ({
            ok: false,
            status: 403,
            json: async () => ({ success: false, error: 'Refresh forbidden' }),
        }));
        const svc = new AuthServiceClass();
        const events = trackEvents(svc);

        const result = await svc.refreshToken();

        expect(result).toBe(false);
        expect(store.has('accessToken')).toBe(false);
        expect(events).toContain('session_expired');
    });
});

/* ── setTimeout overflow clamp (the trigger of the king bug) ─────────── */

describe('computeRefreshDelayMs — no 32-bit setTimeout overflow', () => {
    it('clamps a far-future expiry (years away) to the max safe delay', () => {
        const yearsAwayMs = 3.6 * 365 * 24 * 60 * 60 * 1000; // ~ the probe token
        const delay = computeRefreshDelayMs(yearsAwayMs, 5 * 60_000);
        expect(delay).toBe(MAX_TIMEOUT_DELAY_MS);
        expect(delay).toBeLessThanOrEqual(2_147_483_647);
    });

    it('returns expiry minus buffer for normal-lifetime tokens', () => {
        expect(computeRefreshDelayMs(15 * 60_000, 5 * 60_000)).toBe(10 * 60_000);
    });

    it('never returns a negative delay', () => {
        expect(computeRefreshDelayMs(60_000, 5 * 60_000)).toBe(0);
    });
});
