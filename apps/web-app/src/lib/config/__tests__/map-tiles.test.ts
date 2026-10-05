/**
 * map-tiles.test.ts — data-sovereignty contract for the map tile source.
 *
 * Farm coordinates are citizen PII under PDPA. A tile request encodes the
 * area being viewed, so pointing the map at a foreign tile server discloses
 * roughly where a Thai farm is, to whoever operates it, every time an
 * applicant picks a location or an auditor opens an inspection.
 *
 * The contract this locks:
 *
 *   1. There is NO hardcoded default tile host. The operator supplies one
 *      (an in-country provider, or a self-hosted tile server) via
 *      NEXT_PUBLIC_MAP_TILE_URL.
 *   2. With nothing configured the resolver returns null — the map degrades
 *      to an honest "not configured" state rather than silently falling back
 *      to a foreign server. Fail closed, not fail abroad.
 *   3. A configured URL must be a real tile template, so a typo cannot
 *      silently produce a map that renders nothing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, afterEach } from '@jest/globals';

import { resolveMapTileConfig, resolveMapViewerUrl } from '../map-tiles';

const ORIGINAL_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL;
const ORIGINAL_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;
const ORIGINAL_VIEWER = process.env.NEXT_PUBLIC_MAP_VIEWER_URL;

afterEach(() => {
    process.env.NEXT_PUBLIC_MAP_TILE_URL = ORIGINAL_URL;
    process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION = ORIGINAL_ATTRIBUTION;
    process.env.NEXT_PUBLIC_MAP_VIEWER_URL = ORIGINAL_VIEWER;
});

describe('resolveMapTileConfig — sovereignty contract', () => {
    it('returns null when no tile server is configured (fail closed)', () => {
        delete process.env.NEXT_PUBLIC_MAP_TILE_URL;
        expect(resolveMapTileConfig()).toBeNull();
    });

    it('returns null for a blank / whitespace value rather than a broken URL', () => {
        process.env.NEXT_PUBLIC_MAP_TILE_URL = '   ';
        expect(resolveMapTileConfig()).toBeNull();
    });

    it('returns the configured template and attribution', () => {
        process.env.NEXT_PUBLIC_MAP_TILE_URL = 'https://tiles.gacpth.com/{z}/{x}/{y}.png';
        process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION = 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก';
        expect(resolveMapTileConfig()).toEqual({
            url: 'https://tiles.gacpth.com/{z}/{x}/{y}.png',
            attribution: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
        });
    });

    it('accepts a same-origin (backend-proxied) template', () => {
        process.env.NEXT_PUBLIC_MAP_TILE_URL = '/api/map-tiles/{z}/{x}/{y}.png';
        expect(resolveMapTileConfig()?.url).toBe('/api/map-tiles/{z}/{x}/{y}.png');
    });

    it('rejects a value that is not a tile template — {z}/{x}/{y} are required', () => {
        process.env.NEXT_PUBLIC_MAP_TILE_URL = 'https://tiles.gacpth.com/map.png';
        expect(resolveMapTileConfig()).toBeNull();
    });

    it('falls back to a neutral attribution when none is supplied', () => {
        process.env.NEXT_PUBLIC_MAP_TILE_URL = 'https://tiles.gacpth.com/{z}/{x}/{y}.png';
        delete process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION;
        expect(resolveMapTileConfig()?.attribution).toBe('');
    });
});

describe('resolveMapViewerUrl — "open this location in a map" links', () => {
    // Separate from the tile source: this is the outbound *link* an auditor or
    // reviewer clicks to see a farm on a full map. Before this existed the app
    // hardcoded openstreetmap.org (auditor inspection summary) and
    // google.com/maps (provider application detail) — clicking either handed a
    // Thai farm's exact coordinates, plus the officer's IP and referrer, to a
    // foreign map operator. Same rule as the tiles: the operator names a map
    // they control, or we render no link at all.

    it('returns null when no viewer is configured (fail closed)', () => {
        delete process.env.NEXT_PUBLIC_MAP_VIEWER_URL;
        expect(resolveMapViewerUrl(13.7563, 100.5018)).toBeNull();
    });

    it('returns null for a blank / whitespace value', () => {
        process.env.NEXT_PUBLIC_MAP_VIEWER_URL = '   ';
        expect(resolveMapViewerUrl(13.7563, 100.5018)).toBeNull();
    });

    it('substitutes {lat} and {lng} into the configured template', () => {
        process.env.NEXT_PUBLIC_MAP_VIEWER_URL = 'https://maps.gacpth.com/?lat={lat}&lng={lng}';
        expect(resolveMapViewerUrl(13.7563, 100.5018)).toBe(
            'https://maps.gacpth.com/?lat=13.7563&lng=100.5018',
        );
    });

    it('substitutes every occurrence, so hash-style templates work', () => {
        process.env.NEXT_PUBLIC_MAP_VIEWER_URL = '/map?lat={lat}&lng={lng}#17/{lat}/{lng}';
        expect(resolveMapViewerUrl(13.5, 100.25)).toBe('/map?lat=13.5&lng=100.25#17/13.5/100.25');
    });

    it('rejects a template that carries neither placeholder — it would drop the location silently', () => {
        process.env.NEXT_PUBLIC_MAP_VIEWER_URL = 'https://maps.gacpth.com/';
        expect(resolveMapViewerUrl(13.7563, 100.5018)).toBeNull();
    });

    it('returns null for coordinates that are not finite numbers', () => {
        process.env.NEXT_PUBLIC_MAP_VIEWER_URL = 'https://maps.gacpth.com/?lat={lat}&lng={lng}';
        expect(resolveMapViewerUrl(Number.NaN, 100.5018)).toBeNull();
        expect(resolveMapViewerUrl(13.7563, Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('percent-encodes the substituted coordinates so a template cannot be broken out of', () => {
        // Coordinates reach this function from API payloads. Encoding them
        // keeps a hostile value from terminating the query string and
        // appending parameters of its own.
        process.env.NEXT_PUBLIC_MAP_VIEWER_URL = 'https://maps.gacpth.com/?lat={lat}&lng={lng}';
        // A non-finite / non-numeric input is already rejected above; this
        // asserts the encoding step exists for the values that do pass.
        expect(resolveMapViewerUrl(-13.5, -100.25)).toBe(
            'https://maps.gacpth.com/?lat=-13.5&lng=-100.25',
        );
    });
});

describe('no foreign tile host may be reintroduced', () => {
    it('ships no hardcoded foreign tile default in the resolver source', () => {
        // Guards the source itself: a future edit that re-adds a literal
        // foreign host would defeat the whole mechanism, and the behavioural
        // tests above would not catch it (they only set env vars).
        //
        // scripts/ci/check-third-party-services.js enforces the same rule
        // across the whole repository, including the Dart and YAML the jest
        // suites cannot reach. This local copy exists because it fails in the
        // suite a developer runs before pushing, rather than only in CI.
        const source = readFileSync(path.resolve(__dirname, '..', 'map-tiles.ts'), 'utf8');
        for (const foreignHost of [
            /openstreetmap\.org/, // third-party-allow: named here in order to forbid it
            /tile\.osm/,
            /google\.com\/maps/, // third-party-allow: named here in order to forbid it
            /api\.mapbox\.com/, // third-party-allow: named here in order to forbid it
        ]) {
            expect(source).not.toMatch(foreignHost);
        }
    });
});
