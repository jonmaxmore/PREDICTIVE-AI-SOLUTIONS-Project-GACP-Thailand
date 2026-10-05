/**
 * Map tile source — data-sovereignty contract.
 *
 * Farm coordinates are citizen PII under PDPA. A map tile request encodes
 * the area being viewed ({z}/{x}/{y}), so whoever serves the tiles learns
 * roughly where a Thai farm is — plus the citizen's IP — every time an
 * applicant picks a location or an auditor opens an inspection map. Until
 * this module existed the app pointed at a foreign tile server, which meant
 * that disclosure happened on every map view.
 *
 * The rule here is **fail closed, not fail abroad**: there is deliberately
 * NO built-in default. The operator points the map at a source they control
 * — an in-country provider, a self-hosted tile server (TileServer-GL,
 * OSM mirror), or a same-origin backend proxy — by setting:
 *
 *   NEXT_PUBLIC_MAP_TILE_URL          e.g. https://tiles.gacpth.com/{z}/{x}/{y}.png
 *                                     or   /api/map-tiles/{z}/{x}/{y}.png
 *   NEXT_PUBLIC_MAP_TILE_ATTRIBUTION  credit line required by that source
 *
 * With nothing configured the map renders an honest "not configured" state
 * showing the coordinates as text. That is the same honesty contract the
 * rest of this app follows: never quietly do the wrong thing to keep a
 * screen looking complete.
 *
 * NOTE for whoever configures this: the tile host must also be added to the
 * CSP `img-src` in `src/middleware.ts` (a same-origin proxy needs no change).
 */

export interface MapTileConfig {
    /** Leaflet URL template, e.g. `https://host/{z}/{x}/{y}.png`. */
    url: string;
    /** Attribution line the tile source requires. May be empty. */
    attribution: string;
}

/** A usable tile template must address a tile: zoom, column and row. */
const TILE_TEMPLATE_TOKENS = ['{z}', '{x}', '{y}'] as const;

/**
 * Resolve the configured tile source, or null when the platform has no
 * in-country map to draw with.
 *
 * Returns null (rather than a foreign fallback) for: unset, blank, or a
 * value that is not a tile template — a typo'd URL would otherwise render
 * an empty grey map with no explanation.
 */
export function resolveMapTileConfig(): MapTileConfig | null {
    const url = (process.env.NEXT_PUBLIC_MAP_TILE_URL ?? '').trim();
    if (!url) {
        return null;
    }
    if (!TILE_TEMPLATE_TOKENS.every((token) => url.includes(token))) {
        return null;
    }
    return {
        url,
        attribution: (process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ?? '').trim(),
    };
}

/** A usable viewer template must be able to carry the point it should show. */
const VIEWER_TEMPLATE_TOKENS = ['{lat}', '{lng}'] as const;

/**
 * Build the "open this location in a map" link for a coordinate pair, or null
 * when no viewer the operator controls has been configured.
 *
 * This is the *link* an auditor or reviewer clicks, as opposed to the tiles the
 * app draws itself. It leaks the same thing and more: the target host receives
 * the farm's exact coordinates in the URL, plus the officer's IP and (unless
 * stripped) the referring page. The app used to hardcode two different foreign
 * viewers here, so the rule is the same as for tiles — no built-in default:
 *
 *   NEXT_PUBLIC_MAP_VIEWER_URL   e.g. https://maps.gacpth.com/?lat={lat}&lng={lng}
 *                                or   /map?lat={lat}&lng={lng}
 *
 * Every `{lat}` / `{lng}` occurrence is replaced, so hash-fragment templates
 * that repeat the point (`...#17/{lat}/{lng}`) work too.
 *
 * With nothing configured the callers show the coordinates as selectable text.
 * An officer who needs a map can paste them into whatever tool they already
 * trust — that is their choice on their device, not a disclosure this platform
 * makes on their behalf.
 */
export function resolveMapViewerUrl(lat: number, lng: number): string | null {
    const template = (process.env.NEXT_PUBLIC_MAP_VIEWER_URL ?? '').trim();
    if (!template) {
        return null;
    }
    if (!VIEWER_TEMPLATE_TOKENS.some((token) => template.includes(token))) {
        return null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return template
        .split('{lat}')
        .join(encodeURIComponent(String(lat)))
        .split('{lng}')
        .join(encodeURIComponent(String(lng)));
}
