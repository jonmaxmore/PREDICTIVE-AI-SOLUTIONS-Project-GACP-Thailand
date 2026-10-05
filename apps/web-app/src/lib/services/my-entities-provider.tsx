'use client';

/**
 * MyEntitiesProvider — the list of entities (holders) the signed-in user
 * belongs to, from GET /entities/mine. Nothing more: there is no "active"
 * entity, no switching and no request header. Which entity a screen acts on
 * is decided on that screen (the holder picker) and travels in the request
 * body or URL.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api/api-client';
import { useAuth } from '@/lib/services/auth-provider';
import { logger } from '@/lib/logger';

export interface EntityMembership {
    id: string;
    type: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE';
    displayName: string;
    /** URL slug for shareable entity links; nullable for unusual legacy rows. */
    slug: string | null;
    role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'VIEWER';
    membershipStatus: 'ACTIVE' | 'PENDING' | 'REVOKED';
    isPersonal: boolean;
    organizationId: string;
    permissions: string[];
    /** What this membership may do for the entity (server truth, /entities/mine). */
    can: { edit: boolean; submit: boolean; createFarm: boolean };
}

interface MyEntitiesContextValue {
    entities: EntityMembership[];
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

const MyEntitiesContext = createContext<MyEntitiesContextValue | null>(null);

interface ProviderProps {
    children: React.ReactNode;
    /** When true, the provider does not fetch on mount (tests). */
    skipInitialFetch?: boolean;
}

export function MyEntitiesProvider({ children, skipInitialFetch = false }: ProviderProps) {
    const [entities, setEntities] = useState<EntityMembership[]>([]);
    const [isLoading, setIsLoading] = useState(!skipInitialFetch);
    const [error, setError] = useState<string | null>(null);
    const { user: authUser, isLoading: authLoading } = useAuth();

    // Older builds kept the chosen workspace here. Remove it so it cannot
    // linger in the browser.
    useEffect(() => {
        try { window.localStorage.removeItem('gacp.activeEntityId'); } catch { /* storage unavailable */ }
    }, []);

    const refresh = useCallback(async () => {
        try {
            const response = await apiClient.get<EntityMembership[]>('/entities/mine');
            if (!response.success || !response.data) {
                logger.warn('[MyEntitiesProvider] /entities/mine returned no data');
                setError('โหลดรายชื่อผู้ยื่นคำขอไม่สำเร็จ');
                return;
            }
            setEntities(response.data);
            setError(null);
        } catch (err) {
            logger.error('[MyEntitiesProvider] refresh failed:', err);
            setError('โหลดรายชื่อผู้ยื่นคำขอไม่สำเร็จ');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Keyed on the signed-in identity: the provider also mounts on the login
    // page, where an unauthenticated fetch would return an empty list and the
    // post-login redirect would never refetch.
    useEffect(() => {
        if (skipInitialFetch) return;
        if (authLoading) return;
        if (!authUser?.id) {
            setEntities([]);
            setIsLoading(false);
            return;
        }
        refresh();
    }, [skipInitialFetch, authLoading, authUser?.id, refresh]);

    const value = useMemo<MyEntitiesContextValue>(
        () => ({ entities, isLoading, error, refresh }),
        [entities, isLoading, error, refresh],
    );

    return <MyEntitiesContext.Provider value={value}>{children}</MyEntitiesContext.Provider>;
}

export function useMyEntities(): MyEntitiesContextValue {
    const ctx = useContext(MyEntitiesContext);
    if (!ctx) {
        // Permissive — pages without the provider still render.
        return { entities: [], isLoading: false, error: null, refresh: async () => {} };
    }
    return ctx;
}
