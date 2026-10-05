/**
 * Farm-worker Wave A, Chunk 5 (2026-07-02) — workspaces nav entry.
 *
 * /health/workspaces (list + invite/members pages) already exists but had NO
 * nav entry, so the workspace feature was reachable only by direct URL. This
 * guard pins the entry:
 *   1. key `workspaces`, href `/health/workspaces`, Thai label.
 *   2. Inserted BEFORE `help` — help stays the LAST item (X1-FIX-C guard);
 *      the first six items keep their muscle-memory order.
 */

import { describe, expect, it } from '@jest/globals';

import { healthNavigation } from '../constants';

describe('[wave-a-chunk-5] healthNavigation — workspaces entry', () => {
    it('contains a workspaces entry pointing at /health/workspaces', () => {
        const entry = healthNavigation.find((item) => item.key === 'workspaces');
        expect(entry).toBeDefined();
        expect(entry!.href).toBe('/health/workspaces');
    });

    it('uses the Thai label ทีมงาน', () => {
        const entry = healthNavigation.find((item) => item.key === 'workspaces');
        expect(entry!.label).toBe('ทีมงาน');
    });

    it('keeps existing order: first six unchanged, workspaces before help, help last', () => {
        const keys = healthNavigation.map((item) => item.key);
        // W4 refresh: surveys + herbs shipped after this pin was written and
        // slot between workspaces and help. The invariants this test exists
        // for still hold: first six unchanged, workspaces before help, help
        // last — asserted explicitly below so the NEXT nav addition updates
        // one array instead of resurrecting a stale-red suite.
        expect(keys).toEqual([
            'dashboard',
            'applications',
            'payments',
            'certificates',
            'planting',
            'profile',
            'workspaces',
            'surveys',
            'herbs',
            'help',
        ]);
        expect(keys.indexOf('workspaces')).toBeLessThan(keys.indexOf('help'));
        expect(keys[keys.length - 1]).toBe('help');
    });

    it('exposes an icon component (DashboardLayout renders <item.icon />)', () => {
        const entry = healthNavigation.find((item) => item.key === 'workspaces');
        expect(entry!.icon).toBeDefined();
        expect(typeof entry!.icon === 'function' || typeof entry!.icon === 'object').toBe(true);
    });
});
