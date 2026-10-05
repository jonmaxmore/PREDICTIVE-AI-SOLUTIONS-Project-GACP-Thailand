/**
 * @jest-environment jsdom
 *
 * R2 (remove workspace mode): useEntityPermissions takes the entity id from
 * its caller instead of reading an "active entity". The pure functions are
 * pinned in use-entity-permissions.test.ts; this pins the hook wiring.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const getMock = jest.fn();
jest.mock('@/lib/api/api-client', () => ({ apiClient: { get: (...a: unknown[]) => getMock(...a) } }));
jest.mock('@/lib/services/auth-provider', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import {
    __clearEntityPermissionsCache,
    useEntityPermissions,
    type UseEntityPermissionsResult,
} from '../use-entity-permissions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: UseEntityPermissionsResult | null = null;
function Probe({ entityId }: { entityId: string | null }) {
    latest = useEntityPermissions(entityId);
    return null;
}

describe('useEntityPermissions(entityId)', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        getMock.mockReset();
        __clearEntityPermissionsCache();
        latest = null;
        container = document.createElement('div');
        root = createRoot(container);
    });
    afterEach(() => { act(() => { root.unmount(); }); });

    it('the hook fetches /entities/:entityId/my-permissions for the entityId it is given', async () => {
        getMock.mockResolvedValue({ success: true, data: { entityId: 'ent-9', role: 'MANAGER', personal: false, effective: ['HARVEST_RECORD'] } });
        await act(async () => { root.render(<Probe entityId="ent-9" />); });
        expect(getMock).toHaveBeenCalledWith('/entities/ent-9/my-permissions');
        expect(latest?.has('HARVEST_RECORD')).toBe(true);
        expect(latest?.has('QR_GENERATE')).toBe(false);
    });

    it('no entityId: nothing is fetched and every button stays visible', async () => {
        await act(async () => { root.render(<Probe entityId={null} />); });
        expect(getMock).not.toHaveBeenCalled();
        expect(latest?.has('ANYTHING')).toBe(true);
    });
});
