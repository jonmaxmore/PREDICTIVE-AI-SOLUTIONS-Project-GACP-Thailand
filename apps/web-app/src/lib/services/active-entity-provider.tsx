'use client';

/**
 * ActiveEntityProvider — Wave C (PR C-2)
 *
 * Tracks the workspace (Entity) the user is currently acting as. Sits
 * alongside AuthProvider — AuthProvider answers "who are you", this
 * provider answers "which workspace are you operating in right now".
 *
 * Source of truth ordering:
 *   1. localStorage `gacp.activeEntityId` — survives reload, cross-tab.
 *   2. The user's personal INDIVIDUAL Entity (always exists post Phase
 *      67) when no localStorage value.
 *
 * On mount, the provider re-validates the localStorage value against
 * `GET /api/entities/mine`. If the stored entity has been revoked or
 * the user signed in as someone else, we fall back to the personal
 * entity and clear stale state.
 *
 * The api-client (apps/web-app/src/lib/api/api-client.ts) reads the
 * same localStorage key and injects `x-active-entity-id` on every
 * authenticated XHR — see Wave-C PR-2 for the wire-level contract.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api/api-client';
import { useAuth } from '@/lib/services/auth-provider';
import { logger } from '@/lib/logger';

const STORAGE_KEY = 'gacp.activeEntityId';

export interface EntityMembership {
    id: string;
    type: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE';
    displayName: string;
    /**
     * URL slug for shareable workspace links. Added by PR #146.
     * Nullable because pre-Phase-5b backfill might leave one missing
     * for unusual edge cases (the SQL migration falls back to
     * `entity-{idPrefix}`, but the schema column itself is nullable).
     */
    slug: string | null;
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'VIEWER';
    membershipStatus: 'ACTIVE' | 'PENDING' | 'REVOKED';
    isPersonal: boolean;
    organizationId: string;
    permissions: string[];
}

interface ActiveEntityContextValue {
    entities: EntityMembership[];
    activeEntity: EntityMembership | null;
    isLoading: boolean;
    setActiveEntity: (entityId: string) => Promise<void>;
    refresh: () => Promise<void>;
}

const ActiveEntityContext = createContext<ActiveEntityContextValue | null>(null);

function readStoredId(): string | null {
    if (typeof window === 'undefined') return null;
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeStoredId(id: string | null) {
    if (typeof window === 'undefined') return;
    try {
        if (id) window.localStorage.setItem(STORAGE_KEY, id);
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // localStorage unavailable; in-memory state still works for the session.
    }
}

/**
 * Pure helper for the cross-tab `storage` event listener.
 *
 * The browser fires a `storage` event in EVERY tab EXCEPT the one that
 * wrote to localStorage. So when tab A switches workspace, tab B sees
 * the event and updates its React state. The event also fires when
 * another tab does `localStorage.removeItem` (newValue === null) —
 * e.g., logout flow.
 *
 * Exported so the test can exercise the decision logic without
 * mounting React.
 *
 * Returns:
 *   null              — event ignored (different key, or no actual change)
 *   { newId: string,
 *     shouldRefresh: true }   — another tab picked a different workspace;
 *                              local state should update + entities list
 *                              should re-fetch (in case the other tab also
 *                              created a new workspace we don't have yet)
 *   { newId: null,
 *     shouldRefresh: false }  — another tab cleared the active entity
 *                              (logout / signed-out flow); just clear local state
 */
export function resolveStorageEventChange(
    event: { key: string | null; newValue: string | null },
    currentActiveId: string | null,
): { newId: string | null; shouldRefresh: boolean } | null {
    if (event.key !== STORAGE_KEY) return null;
    if (event.newValue === null) {
        // Another tab cleared the active id (logout, etc.) — only react
        // if our state still has one set, otherwise it's a no-op.
        if (currentActiveId === null) return null;
        return { newId: null, shouldRefresh: false };
    }
    if (event.newValue === currentActiveId) return null; // already in sync
    return { newId: event.newValue, shouldRefresh: true };
}

interface ProviderProps {
    children: React.ReactNode;
    /** When true, the provider does not fetch on mount — used in tests. */
    skipInitialFetch?: boolean;
}

export function ActiveEntityProvider({ children, skipInitialFetch = false }: ProviderProps) {
    const [entities, setEntities] = useState<EntityMembership[]>([]);
    const [activeId, setActiveId] = useState<string | null>(() => readStoredId());
    const [isLoading, setIsLoading] = useState(!skipInitialFetch);
    const { user: authUser, isLoading: authLoading } = useAuth();

    const refresh = useCallback(async () => {
        try {
            const response = await apiClient.get<EntityMembership[]>('/entities/mine');
            if (!response.success || !response.data) {
                logger.warn('[ActiveEntityProvider] /entities/mine returned no data');
                setIsLoading(false);
                return;
            }
            const list = response.data;
            setEntities(list);

            // Validate stored id; fall back to personal if stale.
            const stored = readStoredId();
            const storedValid = stored && list.some(e => e.id === stored && e.membershipStatus === 'ACTIVE');
            if (!storedValid) {
                // Prefer the personal (INDIVIDUAL) entity, but fall back to the
                // first ACTIVE membership so a user whose memberships carry NO
                // isPersonal flag (e.g. degraded healthId resolution / hash
                // mismatch — see auth-middleware degraded path) still lands on a
                // usable workspace instead of a permanently-stuck "loading" pill.
                const personal = list.find(e => e.isPersonal && e.membershipStatus === 'ACTIVE');
                const fallback = personal || list.find(e => e.membershipStatus === 'ACTIVE') || null;
                if (fallback) {
                    writeStoredId(fallback.id);
                    setActiveId(fallback.id);
                } else {
                    writeStoredId(null);
                    setActiveId(null);
                }
            } else if (stored !== activeId) {
                setActiveId(stored);
            }
        } catch (err) {
            logger.error('[ActiveEntityProvider] refresh failed:', err);
        } finally {
            setIsLoading(false);
        }
    }, [activeId]);

    // Fetch keyed on the signed-in identity, NOT once-on-mount (2026-06-11).
    // This provider lives in the ROOT providers tree, so it also mounts on
    // the login page: the old dependency-less mount effect fetched
    // /entities/mine unauthenticated (→ []), and the client-side redirect
    // after login never remounted it — the workspace pill stayed stuck on
    // "ไม่มีพื้นที่ใช้งาน" until a hard reload (found live by the owner on
    // staging). Keying on user.id makes the fetch fire when the identity
    // hydrates, appears after login, or changes on re-login.
    useEffect(() => {
        if (skipInitialFetch) return;
        if (authLoading) return; // wait for auth hydration — keeps isLoading true (pill shows loading, not the empty state)
        if (!authUser?.id) {
            setIsLoading(false); // signed out: nothing to fetch
            return;
        }
        refresh();
        // refresh intentionally omitted: it changes with activeId and would
        // re-trigger on every workspace switch. ESLint complains; we accept.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [skipInitialFetch, authLoading, authUser?.id]);

    // Wave D — cross-tab sync. The browser fires `storage` events in
    // every tab EXCEPT the writing one when localStorage changes. So
    // when tab A switches workspace, tab B picks it up here and stays
    // consistent without a page reload. Without this, tab B's UI lies
    // about the active workspace while its api-client still sends the
    // new `x-active-entity-id` header (because api-client reads
    // localStorage on every request).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onStorage = (e: StorageEvent) => {
            const change = resolveStorageEventChange(e, activeId);
            if (!change) return;
            setActiveId(change.newId);
            // Refresh entities in case the other tab also created a
            // new workspace we don't have in our list yet.
            if (change.shouldRefresh) refresh();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [activeId, refresh]);

    const setActiveEntity = useCallback(async (entityId: string) => {
        const target = entities.find(e => e.id === entityId);
        if (!target) {
            logger.warn(`[ActiveEntityProvider] setActiveEntity: ${entityId} not in user's memberships`);
            return;
        }
        const fromId = activeId;
        writeStoredId(entityId);
        setActiveId(entityId);
        // Fire-and-forget audit log. Failures don't roll back the switch.
        try {
            await apiClient.post('/entities/me/switch', {
                fromEntityId: fromId || undefined,
                toEntityId: entityId,
                source: 'HEADER',
            });
        } catch (err) {
            logger.warn('[ActiveEntityProvider] /entities/me/switch failed:', err);
        }
    }, [entities, activeId]);

    const activeEntity = useMemo(
        () => entities.find(e => e.id === activeId) || null,
        [entities, activeId],
    );

    const value: ActiveEntityContextValue = {
        entities,
        activeEntity,
        isLoading,
        setActiveEntity,
        refresh,
    };

    return (
        <ActiveEntityContext.Provider value={value}>
            {children}
        </ActiveEntityContext.Provider>
    );
}

export function useActiveEntity(): ActiveEntityContextValue {
    const ctx = useContext(ActiveEntityContext);
    if (!ctx) {
        // Permissive — pages that don't mount the provider still render.
        // Returns a no-op shape rather than throwing, matching the
        // pattern auth-provider.tsx uses for unauthenticated paths.
        return {
            entities: [],
            activeEntity: null,
            isLoading: false,
            setActiveEntity: async () => {},
            refresh: async () => {},
        };
    }
    return ctx;
}

export const ACTIVE_ENTITY_STORAGE_KEY = STORAGE_KEY;
