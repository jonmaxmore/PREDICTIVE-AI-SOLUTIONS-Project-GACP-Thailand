import type { JWTPayload } from './auth-service.types';

export function decodeJwtToken(token: string | null | undefined): JWTPayload | null {
    const t = token || null;
    if (!t) return null;

    try {
        const parts = t.split('.');
        if (parts.length !== 3) return null;

        const payload = parts[1];
        if (!payload) return null;
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(decoded);
    } catch {
        console.error('[AuthService] Failed to decode JWT');
        return null;
    }
}

export function getJwtExpiry(token: string | null | undefined): number | null {
    const payload = decodeJwtToken(token);
    if (!payload?.exp) return null;
    return payload.exp * 1000;
}

export function isJwtExpired(token: string | null | undefined): boolean {
    const expiry = getJwtExpiry(token);
    if (!expiry) return true;
    return Date.now() >= expiry;
}

export function getMsUntilJwtExpiry(token: string | null | undefined): number {
    const expiry = getJwtExpiry(token);
    if (!expiry) return 0;
    return Math.max(0, expiry - Date.now());
}
