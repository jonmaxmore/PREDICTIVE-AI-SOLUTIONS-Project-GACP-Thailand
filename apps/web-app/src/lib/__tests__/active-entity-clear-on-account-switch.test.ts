/**
 * Account-switch hygiene — saveSession() must clear the stale active-entity id
 * (`gacp.activeEntityId`) when a DIFFERENT account logs in (e.g. logging into
 * the provider portal while a health session is still present, without an
 * explicit logout). Otherwise the FE keeps sending the prior account's
 * `x-active-entity-id` header and the backend rejects every entity-scoped read
 * with 403 ACTIVE_ENTITY_MISMATCH. A same-user re-login keeps the selected
 * entity. (Regression: surfaced during provider-portal UAT, but
 * the bug is auth-path-agnostic — it hit legacy login too.)
 */

import { AuthService } from '../services/auth-service';
import * as session from '../services/auth-service-session';

const ACTIVE_ENTITY_KEY = 'gacp.activeEntityId';

function installStorage(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    const storage = {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        get length() { return map.size; },
        clear: () => map.clear(),
    };
    Object.defineProperty(window, 'localStorage', { value: storage, writable: true, configurable: true });
    return map;
}

describe('active-entity hygiene on login / account switch', () => {
    beforeEach(() => {
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        ) as unknown as jest.MockedFunction<typeof fetch>;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('exposes clearActiveEntityId() which removes the gacp.activeEntityId key', () => {
        const map = installStorage({ [ACTIVE_ENTITY_KEY]: 'ent-1' });
        session.clearActiveEntityId();
        expect(map.has(ACTIVE_ENTITY_KEY)).toBe(false);
    });

    it('clearStoredAuthSession() (logout) also clears the active-entity id', () => {
        const map = installStorage({ [ACTIVE_ENTITY_KEY]: 'ent-1' });
        session.clearStoredAuthSession();
        expect(map.has(ACTIVE_ENTITY_KEY)).toBe(false);
    });

    it('clears the stale active-entity when a DIFFERENT user logs in', async () => {
        const map = installStorage({
            user: JSON.stringify({ id: 'user-health' }),
            [ACTIVE_ENTITY_KEY]: 'ent-health',
        });

        await AuthService.saveSession({
            user: { id: 'user-provider', providerId: '2222222222222', authType: 'PROVIDER_ID' },
            tokens: { accessToken: 'tok' },
        } as never);

        expect(map.has(ACTIVE_ENTITY_KEY)).toBe(false);
    });

    it('keeps the active-entity on a SAME-user re-login', async () => {
        const map = installStorage({
            user: JSON.stringify({ id: 'user-1' }),
            [ACTIVE_ENTITY_KEY]: 'ent-keep',
        });

        await AuthService.saveSession({
            user: { id: 'user-1' },
            tokens: { accessToken: 'tok' },
        } as never);

        expect(map.get(ACTIVE_ENTITY_KEY)).toBe('ent-keep');
    });
});
