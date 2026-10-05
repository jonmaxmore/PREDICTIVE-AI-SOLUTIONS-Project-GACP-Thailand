/**
 * @jest-environment jsdom
 *
 * R2 (remove workspace mode): MyEntitiesProvider lists the user's entities
 * and nothing else. A stale `gacp.activeEntityId` left by an old build is
 * removed on mount.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const getMock = jest.fn();
jest.mock('@/lib/api/api-client', () => ({ apiClient: { get: (...a: unknown[]) => getMock(...a) } }));
jest.mock('@/lib/services/auth-provider', () => ({ useAuth: () => ({ user: { id: 'u-1' }, isLoading: false }) }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { MyEntitiesProvider, useMyEntities } from '../my-entities-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useMyEntities> | null = null;
function Consumer() { latest = useMyEntities(); return null; }

describe('MyEntitiesProvider', () => {
    let root: Root;
    beforeEach(() => {
        getMock.mockReset();
        latest = null;
        window.localStorage.clear();
        root = createRoot(document.createElement('div'));
    });
    afterEach(() => { act(() => { root.unmount(); }); });

    it('stale gacp.activeEntityId is removed on mount', async () => {
        getMock.mockResolvedValue({ success: true, data: [] });
        window.localStorage.setItem('gacp.activeEntityId', 'ent-old');
        await act(async () => { root.render(<MyEntitiesProvider><Consumer /></MyEntitiesProvider>); });
        expect(window.localStorage.getItem('gacp.activeEntityId')).toBeNull();
    });

    it('lists /entities/mine rows with their can flags and exposes no active entity', async () => {
        const rows = [{ id: 'e1', displayName: 'A', can: { edit: true, submit: true, createFarm: true } }];
        getMock.mockResolvedValue({ success: true, data: rows });
        await act(async () => { root.render(<MyEntitiesProvider><Consumer /></MyEntitiesProvider>); });
        expect(getMock).toHaveBeenCalledWith('/entities/mine');
        expect(latest?.entities).toEqual(rows);
        expect(latest).not.toHaveProperty('activeEntity');
        expect(latest).not.toHaveProperty('setActiveEntity');
    });
});
