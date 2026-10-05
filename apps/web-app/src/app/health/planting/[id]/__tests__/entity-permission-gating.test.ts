/**
 * entity-permission-gating.test.ts — Farm-worker Wave C chunk 3:
 * operation-button gating by workspace effective permissions on the
 * planting-cycle detail page + the activities page.
 *
 * fs source-scan pins (repo convention — the interactive islands fetch in
 * useEffects, invisible to renderToStaticMarkup; the pure failure-policy
 * logic is TDD'd in lib/services/__tests__/use-entity-permissions.test.ts).
 *
 * Pinned contracts:
 *   - cycle detail: harvest ← HARVEST_RECORD · plot-QR generate ←
 *     QR_GENERATE, both through useEntityPermissions().has (fail-open, BE
 *     authoritative), with the standard no-permission Thai copy surfaced.
 *     UNIT_MANAGE is no longer pinned here: R8 (design notes
 *     2026-08-20-planting-tnt-design.md) retired per-plant tracking
 *     permanently, so the generate/confirm/reconcile-units surfaces it
 *     gated no longer exist.
 *   - activities: submit gated per SELECTED type via activityPermissionFor
 *     (ACTIVITY_<TYPE>), disabled state + tooltip on the submit button.
 */

import fs from 'fs';
import path from 'path';

const cycleDetailSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'client-view.tsx'), 'utf8',
);
const activitiesHookSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'activities', 'use-planting-activities-page.ts'), 'utf8',
);
const activitiesViewSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'activities', 'client-view.tsx'), 'utf8',
);

describe('planting cycle detail — permission gating pins', () => {
    test('gates on the farm holder: useEntityPermissions(cycle?.farm?.entityId ?? null)', () => {
        expect(cycleDetailSrc).toMatch(/useEntityPermissions\(\s*cycle\?\.farm\?\.entityId \?\? null,?\s*\)/);
    });

    test('wires useEntityPermissions', () => {
        expect(cycleDetailSrc).toMatch(/useEntityPermissions/);
        expect(cycleDetailSrc).toMatch(/@\/lib\/services\/use-entity-permissions/);
    });

    // F5 — FULL-expression pins: the old presence-only scans stayed green
    // under a polarity inversion (`!has(...)` ↔ `has(...)`) or an
    // un-wiring (raw handler passed instead of the guarded one). An
    // inserted `!` now breaks these regexes; the derivations themselves
    // are behavior-tested in planting-cycle-detail-gates.test.ts.
    test('F5 — may* booleans derive STRAIGHT from has() (full expressions, inversion-proof)', () => {
        expect(cycleDetailSrc).toMatch(/const mayHarvest = hasWorkspacePermission\('HARVEST_RECORD'\);/);
        expect(cycleDetailSrc).toMatch(/const mayGenerateQr = hasWorkspacePermission\('QR_GENERATE'\);/);
    });

    test('F5 — canHarvest calls the EXTRACTED behavior-tested gate with SHORTHAND args (call-site inversion breaks the match)', () => {
        expect(cycleDetailSrc).toMatch(
            /computeCanHarvest\(\{\s*isCycleClosed,\s*hasActiveCertificate,\s*mayHarvest,?\s*\}\)/,
        );
        // no inverted call bypassing the tested polarity
        expect(cycleDetailSrc).not.toMatch(/!computeCanHarvest/);
    });

    test('F5 — the harvest blocker list carries the permission with the RIGHT polarity (full expression)', () => {
        expect(cycleDetailSrc).toMatch(
            /const harvestBlockersGated = mayHarvest\s*\? harvestBlockers\s*: \[\.\.\.harvestBlockers, NO_PERMISSION_TOOLTIP_TH\];/,
        );
    });

    test('F5 — guarded handlers deny on the RIGHT polarity (!may*)', () => {
        expect(cycleDetailSrc).toMatch(/if \(!mayGenerateQr\) \{/);
    });

    test('F5(b) — EVERY usage site passes the GUARDED plot-QR handler, never the raw one', () => {
        // object-prop form (commonTabProps)
        const objectUses = cycleDetailSrc.match(/handleGeneratePlotQrs:\s*\w+/g) || [];
        expect(objectUses.length).toBeGreaterThan(0);
        for (const use of objectUses) {
            expect(use).toBe('handleGeneratePlotQrs: guardedGeneratePlotQrs');
        }
        // direct JSX-prop form
        const jsxUses = cycleDetailSrc.match(/handleGeneratePlotQrs=\{[^}]+\}/g) || [];
        expect(jsxUses.length).toBeGreaterThan(0);
        for (const use of jsxUses) {
            expect(use).toBe('handleGeneratePlotQrs={guardedGeneratePlotQrs}');
        }
    });

    test('surfaces the standard no-permission Thai copy (tooltip/blocker)', () => {
        expect(cycleDetailSrc).toMatch(/NO_PERMISSION_TOOLTIP_TH/);
    });
});

describe('activities page — per-type gating pins', () => {
    test('F5 — submit gate derives from the EXTRACTED per-type function (full expressions, inversion-proof)', () => {
        expect(activitiesHookSrc).toMatch(/const requiredActivityPermission = activityPermissionFor\(form\.activityType\);/);
        expect(activitiesHookSrc).toMatch(
            /const canLogSelectedActivity =\s*computeCanLogSelectedActivity\(requiredActivityPermission, hasWorkspacePermission\);/,
        );
        // the gate answers before the POST fires, denying on !can
        expect(activitiesHookSrc).toMatch(/if \(!canLogSelectedActivity\) \{/);
    });

    test('F5 — submit button polarity: disabled + tooltip on !canLogSelectedActivity (full JSX expressions)', () => {
        expect(activitiesViewSrc).toMatch(/disabled=\{saving \|\| !canLogSelectedActivity\}/);
        expect(activitiesViewSrc).toMatch(/title=\{!canLogSelectedActivity \? NO_PERMISSION_TOOLTIP_TH : undefined\}/);
        expect(activitiesViewSrc).toMatch(/\{!canLogSelectedActivity && \(/);
    });
});

/**
 * Wave-C adversarial-verify MUST F1 — the permission snapshot must never
 * be terminal in-session: the hook revalidates on every mount (F1(a)) and
 * the gated submit paths evict on a live 403 ENTITY_PERMISSION_DENIED
 * (F1(b)). The eviction/SWR logic itself is TDD'd in
 * lib/services/__tests__/use-entity-permissions.test.ts; these pins keep
 * the WIRING from regressing.
 */
describe('F1 — cache invalidation wiring pins', () => {
    const hookSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', '..', '..', '..', 'lib', 'services', 'use-entity-permissions.ts'),
        'utf8',
    );
    const actionsSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'use-planting-cycle-detail-actions.ts'), 'utf8',
    );
    const loaderSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'use-planting-cycle-detail-data-loader.ts'), 'utf8',
    );

    test('the hook effect ALWAYS revalidates on mount (stale-while-revalidate, no terminal cache early-return)', () => {
        expect(hookSrc).toMatch(/revalidateEntityPermissions\(cacheKey, entityId\)/);
        // the old terminal-cache bug: early return on a cache hit
        expect(hookSrc).not.toMatch(/if \(cached\) \{\s*setState\(cached\);\s*return;/);
    });

    test('cycle-detail passes reportPermissionDenial into BOTH the actions hook and the data loader', () => {
        const wired = cycleDetailSrc.match(/onPermissionDenied: reportPermissionDenial/g) || [];
        expect(wired.length).toBe(2);
    });

    test('every gated-mutation failure branch in the actions hook reports the result', () => {
        // plot QRs + harvest-by-plots = 2 call sites. The four per-plant
        // ones (generate units, its auto-confirm, bulk confirm, reconcile)
        // are gone with the feature R8 retired.
        const calls = actionsSrc.match(/onPermissionDenied\?\.\(result\)/g) || [];
        expect(calls.length).toBe(2);
    });

    test('the auto-QR fire in the data loader reports its failure result too', () => {
        expect(loaderSrc).toMatch(/onPermissionDenied\?\.\(autoQrResult\)/);
    });

    test('the activities submit failure branch reports the result', () => {
        expect(activitiesHookSrc).toMatch(/reportPermissionDenial\(result\)/);
    });
});
