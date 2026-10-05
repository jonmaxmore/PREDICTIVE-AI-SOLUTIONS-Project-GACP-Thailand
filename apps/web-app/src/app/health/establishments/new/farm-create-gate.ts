/**
 * farm-create-gate — Wave-C adversarial-verify SHOULD F5.
 *
 * The FARM_CREATE gate derivation, extracted from establishments/new
 * client-view so the polarity is behavior-tested
 * (farm-create-permission-gate.test.ts truth table) instead of pinned by
 * a presence-only string scan. The BE stays authoritative
 * (403 ENTITY_PERMISSION_DENIED on POST /farms); this gates UX only.
 */

/** Creating a farm INTO a workspace requires effective FARM_CREATE. */
export function computeCanCreateFarm(has: (permission: string) => boolean): boolean {
    return has('FARM_CREATE');
}
