/**
 * planting-cycle-detail-gates.test.ts — Wave-C adversarial-verify SHOULD F5.
 *
 * The cycle-detail gated boolean (canHarvest) used to
 * live inline in client-view.tsx useMemo bodies, pinned only by
 * PRESENCE-ONLY string scans — a polarity inversion (`!mayHarvest` →
 * `mayHarvest`) kept every suite green (UX regression without signal).
 * The derivation is now an EXTRACTED pure function, behavior-tested here
 * as a truth table: permission present/absent × domain state.
 *
 * computeCanGenerateUnits and the per-plant halves of computeCanHarvest
 * (units present / none over plan / none unassigned) are GONE: R8
 * (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so harvest waits only on the cycle being
 * open and certified.
 */

import { computeCanHarvest } from '../planting-cycle-detail-gates';

describe('computeCanHarvest — HARVEST_RECORD × domain state', () => {
    const readyState = {
        isCycleClosed: false,
        hasActiveCertificate: true,
    };

    it('permission PRESENT + open cycle + active cert → TRUE', () => {
        expect(computeCanHarvest({ ...readyState, mayHarvest: true })).toBe(true);
    });

    it('permission ABSENT blocks a harvest-ready cycle (the inversion this test exists to catch)', () => {
        expect(computeCanHarvest({ ...readyState, mayHarvest: false })).toBe(false);
    });

    it('domain blockers each veto independently of the permission', () => {
        expect(computeCanHarvest({ ...readyState, mayHarvest: true, isCycleClosed: true })).toBe(false);
        expect(computeCanHarvest({ ...readyState, mayHarvest: true, hasActiveCertificate: false })).toBe(false);
    });
});
