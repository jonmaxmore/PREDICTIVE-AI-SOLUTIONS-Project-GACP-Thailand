/**
 * farm-create-permission-gate.test.ts — Farm-worker Wave C chunk 3:
 * establishments/new create button gated by FARM_CREATE when the active
 * context is a WORKSPACE (personal → always allowed, solo unchanged).
 *
 * fs source-scan pin per repo convention; the failure policy itself is
 * TDD'd in lib/services/__tests__/use-entity-permissions.test.ts.
 *
 * F5 (adversarial-verify): presence-only scans could not catch a polarity
 * inversion — the gate derivation is now an EXTRACTED pure function
 * (farm-create-gate.ts) behavior-tested below, and the wiring pins match
 * FULL expressions (an inserted `!` breaks them).
 */

import fs from 'fs';
import path from 'path';
import { computeCanCreateFarm } from '../farm-create-gate';

const src = fs.readFileSync(path.resolve(__dirname, '..', 'client-view.tsx'), 'utf8');

describe('computeCanCreateFarm — behavior (F5 truth table)', () => {
    test('FARM_CREATE present → allowed; absent → blocked (the inversion this test exists to catch)', () => {
        expect(computeCanCreateFarm((p) => p === 'FARM_CREATE')).toBe(true);
        expect(computeCanCreateFarm(() => false)).toBe(false);
    });

    test('gates on exactly FARM_CREATE (not some other permission)', () => {
        const askedFor: string[] = [];
        computeCanCreateFarm((p) => { askedFor.push(p); return true; });
        expect(askedFor).toEqual(['FARM_CREATE']);
    });
});

describe('establishments/new — FARM_CREATE gate pins', () => {
    test('wires useEntityPermissions and gates on FARM_CREATE', () => {
        expect(src).toMatch(/useEntityPermissions/);
        expect(src).toMatch(/FARM_CREATE/);
    });

    test('F5 — the gated boolean derives from the EXTRACTED behavior-tested function (full expression, polarity-proof)', () => {
        expect(src).toMatch(/const canCreateFarm = computeCanCreateFarm\(hasWorkspacePermission\);/);
        // no inverted/raw re-derivation anywhere
        expect(src).not.toMatch(/!computeCanCreateFarm/);
    });

    test('F5 — submit button polarity: disabled when NOT allowed, tooltip on the same polarity (full JSX expressions)', () => {
        expect(src).toMatch(/disabled=\{!canCreateFarm\}/);
        expect(src).toMatch(/title=\{!canCreateFarm \? NO_PERMISSION_TOOLTIP_TH : undefined\}/);
        // inverted wiring (disabled={canCreateFarm}) must not exist
        expect(src).not.toMatch(/disabled=\{canCreateFarm\}/);
    });

    test('handleSubmit guards too (button-disable alone is bypassable via Enter-submit)', () => {
        // the guard returns before the POST /farms call
        expect(src).toMatch(/if \(!canCreateFarm\)/);
    });

    test('F1(b) — the submit failure branch reports the result for denial-eviction', () => {
        expect(src).toMatch(/reportPermissionDenial\(res\)/);
    });
});
