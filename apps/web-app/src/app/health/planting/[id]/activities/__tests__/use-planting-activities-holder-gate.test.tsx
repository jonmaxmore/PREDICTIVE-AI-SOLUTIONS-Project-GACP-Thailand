/**
 * The activities hook gates buttons on the HOLDER's role: it hands
 * cycle.farm.entityId to useEntityPermissions (null while the cycle loads
 * or when the farm has no holder).
 */
import * as React from 'react';
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockPerm = jest.fn((_entityId: string | null) => ({ has: () => true, reportPermissionDenial: () => undefined }));
let mockCycle: Record<string, unknown> = {};
jest.mock('@/lib/api', () => ({ api: { post: jest.fn(), delete: jest.fn() } }));
jest.mock('@/lib/services/planting-service', () => ({
    plantingService: {
        getCycleById: async () => ({ success: true, data: mockCycle }),
        listActivities: async () => ({ success: true, data: [] }),
        createActivity: async () => ({ success: true }),
    },
}));
jest.mock('@/lib/services/use-entity-permissions', () => ({
    NO_PERMISSION_TOOLTIP_TH: 'ไม่มีสิทธิ์',
    activityPermissionFor: (type: string) => `ACTIVITY_${type}`,
    computeCanLogSelectedActivity: () => true,
    useEntityPermissions: (id: string | null) => mockPerm(id),
}));
jest.mock('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined, warning: () => undefined },
}));

import { usePlantingActivitiesPage } from '../use-planting-activities-page';

function Harness() {
    usePlantingActivitiesPage('cycle-1');
    return null;
}

async function mount(cycle: Record<string, unknown>) {
    mockCycle = cycle;
    mockPerm.mockClear();
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => { root.render(<Harness />); });
    return root;
}

describe('planting activities hook: holder gate', () => {
    let root: Root | null = null;
    afterEach(() => { act(() => { root?.unmount(); }); root = null; });

    it('passes cycle.farm.entityId to useEntityPermissions once the cycle loads', async () => {
        root = await mount({ id: 'cycle-1', plots: [], farm: { id: 'f1', entityId: 'ent-9' } });
        expect(mockPerm).toHaveBeenCalledWith('ent-9');
    });

    it('passes null when the farm has no holder', async () => {
        root = await mount({ id: 'cycle-1', plots: [], farm: { id: 'f1', entityId: null } });
        expect(mockPerm).not.toHaveBeenCalledWith('ent-9');
        expect(mockPerm).toHaveBeenLastCalledWith(null);
    });
});
