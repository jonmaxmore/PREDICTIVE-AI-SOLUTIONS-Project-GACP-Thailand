/**
 * Auth Activity Tracking & Cross-Tab Sync
 *
 * Manages inactivity timeouts and cross-tab login/logout detection.
 * Extracted from AuthService to keep the main class under the 400-line warning.
 */
import { logger } from '@/lib/logger';
import { STORAGE_KEYS } from './auth-service.types';
import {
    getLastActivity,
    setLastActivity,
    resolveLoginPath,
} from './auth-service-session';

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

/** Callbacks the hosting AuthService must supply. */
export interface ActivityHost {
    isBrowser(): boolean;
    isAuthenticated(): boolean;
    getUser(): unknown;
    logout(callApi?: boolean, options?: { keepWizard?: boolean }): Promise<void>;
    emit(event: string, data?: unknown): void;
}

/** Persistent handles returned so the host can clear timers on session teardown. */
export interface ActivityHandles {
    activityTimer: ReturnType<typeof setTimeout> | null;
}

/* ── Cross-tab sync ── */

export function setupCrossTabSync(host: ActivityHost): void {
    if (!host.isBrowser()) return;

    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEYS.ACCESS_TOKEN && !e.newValue) {
            if (isDev) { logger.info('[AuthService] Logout detected from another tab'); }
            host.emit('tab_sync', { action: 'logout' });

            const user = host.getUser() as Parameters<typeof resolveLoginPath>[0];
            const loginPath = resolveLoginPath(user, window.location.pathname);
            if (window.location.pathname !== loginPath) {
                window.location.href = loginPath;
            }
        }

        if (e.key === STORAGE_KEYS.ACCESS_TOKEN && e.newValue && !e.oldValue) {
            if (isDev) { logger.info('[AuthService] Login detected from another tab'); }
            host.emit('tab_sync', { action: 'login' });
        }
    });
}

/* ── Activity tracking ── */

/**
 * Item 3 (council final-fix round): the idle timer must arm for a
 * cookie-only session (ThaID: `saveSession({ user })`, no accessToken —
 * "session = httpOnly cookie เท่านั้น", auth-idp.js). `host.isAuthenticated()`
 * requires a stored localStorage TOKEN (`auth-service.ts:isAuthenticated`),
 * which such a session never has — so the timer never armed and a ThaID
 * session on a shared PC stayed live for its full 8h cookie lifetime,
 * unattended, instead of the 30-min idle window every other session gets.
 *
 * The correct gate is "is there a stored IDENTITY" (`getUser()` non-null),
 * token or not — a session with no identity at all has nothing to time out,
 * and a session WITH an identity must arm regardless of how it authenticates
 * downstream. For a password-path (token-based) session this is equivalent
 * in practice to the old check: user+token are always saved/cleared together
 * (saveSession/clearSession), so this does not change the 30-min default or
 * password-path behaviour — it only stops excluding the cookie-only case.
 */
function hasStoredIdentity(host: ActivityHost): boolean {
    return host.getUser() != null;
}

export function updateLastActivity(host: ActivityHost, handles: ActivityHandles, timeoutMinutes: number): void {
    if (!host.isBrowser()) return;
    setLastActivity();
    resetActivityTimer(host, handles, timeoutMinutes);
}

export function isSessionTimedOut(timeoutMinutes: number): boolean {
    const lastActivity = getLastActivity();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    return Date.now() - lastActivity > timeoutMs;
}

export function setupActivityTracking(host: ActivityHost, handles: ActivityHandles, timeoutMinutes: number): void {
    if (!host.isBrowser()) return;

    let lastUpdate = 0;
    const throttledHandler = () => {
        const now = Date.now();
        if (now - lastUpdate > 60000) {
            lastUpdate = now;
            if (hasStoredIdentity(host)) {
                updateLastActivity(host, handles, timeoutMinutes);
            }
        }
    };

    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
        window.addEventListener(event, throttledHandler, { passive: true });
    });

    resetActivityTimer(host, handles, timeoutMinutes);
}

function resetActivityTimer(host: ActivityHost, handles: ActivityHandles, timeoutMinutes: number): void {
    if (handles.activityTimer) {
        clearTimeout(handles.activityTimer);
        handles.activityTimer = null;
    }

    if (!hasStoredIdentity(host)) return;

    const timeoutMs = timeoutMinutes * 60 * 1000;

    handles.activityTimer = setTimeout(() => {
        if (isSessionTimedOut(timeoutMinutes)) {
            if (isDev) { logger.info('[AuthService] Session timed out due to inactivity'); }
            const user = host.getUser() as Parameters<typeof resolveLoginPath>[0];
            const loginPath = resolveLoginPath(
                user,
                host.isBrowser() ? window.location.pathname || '' : '',
            );
            // Round 5b: an idle timeout is an expiry, not a logout the user chose. The wizard
            // keeps its answers for the same person; a different sign-in still empties it.
            void host.logout(true, { keepWizard: true }).finally(() => {
                host.emit('session_expired');
                window.location.href = `${loginPath}?timeout=true`;
            });
        }
    }, timeoutMs);
}
