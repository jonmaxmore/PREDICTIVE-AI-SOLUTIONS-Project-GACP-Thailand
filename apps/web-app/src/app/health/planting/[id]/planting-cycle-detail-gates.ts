/**
 * planting-cycle-detail-gates — Wave-C adversarial-verify SHOULD F5.
 *
 * The cycle-detail gated booleans used to live inline in client-view.tsx
 * useMemo bodies, pinned only by presence-only string scans — a polarity
 * inversion (`!mayHarvest` → `mayHarvest`) kept every suite green.
 * Extracted here as PURE functions so the permission×domain truth tables
 * are behavior-tested (planting-cycle-detail-gates.test.ts); the
 * client-view call sites are pinned by full-expression regexes in
 * entity-permission-gating.test.ts.
 *
 * The BE stays authoritative (403 ENTITY_PERMISSION_DENIED); these gate
 * UX only.
 *
 * computeCanGenerateUnits is GONE, and harvest no longer counts plants:
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so there are no per-plant rows to
 * generate, to require before harvest, to find over plan, or to find
 * unassigned to a plot. Harvest now waits only on the cycle being open
 * and certified.
 */

export interface CanHarvestInput {
    isCycleClosed: boolean;
    hasActiveCertificate: boolean;
    /** effective HARVEST_RECORD (workspace) / true (personal context). */
    mayHarvest: boolean;
}

/** HARVEST_RECORD gates the harvest flow for workspace members. */
export function computeCanHarvest({
    isCycleClosed,
    hasActiveCertificate,
    mayHarvest,
}: CanHarvestInput): boolean {
    if (isCycleClosed) {
        return false;
    }
    if (!hasActiveCertificate) {
        return false;
    }
    return mayHarvest;
}
