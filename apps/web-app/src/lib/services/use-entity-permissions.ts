'use client';

/**
 * use-entity-permissions — Farm-worker Wave C chunk 3.
 *
 * FE operation-button gating by a workspace member's EFFECTIVE
 * farm-operation permissions (Wave-B engine: role ∪ GRANT − REVOKE,
 * REVOKE wins). Fetches GET /entities/:id/my-permissions (the chunk-1
 * self-view — the admin GET is OWNER-only) when the active entity is a
 * real WORKSPACE, caches per entity id, and exposes `has(permission)`.
 *
 * The BE stays authoritative — every gated endpoint re-checks and answers
 * 403 ENTITY_PERMISSION_DENIED. FE gating is UX-only, hence the BINDING
 * failure policy:
 *
 *   - personal context (role OWNER on own INDIVIDUAL entity — the Wave-A
 *     S1 predicate) → has() always TRUE, instantly, NO fetch. Solo farmer
 *     flows byte-identical.
 *   - fetch ERROR / still loading → TRUE (fail-OPEN to visible: hiding
 *     buttons on a flaky fetch would be a false lockout). 'error' is never
 *     cached; when a REVALIDATION errors and a snapshot exists, the
 *     snapshot keeps serving (stale beats flicker-open).
 *   - 404 with the anti-probe JSON envelope (the API says "not a member")
 *     → FALSE (hide). A 404 WITHOUT that shape (proxy/HTML/infra) is an
 *     ERROR, not a membership verdict (adversarial-verify F4).
 *   - loaded → membership test on the effective array.
 *
 * Cache policy (adversarial-verify MUST F1 — the old cache pinned
 * 'loaded'/'not-member' TERMINALLY for the tab session, so REVOKE
 * mid-session left enabled-but-always-403 buttons and GRANT stayed hidden
 * until a hard reload):
 *
 *   (a) STALE-WHILE-REVALIDATE per mount — the cached snapshot serves
 *       instantly, but EVERY hook mount refetches and updates cache+state
 *       (one lightweight GET per page visit; both staleness directions
 *       converge at page granularity).
 *   (b) EVICT ON DENIAL — a live 403 ENTITY_PERMISSION_DENIED response
 *       (shared detector: lib/api/entity-permission-denial.ts) proves the
 *       snapshot stale; gated submit paths call reportPermissionDenial so
 *       the next mount refetches.
 *   (c) 'not-member' is cached as revalidate-on-next-mount, NOT terminal.
 *
 * Pure decision functions are exported for TDD; the hook only wires
 * useActiveEntity + apiClient to them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api/api-client';
import {
    isEntityPermissionDeniedResult,
    type PermissionDeniableApiResult,
} from '@/lib/api/entity-permission-denial';
import { useActiveEntity } from '@/lib/services/active-entity-provider';
import { useAuth } from '@/lib/services/auth-provider';
import { logger } from '@/lib/logger';

/** Owner-facing copy for gated/disabled operation buttons. */
export const NO_PERMISSION_TOOLTIP_TH = 'ไม่มีสิทธิ์ ติดต่อเจ้าของ workspace';

export type EntityPermissionState =
    | { kind: 'personal' }
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'not-member' }
    | { kind: 'loaded'; effective: string[] };

interface MyPermissionsPayload {
    entityId: string;
    role: string;
    personal: boolean;
    effective: string[];
}

/**
 * The Wave-A S1 predicate: the caller's OWN personal INDIVIDUAL entity is
 * role OWNER on an INDIVIDUAL entity. A worker invited into someone
 * ELSE's INDIVIDUAL entity is a real workspace (Wave-B, by design).
 * No membership at all (provider absent / still hydrating) counts as
 * personal so legacy solo paths stay byte-identical.
 */
export function isPersonalWorkspaceMembership(
    membership: { role: string; type: string } | null | undefined,
): boolean {
    if (!membership) return true;
    return membership.role === 'OWNER' && membership.type === 'INDIVIDUAL';
}

/** The binding failure policy — see module doc. */
export function computeHas(state: EntityPermissionState, permission: string): boolean {
    switch (state.kind) {
        case 'personal':
        case 'loading':
        case 'error':
            return true;
        case 'not-member':
            return false;
        case 'loaded':
            return state.effective.includes(permission);
        default:
            return true;
    }
}

/**
 * Classify an apiClient result envelope for /my-permissions into a state.
 * Only the ANTI-PROBE 404 hides; every other failure fails open.
 *
 * F4 — "not a member" is only trusted when the 404 carries the route's
 * anti-probe JSON envelope ({success:false, error:'Not Found'} at
 * routes/api/entities/index.js my-permissions — apiClient harvests that
 * `error` into `.code`, so a parsed JSON error envelope always has `.code`)
 * AND no payload. A 404 WITHOUT that shape (nginx/proxy HTML, stripped
 * body) is INFRA, not a membership verdict → 'error' (fail-open,
 * uncached → retried on the next mount).
 */
export function resolveFetchOutcome(res: {
    success: boolean;
    data?: MyPermissionsPayload | null;
    status?: number;
    code?: string;
}): EntityPermissionState {
    if (res.success && res.data) {
        if (res.data.personal === true) return { kind: 'personal' };
        return { kind: 'loaded', effective: Array.isArray(res.data.effective) ? res.data.effective : [] };
    }
    if (res.status === 404 && typeof res.code === 'string' && res.code.trim() && !res.data) {
        return { kind: 'not-member' };
    }
    return { kind: 'error' };
}

const ACTIVITY_TYPES = new Set([
    'IRRIGATION', 'FERTILIZER', 'PEST_CONTROL', 'WEED_CONTROL',
    'INSPECTION', 'INCIDENT', 'OTHER',
]);

/**
 * The per-type activity permission code (ACTIVITY_<TYPE>) for the 7 types
 * in planting-activities-page-config.ts. Unknown/blank type → null: no FE
 * gate, the BE decides (never invent a code the catalog doesn't have).
 */
export function activityPermissionFor(activityType: string): string | null {
    const upper = String(activityType || '').trim().toUpperCase();
    if (!ACTIVITY_TYPES.has(upper)) return null;
    return `ACTIVITY_${upper}`;
}

/**
 * F5 — the activities-page submit gate for the SELECTED type: allowed
 * when the type has no catalog code (null → the BE decides) or the
 * member holds the matching ACTIVITY_<TYPE> permission. Extracted from
 * use-planting-activities-page so the polarity is behavior-tested
 * instead of pinned by a presence-only source scan.
 */
export function computeCanLogSelectedActivity(
    requiredActivityPermission: string | null,
    has: (permission: string) => boolean,
): boolean {
    return !requiredActivityPermission || has(requiredActivityPermission);
}

// Per-(user, entity) SNAPSHOT cache — stale-while-revalidate, never
// terminal (see the cache-policy block in the module doc). 'error' is
// intentionally not cached so a transient failure retries on the next
// mount instead of pinning fail-open for the whole session.
const outcomeCache = new Map<string, EntityPermissionState>();

/** The canonical (user, entity) cache key. */
export function entityPermissionsCacheKey(
    userId: string | null | undefined,
    entityId: string,
): string {
    return `${userId || 'anon'}:${entityId}`;
}

/** The cached snapshot for a key, or null (pure read — no fetch). */
export function peekEntityPermissionsSnapshot(cacheKey: string): EntityPermissionState | null {
    return outcomeCache.get(cacheKey) ?? null;
}

/** Test hook — clears the module cache between cases. */
export function __clearEntityPermissionsCache(): void {
    outcomeCache.clear();
}

type MyPermissionsFetcher = (entityId: string) => Promise<{
    success: boolean;
    data?: MyPermissionsPayload | null;
    status?: number;
    code?: string;
}>;

const defaultMyPermissionsFetcher: MyPermissionsFetcher = (entityId) =>
    apiClient.get<MyPermissionsPayload>(`/entities/${entityId}/my-permissions`);

/**
 * F1(a) — the revalidation step every hook mount runs: fetch the effective
 * set, cache every non-error outcome, and return the state to render.
 * When the refetch ERRORS and a snapshot exists, the snapshot is returned
 * (and kept) — stale beats flicker-open; with no snapshot the transient
 * 'error' (fail-OPEN, uncached) is returned.
 */
export async function revalidateEntityPermissions(
    cacheKey: string,
    entityId: string,
    fetchMyPermissions: MyPermissionsFetcher = defaultMyPermissionsFetcher,
): Promise<EntityPermissionState> {
    let outcome: EntityPermissionState;
    try {
        const res = await fetchMyPermissions(entityId);
        outcome = resolveFetchOutcome(res);
    } catch (err) {
        logger.warn('[useEntityPermissions] my-permissions fetch failed (fail-open):', err);
        outcome = { kind: 'error' };
    }
    if (outcome.kind === 'error') {
        return outcomeCache.get(cacheKey) ?? outcome;
    }
    outcomeCache.set(cacheKey, outcome);
    return outcome;
}

/**
 * F1(b) — evict the (user, entity) snapshot when a live response proves it
 * stale: a 403 ENTITY_PERMISSION_DENIED (strict shared detector — never
 * fires on session-guard 403s). Returns true when an eviction happened;
 * the NEXT mount then refetches. Safe to call with any failed result —
 * non-denials no-op.
 */
export function evictEntityPermissionsOnDenial(
    result: PermissionDeniableApiResult | null | undefined,
    userId: string | null | undefined,
    entityId: string,
): boolean {
    if (!entityId) return false;
    if (!isEntityPermissionDeniedResult(result)) return false;
    outcomeCache.delete(entityPermissionsCacheKey(userId, entityId));
    return true;
}

export interface UseEntityPermissionsResult {
    /** UX gate: may this user see/press the button for `permission`? */
    has: (permission: string) => boolean;
    /** true = solo-farmer/personal context (everything visible). */
    personal: boolean;
    /** true while the workspace effective set is being fetched. */
    isLoading: boolean;
    /**
     * F1(b) — call from a gated submit path's FAILURE branch with the
     * apiClient result. When it is a live 403 ENTITY_PERMISSION_DENIED the
     * (user, entity) snapshot is evicted so the next mount refetches;
     * every other failure no-ops. Returns whether an eviction happened.
     */
    reportPermissionDenial: (result: PermissionDeniableApiResult | null | undefined) => boolean;
}

export function useEntityPermissions(): UseEntityPermissionsResult {
    const { activeEntity } = useActiveEntity();
    const { user } = useAuth();

    const personal = isPersonalWorkspaceMembership(activeEntity);
    const entityId = !personal && activeEntity ? activeEntity.id : null;
    const userId = user?.id;
    const cacheKey = entityId ? entityPermissionsCacheKey(userId, entityId) : null;

    const [state, setState] = useState<EntityPermissionState>({ kind: 'loading' });

    useEffect(() => {
        if (!entityId || !cacheKey) return;
        // F1(a) stale-while-revalidate: serve the snapshot instantly when
        // one exists, but ALWAYS refetch on mount and update cache+state —
        // never early-return on a cache hit (the old terminal-cache bug).
        setState(outcomeCache.get(cacheKey) ?? { kind: 'loading' });
        let cancelled = false;
        (async () => {
            const outcome = await revalidateEntityPermissions(cacheKey, entityId);
            if (!cancelled) setState(outcome);
        })();
        return () => { cancelled = true; };
    }, [entityId, cacheKey]);

    const reportPermissionDenial = useCallback(
        (result: PermissionDeniableApiResult | null | undefined) => {
            if (!entityId) return false; // personal context: nothing cached
            return evictEntityPermissionsOnDenial(result, userId, entityId);
        },
        [entityId, userId],
    );

    const effectiveState: EntityPermissionState = personal ? { kind: 'personal' } : state;

    const has = useCallback(
        (permission: string) => computeHas(effectiveState, permission),
        // effectiveState is re-derived per render; key on its parts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [personal, state],
    );

    return useMemo(() => ({
        has,
        personal,
        isLoading: !personal && state.kind === 'loading',
        reportPermissionDenial,
    }), [has, personal, state.kind, reportPermissionDenial]);
}
