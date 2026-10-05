/**
 * interactive-map-self-host-icons.test.tsx — RF-MAP-ICONS regression.
 *
 * The farm-location wizard step (`health/applications/new` → farm-info-step)
 * lazy-loads `components/feature/interactive-map.tsx`. That file used to point
 * Leaflet's default marker icons at https://cdnjs.cloudflare.com/... (a
 * Cloudflare US CDN), forcing a foreign third-party asset fetch on every
 * applicant who opened the step.
 *
 * RF-MAP-ICONS self-hosts those icons: the three Leaflet marker PNGs are
 * committed under `public/leaflet/` and referenced by their same-origin string
 * path (`/leaflet/marker-*.png`), so the browser never touches cdnjs. (A PNG
 * static-import was avoided because its `*.png` type comes from the gitignored,
 * auto-generated `next-env.d.ts`, which the CI standalone `tsc --noEmit` lacks
 * → TS2307.)
 *
 * Strategy: source-string assertions via `readFileSync` (same approach as
 * `x3-fix-b-gov-gradient.test.tsx` in this folder) — Leaflet touches `window`
 * at module load (see `components/feature/index.ts`), so mounting it under jsdom
 * is avoided; the import/merge contract is locked at the source level instead.
 *
 * The TILE source was, when this file was written, deliberately left unpinned:
 * choosing a provider was an open owner decision. That decision is now made,
 * and made in a way that did not require picking a vendor — the component
 * takes its tile source from `lib/config/map-tiles`, which has no built-in
 * default at all. The operator configures a source they control, and with
 * nothing configured the map renders an honest "not configured" state instead
 * of quietly falling back abroad. So the tile source IS asserted here now: no
 * foreign host may reappear as a literal.
 *
 * See `lib/config/__tests__/map-tiles.test.ts` for the resolver's behaviour
 * and `scripts/ci/check-third-party-services.js` for the repo-wide gate.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAP_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'interactive-map.tsx'),
    'utf8',
);

describe('RF-MAP-ICONS — Leaflet marker icons are self-hosted (no cdnjs)', () => {
    it('does not fetch marker icons from cdnjs.cloudflare.com', () => {
        expect(MAP_SOURCE).not.toContain('cdnjs.cloudflare.com');
    });

    it('does not reference any cloudflare CDN host for icons', () => {
        // Broader guard: no cdnjs / cloudflare CDN host string at all.
        expect(MAP_SOURCE).not.toMatch(/cdnjs|cloudflare/i);
    });

    it('references the three marker PNGs by same-origin /leaflet/ path (committed in public/)', () => {
        expect(MAP_SOURCE).toContain('/leaflet/marker-icon-2x.png');
        expect(MAP_SOURCE).toContain('/leaflet/marker-icon.png');
        expect(MAP_SOURCE).toContain('/leaflet/marker-shadow.png');
    });

    it('does NOT static-import the PNGs (CI standalone tsc has no next-env.d.ts → TS2307)', () => {
        expect(MAP_SOURCE).not.toMatch(/from\s+['"]leaflet\/dist\/images\/[^'"]+\.png['"]/);
    });

    it('draws tiles only from the configured source — no foreign host literal', () => {
        for (const foreignHost of [
            /openstreetmap\.org/, // third-party-allow: named here in order to forbid it
            /tile\.osm/,
            /api\.mapbox\.com/, // third-party-allow: named here in order to forbid it
            /maptiler\.com/, // third-party-allow: named here in order to forbid it
        ]) {
            expect(MAP_SOURCE).not.toMatch(foreignHost);
        }
        expect(MAP_SOURCE).toContain('resolveMapTileConfig');
    });

    it('wires the same-origin icon paths into L.Icon.Default.mergeOptions', () => {
        expect(MAP_SOURCE).toMatch(/L\.Icon\.Default\.mergeOptions\(/);
        expect(MAP_SOURCE).toMatch(/iconRetinaUrl:\s*'\/leaflet\/marker-icon-2x\.png'/);
        expect(MAP_SOURCE).toMatch(/iconUrl:\s*'\/leaflet\/marker-icon\.png'/);
        expect(MAP_SOURCE).toMatch(/shadowUrl:\s*'\/leaflet\/marker-shadow\.png'/);
    });
});
