import { logger } from '@/lib/logger';
import {
    checkIdentifierWithAuthApi,
    loginWithAuthApi,
    registerWithAuthApi,
    type LoginCredentials,
    type LoginOutcome,
    updateProfileWithAuthApi,
} from './auth-service-api';
import {
    decodeJwtToken,
    getJwtExpiry,
    getMsUntilJwtExpiry,
    isJwtExpired,
} from './auth-service-jwt';
import {
    clearLastActivity,
    clearRememberMe,
    clearStoredAuthSession,
    getRememberMe,
    getStoredAccessToken,
    getStoredUser,
    isProviderUser,
    saveRememberMe as saveRememberMeToStorage,
    setStoredAccessToken,
    setStoredUser,
    resolveSessionCookieKey,
} from './auth-service-session';
import {
    setupCrossTabSync,
    setupActivityTracking,
    updateLastActivity as activityUpdate,
    isSessionTimedOut as activityTimedOut,
    type ActivityHandles,
} from './auth-service-activity';
import {
    accountInactiveLoginUrl,
    isAccountInactiveBody,
    markAccountInactiveSignOut,
} from '../api/account-inactive';
import { isLoginRoute, resolveLoginRouteForPath } from '../constants/auth-routes';
import { hardNavigate } from '../navigation/hard-navigate';
import { claimWizardFor, forgetWizard } from '../wizard-session';
import {
    DEFAULT_CONFIG,
    type AuthConfig,
    type AuthEventCallback,
    type AuthEventType,
    type AuthUser,
    type JWTPayload,
    type SessionData,
} from './auth-service.types';

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

/**
 * Read the `csrf_token` value out of a document.cookie string.
 * Returns null when the cookie is absent. URL-decoded so the value matches the
 * raw cookie the backend's double-submit check compares against.
 */
export function readCsrfCookie(cookieString: string | null | undefined): string | null {
    if (!cookieString) return null;
    const match = cookieString.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    const value = match?.[1];
    return value ? decodeURIComponent(value) : null;
}

/**
 * Build the CSRF header map for a mutating request (e.g. logout), given a
 * document.cookie string. The backend csrf-middleware requires the double-submit
 * pair (cookie csrf_token === header x-csrf-token); without it logout 403s and
 * the server never revokes the session/JTI. Pure + side-effect-free for testing.
 */
export function buildLogoutHeaders(cookieString: string | null | undefined): Record<string, string> {
    const token = readCsrfCookie(cookieString);
    return token ? { 'x-csrf-token': token } : {};
}

/**
 * setTimeout treats delays above 2^31-1 ms (~24.8 days) as a 32-bit overflow
 * and fires the callback IMMEDIATELY. A long-lived token (e.g. the dev/E2E
 * fixture with exp years away) therefore triggered an instant refresh on
 * every page load — and with the backend down, that failed refresh wiped the
 * session (W1-CORE king bug). All refresh scheduling must clamp to this.
 */
export const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

/** Pure: ms until the refresh should fire — expiry minus buffer, clamped to [0, MAX_TIMEOUT_DELAY_MS]. */
export function computeRefreshDelayMs(msUntilExpiry: number, bufferMs: number): number {
    return Math.min(Math.max(0, msUntilExpiry - bufferMs), MAX_TIMEOUT_DELAY_MS);
}

/** Bounded backoff for INDETERMINATE refresh failures (network/5xx/timeout). */
export const REFRESH_RETRY_BASE_DELAY_MS = 30_000;
export const REFRESH_RETRY_MAX_DELAY_MS = 5 * 60_000;
export const REFRESH_RETRY_MAX_ATTEMPTS = 5;

/**
 * Longest a sign-out waits for POST /api/session/clear-cookie before it leaves
 * the page anyway. A full page load aborts that request, and the httpOnly
 * session cookies it was sent to remove then stay in the browser.
 */
export const SERVER_SESSION_CLEAR_WAIT_MS = 3_000;
// How long after its navigation to a login page returned a page counts as
// "on its way out" (later sign-outs do not navigate again). Only a de-duplication
// window: the destination never gets weaker (see sessionLeaveReason), so a later
// navigation after the window can only repeat the same destination.
const LEAVING_FOR_LOGIN_WINDOW_MS = 10_000;
// Each repeat of the same destination doubles the window (10 s, 20 s, 40 s …),
// so a very slow login page is not restarted forever by frequent 401s.
const LEAVING_FOR_LOGIN_MAX_WINDOW_MS = 5 * 60_000;

type SignOutReason = 'account_inactive' | 'expired';

/** Monotonic milliseconds: a wall-clock change must not stretch or cut the window. */
function monotonicNow(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

/**
 * Pure: delay before retry number `attempt` (0-based), or null once the retry
 * budget is exhausted. Exhaustion does NOT log the user out — the current
 * token stays; a genuine 401 on a real API call is what ends a dead session.
 */
export function computeRefreshRetryDelayMs(attempt: number): number | null {
    if (attempt >= REFRESH_RETRY_MAX_ATTEMPTS) return null;
    return Math.min(REFRESH_RETRY_BASE_DELAY_MS * 2 ** attempt, REFRESH_RETRY_MAX_DELAY_MS);
}

class AuthServiceClass {
    private config: AuthConfig;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private activityHandles: ActivityHandles = { activityTimer: null };
    private eventListeners: AuthEventCallback[] = [];
    private initialized = false;
    /** Consecutive INDETERMINATE refresh failures — resets on success/new session. */
    private refreshRetryCount = 0;

    // Incremented whenever the session identity changes (save/clear). An
    // in-flight refreshToken() snapshots this on entry and discards its
    // outcome if the session changed underneath it — a stale settle must
    // never clear a NEW session, emit session_expired after logout, or
    // resurrect a retry timer on a dead session.
    private sessionEpoch = 0;

    // True while a one-shot focus/visibility re-arm listener is registered
    // after the refresh retry budget is exhausted (long outage). The next
    // time the user returns to the tab we try one fresh refresh instead of
    // leaving them to be logged out by the next 401.
    private exhaustionRearmArmed = false;

    // Settles when the clear-cookie request of the last clearSession() has
    // answered or failed. See leaveForLogin().
    private serverSessionClear: Promise<void> = Promise.resolve();

    // The inactive-account sign-out in progress. A page usually has several
    // calls in flight, and each answers ACCOUNT_INACTIVE; they share one.
    private inactiveSignOut: Promise<void> | null = null;

    // The expired-session sign-out in progress; concurrent 401s share one, so
    // they send one clear-cookie request and navigate once.
    private expiredSignOut: Promise<void> | null = null;

    // Why the current session ended, strongest reason first: once an answer said
    // the account is inactive, every later sign-out of this session goes to the
    // page that says so, never to "expired". A new session (saveSession) clears it.
    private sessionLeaveReason: SignOutReason | null = null;

    // The navigation to a login page this page started, and when its
    // hardNavigate() call returned (monotonic ms). A browser may hold that call
    // on a "leave this page?" dialog, so the window starts when it returns. The
    // user may also stay, which cancels the navigation; the window then runs out
    // and a later sign-out may navigate again (to the same, or a stronger, place).
    private currentLeave: { reason: SignOutReason; at: number; windowMs: number } | null = null;

    private readonly exhaustionRearmHandler = (): void => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        this.disarmExhaustionRearm();
        if (!this.getToken()) return;
        this.refreshRetryCount = 0;
        void this.refreshToken();
    };

    private disarmExhaustionRearm(): void {
        if (!this.exhaustionRearmArmed || !this.isBrowser()) return;
        this.exhaustionRearmArmed = false;
        window.removeEventListener('focus', this.exhaustionRearmHandler);
        document.removeEventListener('visibilitychange', this.exhaustionRearmHandler);
    }

    constructor(config: Partial<AuthConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    private normalizeUser(user?: AuthUser | null): AuthUser | null {
        if (!user || typeof user !== 'object') {
            return null;
        }

        const normalizedPhone = typeof user.phone === 'string' && user.phone.trim()
            ? user.phone
            : (typeof user.phoneNumber === 'string' ? user.phoneNumber : undefined);

        if (!normalizedPhone) {
            return user;
        }

        return {
            ...user,
            phone: normalizedPhone,
            phoneNumber: normalizedPhone,
        };
    }

    async login(credentials: LoginCredentials): Promise<LoginOutcome> {
        return loginWithAuthApi(credentials, (data) => this.saveSession(data));
    }

    async register(data: unknown): Promise<{ success: boolean; error?: string | undefined; data?: unknown }> {
        return registerWithAuthApi(data);
    }

    async checkIdentifier(identifier: string): Promise<{ available: boolean; error?: string | undefined }> {
        return checkIdentifierWithAuthApi(identifier);
    }

    async updateProfile(data: Partial<AuthUser>): Promise<{ success: boolean; error?: string; data?: AuthUser }> {
        return updateProfileWithAuthApi(data, {
            normalizeUser: (user) => this.normalizeUser(user),
            getUser: () => this.getUser(),
            updateUser: (user) => this.updateUser(user),
            emitLogin: (user) => this.emit('login', { user }),
        });
    }

    initialize(): void {
        if (this.initialized || !this.isBrowser()) return;

        this.initialized = true;

        if (this.config.enableCrossTabSync) {
            setupCrossTabSync(this);
        }

        if (this.config.enableSessionTimeout) {
            setupActivityTracking(this, this.activityHandles, this.config.sessionTimeoutMinutes);
        }

        if (this.isAuthenticated()) {
            this.scheduleTokenRefresh();
        }

        if (isDev) {
            logger.info('[AuthService] Initialized with config:', {
                sessionTimeout: this.config.sessionTimeoutMinutes,
                crossTabSync: this.config.enableCrossTabSync,
            });
        }
    }

    isBrowser(): boolean {
        return typeof window !== 'undefined';
    }

    emit(event: AuthEventType, data?: unknown): void {
        this.eventListeners.forEach(cb => cb(event, data));
        this.config.onAuthEvent?.(event, data);
    }

    onAuthChange(callback: AuthEventCallback): () => void {
        this.eventListeners.push(callback);
        return () => {
            this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
        };
    }

    decodeToken(token?: string): JWTPayload | null {
        return decodeJwtToken(token || this.getToken());
    }

    getTokenExpiry(): number | null {
        return getJwtExpiry(this.getToken());
    }

    isTokenExpired(): boolean {
        return isJwtExpired(this.getToken());
    }

    getTimeUntilExpiry(): number {
        return getMsUntilJwtExpiry(this.getToken());
    }

    async saveSession(data: SessionData): Promise<void> {
        if (!this.isBrowser()) return;

        // New session identity: invalidate any in-flight refresh settle from
        // the previous session and reset the retry/re-arm machinery.
        this.sessionEpoch += 1;
        this.refreshRetryCount = 0;
        this.disarmExhaustionRearm();
        this.sessionLeaveReason = null;
        this.currentLeave = null;

        const accessToken = data.tokens?.accessToken || data.accessToken || data.token;
        const refreshToken = data.tokens?.refreshToken || data.refreshToken;
        const normalizedUser = this.normalizeUser(data.user || null);
        const cookieKey = resolveSessionCookieKey(normalizedUser || data.user || null);
        const isProviderAccount = isProviderUser(normalizedUser || data.user || null);

        // Round 5 minor 2 (privacy) + 5b: the application wizard's answers (store +
        // IndexedDB) carry the id of the user who typed them. A sign-in by anyone else
        // empties them, so the next person on a shared device does not rehydrate the
        // previous person's filing. Decided by that stamp, NOT by `priorUser`: an expiry or
        // an idle timeout clears the stored user too, and the same person signing back in
        // must get their unsent edit back.
        const signedInId = normalizedUser?.id ?? (data.user as { id?: unknown } | undefined)?.id;
        if (signedInId !== undefined && signedInId !== null && String(signedInId) !== '') {
            await claimWizardFor(String(signedInId));
        }

        if (accessToken) {
            setStoredAccessToken(accessToken);

            try {
                await fetch('/api/session/set-cookie', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: accessToken, cookieName: cookieKey }),
                    credentials: 'include',
                });
            } catch (e) {
                logger.warn('[AuthService] Failed to set server-side cookie:', e);
            }
        }

        if (normalizedUser) {
            setStoredUser(normalizedUser);
        }

        this.updateLastActivity();
        this.scheduleTokenRefresh();
        this.emit('login', { user: normalizedUser || data.user });

        if (isDev) {
            logger.info('[AuthService] Session saved:', {
                hasAccessToken: !!accessToken,
                hasRefreshToken: !!refreshToken,
                isProviderUser: isProviderAccount,
            });
        }
    }

    getToken(): string | null {
        if (!this.isBrowser()) return null;
        return getStoredAccessToken();
    }

    getUser(): AuthUser | null {
        if (!this.isBrowser()) return null;
        return this.normalizeUser(getStoredUser());
    }

    updateUser(user: AuthUser): void {
        if (!this.isBrowser()) return;
        const normalizedUser = this.normalizeUser(user) || user;
        setStoredUser(normalizedUser);
    }

    isAuthenticated(): boolean {
        const token = this.getToken();
        const user = this.getUser();

        const hasIdentity = Boolean(user?.healthId || user?.providerId || user?.id);
        if (!token || !hasIdentity) return false;

        if (this.isTokenExpired()) {
            if (isDev) { logger.info('[AuthService] Token expired'); }
            return false;
        }

        return true;
    }

    clearSession(): void {
        if (!this.isBrowser()) return;

        if (this.activityHandles.activityTimer) {
            clearTimeout(this.activityHandles.activityTimer);
            this.activityHandles.activityTimer = null;
        }

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        this.sessionEpoch += 1;
        this.refreshRetryCount = 0;
        this.disarmExhaustionRearm();

        clearStoredAuthSession();
        clearLastActivity();

        document.cookie = 'auth_token=; path=/; max-age=0';
        document.cookie = 'provider_token=; path=/; max-age=0';
        document.cookie = 'refresh_token=; path=/; max-age=0';
        document.cookie = 'csrf_token=; path=/; max-age=0';

        this.serverSessionClear = fetch('/api/session/clear-cookie', {
            method: 'POST',
            credentials: 'include',
        }).then(() => undefined, () => {
            if (isDev) {
                logger.warn('[AuthService] Failed to clear server-side cookies');
            }
        });

        this.emit('logout');

        if (isDev) { logger.info('[AuthService] Session cleared'); }
    }

    /**
     * Full page load to this session's login page, once the server-side session
     * cookies of the last clearSession() are gone (or after
     * SERVER_SESSION_CLEAR_WAIT_MS).
     *
     * Navigating straight away aborts the clear-cookie request. The officer's
     * httpOnly provider_token then reaches the login page, and middleware.ts
     * sends a cookied officer from there back to the dashboard.
     *
     * The destination follows sessionLeaveReason as it stands AFTER the wait, so
     * an ACCOUNT_INACTIVE answer that arrives meanwhile upgrades an "expired"
     * sign-out to the page that says why. A navigation already under way is not
     * repeated unless the reason got stronger.
     */
    private async leaveForLogin(currentPath: string): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, SERVER_SESSION_CLEAR_WAIT_MS);
        });
        try {
            await Promise.race([this.serverSessionClear, timeout]);
        } finally {
            clearTimeout(timer);
        }

        const reason = this.sessionLeaveReason ?? 'expired';
        const leave = this.currentLeave;
        const underWay = leave !== null && monotonicNow() - leave.at < leave.windowMs;
        if (underWay && (leave.reason === reason || reason === 'expired')) return;
        const windowMs = leave !== null && !underWay && leave.reason === reason
            ? Math.min(leave.windowMs * 2, LEAVING_FOR_LOGIN_MAX_WINDOW_MS)
            : LEAVING_FOR_LOGIN_WINDOW_MS;

        let url: string;
        if (reason === 'account_inactive') {
            // Set right before leaving: middleware uses it to clear session cookies
            // the clear-cookie request could not remove, and the login page to say why.
            markAccountInactiveSignOut();
            url = accountInactiveLoginUrl(currentPath);
        } else {
            url = `${resolveLoginRouteForPath(currentPath)}?expired=true`;
        }
        this.currentLeave = { reason, at: monotonicNow(), windowMs };
        hardNavigate(url);
        // hardNavigate may have waited on a "leave this page?" dialog; count the
        // window from now, not from before the dialog.
        this.currentLeave = { reason, at: monotonicNow(), windowMs };
    }

    /**
     * The account behind this session is suspended or deleted (ACCOUNT_INACTIVE),
     * so nothing done with the session will succeed again. End it the way a
     * refused refresh does, then leave for the portal's login page, which says
     * why (lib/api/account-inactive.ts). Nothing to leave when already on a
     * login page. Calls made while one is in progress join it.
     */
    endInactiveAccountSession(): Promise<void> {
        // Recorded synchronously, so a sign-out already waiting sees it.
        this.sessionLeaveReason = 'account_inactive';
        if (!this.inactiveSignOut) {
            const signOut = this.signOutInactiveAccount().catch((error: unknown) => {
                logger.warn('[AuthService] Inactive-account sign-out failed:', error);
            }).finally(() => {
                this.inactiveSignOut = null;
            });
            this.inactiveSignOut = signOut;
        }
        return this.inactiveSignOut;
    }

    private async signOutInactiveAccount(): Promise<void> {
        this.clearSession();
        this.emit('session_expired');
        if (!this.isBrowser()) return;
        const currentPath = window.location.pathname;
        if (isLoginRoute(currentPath)) return;
        await this.leaveForLogin(currentPath);
    }

    /**
     * A call answered 401: the session is over. Clear it and leave for the
     * portal's login page — with `?expired=true`, unless this session is already
     * known to belong to an inactive account. Concurrent 401s share one sign-out.
     */
    endExpiredSession(): Promise<void> {
        if (this.inactiveSignOut) return this.inactiveSignOut;
        if (!this.expiredSignOut) {
            this.expiredSignOut = this.signOutExpiredSession().catch((error: unknown) => {
                logger.warn('[AuthService] Expired-session sign-out failed:', error);
            }).finally(() => {
                this.expiredSignOut = null;
            });
        }
        return this.expiredSignOut;
    }

    private async signOutExpiredSession(): Promise<void> {
        // The inactive-account sign-out removed that session from storage. A session
        // stored since then is someone's new sign-in — in another tab, which shares
        // storage but never runs this tab's saveSession() — and its expiry is just
        // an expiry, not a suspension (never tell another user their account is
        // suspended).
        if (this.sessionLeaveReason === 'account_inactive' && this.hasStoredSession()) {
            this.sessionLeaveReason = null;
            this.currentLeave = null;
        }
        if (this.sessionLeaveReason === null) this.sessionLeaveReason = 'expired';
        this.clearSession();
        if (!this.isBrowser()) return;
        const currentPath = window.location.pathname;
        if (isLoginRoute(currentPath)) return;
        await this.leaveForLogin(currentPath);
    }

    private hasStoredSession(): boolean {
        return this.getToken() !== null || getStoredUser() !== null;
    }

    /** Tests only: the singleton outlives a test, and a real page would have unloaded. */
    __resetSignOutStateForTests(): void {
        this.inactiveSignOut = null;
        this.expiredSignOut = null;
        this.sessionLeaveReason = null;
        this.currentLeave = null;
    }

    private scheduleTokenRefresh(): void {
        if (!this.isBrowser()) return;

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        const user = this.getUser();
        if (isProviderUser(user)) {
            return;
        }

        const timeUntilExpiry = this.getTimeUntilExpiry();
        if (timeUntilExpiry <= 0) return;

        // Fresh schedule for a (re)established session — reset the backoff budget.
        this.refreshRetryCount = 0;

        const bufferMs = this.config.tokenRefreshBufferMinutes * 60 * 1000;
        // Clamped: an unclamped multi-year delay overflows setTimeout's 32-bit
        // signed int and fires IMMEDIATELY (the W1-CORE king-bug trigger).
        const refreshIn = computeRefreshDelayMs(timeUntilExpiry, bufferMs);

        if (refreshIn > 0) {
            this.refreshTimer = setTimeout(() => {
                this.refreshToken();
            }, refreshIn);

            if (isDev) { logger.info('[AuthService] Token refresh scheduled in', Math.round(refreshIn / 1000 / 60), 'minutes'); }
        }
    }

    /**
     * INDETERMINATE refresh failure (network/5xx/timeout): the current access
     * token may still be perfectly valid, so the session is kept and the
     * refresh is retried with bounded exponential backoff. Once the budget is
     * exhausted we stop retrying — a genuine 401 on a real API call (handled
     * by api-client) is the only thing that ends a session after that.
     */
    private scheduleRefreshRetry(): void {
        if (!this.isBrowser()) return;

        // A dead session must never keep a retry loop alive (e.g. an
        // in-flight refresh settling indeterminately after logout).
        if (!this.getToken()) return;

        const delay = computeRefreshRetryDelayMs(this.refreshRetryCount);
        if (delay === null) {
            if (isDev) { logger.warn('[AuthService] Refresh retry budget exhausted; keeping session'); }
            // Long outage: re-arm ONE fresh refresh attempt the next time the
            // user returns to the tab, so a recovered backend re-establishes
            // the session instead of the next API 401 forcing a logout.
            if (!this.exhaustionRearmArmed) {
                this.exhaustionRearmArmed = true;
                window.addEventListener('focus', this.exhaustionRearmHandler);
                document.addEventListener('visibilitychange', this.exhaustionRearmHandler);
            }
            return;
        }

        this.refreshRetryCount += 1;

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            void this.refreshToken();
        }, delay);

        if (isDev) { logger.info('[AuthService] Refresh retry scheduled in', Math.round(delay / 1000), 'seconds'); }
    }

    async refreshToken(): Promise<boolean> {
        const user = this.getUser();
        if (isProviderUser(user)) {
            if (isDev) {
                logger.info('[AuthService] Provider session refresh is disabled');
            }
            return false;
        }

        // Snapshot the session identity: if it changes while the fetch is in
        // flight (logout, or logout + new login), the settle below must be a
        // no-op — no clear, no emit, no reschedule.
        const epochAtStart = this.sessionEpoch;

        try {
            const response = await fetch('/api/auth/health/refresh', {
                method: 'POST',
                credentials: 'include',
            });

            if (epochAtStart !== this.sessionEpoch) return false;

            // DEFINITIVE rejection: the auth server saw the refresh credential
            // and refused it. This is the ONLY failure allowed to end the session.
            if (response.status === 401 || response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                if (epochAtStart !== this.sessionEpoch) return false;
                logger.error('[AuthService] Refresh rejected by auth server:', errorData);
                // A suspended or deleted account: say so on the login page, the
                // same way api-client does, instead of letting the next call
                // report an expired session.
                if (isAccountInactiveBody(errorData)) {
                    void this.endInactiveAccountSession();
                    return false;
                }
                this.clearSession();
                this.emit('session_expired');
                return false;
            }

            // INDETERMINATE: 5xx / gateway error / backend unreachable. The
            // stored token may still be valid — keep the session, retry later.
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (epochAtStart !== this.sessionEpoch) return false;
                logger.warn('[AuthService] Refresh unavailable (keeping session):', errorData);
                this.scheduleRefreshRetry();
                return false;
            }

            const data = await response.json() as {
                success?: boolean;
                data?: { accessToken?: string };
            };

            if (epochAtStart !== this.sessionEpoch) return false;

            if (data.success && data.data?.accessToken) {
                this.refreshRetryCount = 0;
                setStoredAccessToken(data.data.accessToken);
                this.scheduleTokenRefresh();
                this.emit('token_refresh');
                if (isDev) { logger.info('[AuthService] Token refreshed successfully'); }
                return true;
            }

            // Malformed 2xx body — a proxy/backend bug, not proof of expiry.
            logger.warn('[AuthService] Invalid refresh response (keeping session)');
            this.scheduleRefreshRetry();
            return false;
        } catch (error: unknown) {
            if (epochAtStart !== this.sessionEpoch) return false;
            // Network error / timeout — INDETERMINATE by definition.
            logger.warn('[AuthService] Refresh network failure (keeping session):', error);
            this.scheduleRefreshRetry();
            return false;
        }
    }

    updateLastActivity(): void {
        activityUpdate(this, this.activityHandles, this.config.sessionTimeoutMinutes);
    }

    isSessionTimedOut(): boolean {
        return activityTimedOut(this.config.sessionTimeoutMinutes);
    }

    saveRememberMe(accountType: string, identifier: string): void {
        if (!this.isBrowser()) return;
        saveRememberMeToStorage(accountType, identifier);
    }

    getRememberMe(): { accountType: string; identifier: string } | null {
        if (!this.isBrowser()) return null;
        return getRememberMe();
    }

    clearRememberMe(): void {
        if (!this.isBrowser()) return;
        clearRememberMe();
    }

    // Double-submit CSRF: mint a `csrf_token` cookie if this session never
    // seeded one, so the logout POST can carry a matching x-csrf-token header
    // (else the backend csrf-middleware 403s and the session/JTI is never
    // revoked server-side). Mirrors apiClient.getCsrfToken's mint pattern.
    private mintCsrfCookie(): void {
        if (!this.isBrowser()) return;
        try {
            const minted = (typeof globalThis.crypto?.randomUUID === 'function')
                ? globalThis.crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            document.cookie = `csrf_token=${minted}; path=/; SameSite=Lax`;
        } catch {
            // ignore — logout still proceeds and clears the local session
        }
    }

    /**
     * @param options.keepWizard the idle timeout passes true: it is an expiry, not someone
     *   choosing to leave, and the same person signing back in keeps their unsent edit
     *   (round 5b). A sign-in by someone else still empties it (claimWizardFor).
     */
    async logout(callApi = true, options: { keepWizard?: boolean } = {}): Promise<void> {
        if (callApi) {
            try {
                const user = this.getUser();
                const logoutEndpoint = isProviderUser(user)
                    ? '/api/auth/provider/logout'
                    : '/api/auth/health/logout';
                // Ensure a csrf_token cookie exists, then send the matching header
                // so the backend accepts the mutation and revokes the session/JTI.
                if (this.isBrowser() && !readCsrfCookie(document.cookie)) {
                    this.mintCsrfCookie();
                }
                await fetch(logoutEndpoint, {
                    method: 'POST',
                    credentials: 'include',
                    headers: buildLogoutHeaders(this.isBrowser() ? document.cookie : null),
                });
            } catch {
            }
        }
        this.clearSession();
        // Round 5 minor 2 (privacy): an explicit logout also empties the application wizard
        // (store + IndexedDB `gacp_application_flow_state_v4`); it used to survive for the
        // next user.
        if (!options.keepWizard) { await forgetWizard(); }
    }
}

export const AuthService = new AuthServiceClass();

export { AuthServiceClass };

export type {
    AuthConfig,
    AuthEventCallback,
    AuthEventType,
    AuthUser,
    SessionData,
} from './auth-service.types';
