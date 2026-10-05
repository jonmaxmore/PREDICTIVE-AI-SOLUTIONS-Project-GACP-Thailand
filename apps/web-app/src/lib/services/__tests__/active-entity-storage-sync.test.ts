/**
 * Cross-tab `storage`-event sync — pure-helper tests.
 *
 * Wave D. Without this, opening two tabs as different workspaces would
 * leave each tab's UI lying about the active context: tab B's React
 * state doesn't auto-update when tab A switches, but the api-client
 * (which reads localStorage on every request) DOES start sending the
 * new `x-active-entity-id` header → header / UI mismatch.
 *
 * We test the pure decision function in isolation; the React useEffect
 * just wires window.addEventListener('storage', …) to it.
 */

import { resolveStorageEventChange, ACTIVE_ENTITY_STORAGE_KEY } from '../active-entity-provider';

describe('resolveStorageEventChange', () => {
    it('ignores events for unrelated localStorage keys', () => {
        const out = resolveStorageEventChange(
            { key: 'something-else', newValue: 'ent-1' },
            'ent-2',
        );
        expect(out).toBeNull();
    });

    it('ignores events when newValue equals currentActiveId (already in sync)', () => {
        const out = resolveStorageEventChange(
            { key: ACTIVE_ENTITY_STORAGE_KEY, newValue: 'ent-1' },
            'ent-1',
        );
        expect(out).toBeNull();
    });

    it('returns shouldRefresh=true when another tab picks a different workspace', () => {
        const out = resolveStorageEventChange(
            { key: ACTIVE_ENTITY_STORAGE_KEY, newValue: 'ent-juristic' },
            'ent-personal',
        );
        expect(out).toEqual({ newId: 'ent-juristic', shouldRefresh: true });
    });

    it('returns newId=null without refresh when another tab clears the value (logout)', () => {
        const out = resolveStorageEventChange(
            { key: ACTIVE_ENTITY_STORAGE_KEY, newValue: null },
            'ent-juristic',
        );
        expect(out).toEqual({ newId: null, shouldRefresh: false });
    });

    it('ignores a clear event when local state is already null (idempotent)', () => {
        const out = resolveStorageEventChange(
            { key: ACTIVE_ENTITY_STORAGE_KEY, newValue: null },
            null,
        );
        expect(out).toBeNull();
    });

    it('handles transitioning from null → an entity id', () => {
        const out = resolveStorageEventChange(
            { key: ACTIVE_ENTITY_STORAGE_KEY, newValue: 'ent-fresh' },
            null,
        );
        expect(out).toEqual({ newId: 'ent-fresh', shouldRefresh: true });
    });

    it('treats a different StorageEvent.key (no newValue field at all) as ignore', () => {
        // jsdom may send key=null for clear() — guard against both shapes.
        const out = resolveStorageEventChange(
            { key: null, newValue: null },
            'ent-1',
        );
        expect(out).toBeNull();
    });
});
