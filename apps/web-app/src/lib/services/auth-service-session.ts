import { STORAGE_KEYS, type AuthUser } from './auth-service.types';
import { HEALTH_LOGIN_ROUTE, PROVIDER_LOGIN_ROUTE } from '@/lib/constants/auth-routes';

const LEGACY_PROVIDER_TOKEN_KEY = 'provider_token';
const LEGACY_PROVIDER_USER_KEY = 'provider_user';

const isBrowser = (): boolean => typeof window !== 'undefined';

const getStoredValue = (key: string): string | null => {
    if (!isBrowser()) {
        return null;
    }

    return localStorage.getItem(key);
};

const getStoredValueWithLegacyFallback = (canonicalKey: string, legacyKey?: string): string | null => {
    const canonicalValue = getStoredValue(canonicalKey);
    if (canonicalValue) {
        return canonicalValue;
    }

    if (!legacyKey || !isBrowser()) {
        return null;
    }

    const legacyValue = localStorage.getItem(legacyKey);
    if (!legacyValue) {
        return null;
    }

    localStorage.setItem(canonicalKey, legacyValue);
    localStorage.removeItem(legacyKey);
    return legacyValue;
};

const setStoredValue = (key: string, value: string, legacyKey?: string): void => {
    if (!isBrowser()) {
        return;
    }

    localStorage.setItem(key, value);
    if (legacyKey) {
        localStorage.removeItem(legacyKey);
    }
};

export const resolveSessionCookieKey = (user?: AuthUser | null): 'auth_token' | 'provider_token' => {
    const authType = String(user?.authType || '').toUpperCase();
    return user?.providerId || authType === 'PROVIDER_ID' ? 'provider_token' : 'auth_token';
};

export const isProviderUser = (user?: AuthUser | null): boolean =>
    resolveSessionCookieKey(user) === 'provider_token';

export const resolveLoginPath = (user?: AuthUser | null, pathname = ''): string =>
    isProviderUser(user) || pathname.startsWith('/provider') || pathname.startsWith('/admin')
        ? PROVIDER_LOGIN_ROUTE
        : HEALTH_LOGIN_ROUTE;

export const getStoredAccessToken = (): string | null =>
    getStoredValueWithLegacyFallback(STORAGE_KEYS.ACCESS_TOKEN, LEGACY_PROVIDER_TOKEN_KEY);

export const setStoredAccessToken = (token: string): void => {
    setStoredValue(STORAGE_KEYS.ACCESS_TOKEN, token, LEGACY_PROVIDER_TOKEN_KEY);
};

export const getStoredUser = (): AuthUser | null => {
    const rawUser = getStoredValueWithLegacyFallback(STORAGE_KEYS.USER, LEGACY_PROVIDER_USER_KEY);
    if (!rawUser) {
        return null;
    }

    try {
        return JSON.parse(rawUser) as AuthUser;
    } catch {
        return null;
    }
};

export const setStoredUser = (user: AuthUser): void => {
    setStoredValue(STORAGE_KEYS.USER, JSON.stringify(user), LEGACY_PROVIDER_USER_KEY);
};

// The active-entity id MUST be cleared whenever the session identity changes —
// on logout, AND on a login that establishes a DIFFERENT account. Otherwise it
// survives on a shared device, the next user's session sends a stale
// `x-active-entity-id`, and the backend rejects every entity-scoped read with
// 403 ACTIVE_ENTITY_MISMATCH (breaks the health dashboard, /applications/my,
// and the provider auditor APIs). Literal key (= ACTIVE_ENTITY_STORAGE_KEY in
// active-entity-provider) to avoid a circular import.
export const clearActiveEntityId = (): void => {
    if (!isBrowser()) {
        return;
    }
    localStorage.removeItem('gacp.activeEntityId');
};

export const clearStoredAuthSession = (): void => {
    if (!isBrowser()) {
        return;
    }

    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.LAST_ACTIVITY);
    localStorage.removeItem(LEGACY_PROVIDER_TOKEN_KEY);
    localStorage.removeItem(LEGACY_PROVIDER_USER_KEY);
    clearActiveEntityId();
};

/* ── Activity tracking ── */

export const getLastActivity = (): number => {
    const stored = getStoredValue(STORAGE_KEYS.LAST_ACTIVITY);
    return stored ? parseInt(stored, 10) : Date.now();
};

export const setLastActivity = (): void => {
    if (!isBrowser()) return;
    localStorage.setItem(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
};

export const clearLastActivity = (): void => {
    if (!isBrowser()) return;
    localStorage.removeItem(STORAGE_KEYS.LAST_ACTIVITY);
};

/* ── Remember-me ── */

export const saveRememberMe = (accountType: string, identifier: string): void => {
    if (!isBrowser()) return;
    localStorage.setItem(STORAGE_KEYS.REMEMBER_LOGIN, JSON.stringify({ accountType, identifier }));
};

export const getRememberMe = (): { accountType: string; identifier: string } | null => {
    const data = getStoredValue(STORAGE_KEYS.REMEMBER_LOGIN);
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
};

export const clearRememberMe = (): void => {
    if (!isBrowser()) return;
    localStorage.removeItem(STORAGE_KEYS.REMEMBER_LOGIN);
};

