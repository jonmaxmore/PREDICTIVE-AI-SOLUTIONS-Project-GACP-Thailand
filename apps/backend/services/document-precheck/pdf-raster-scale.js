'use strict';

/**
 * Pure raster-scale math for PDF pages, split out of `pdf-extract-worker.js`
 * so it can be unit tested (`extract.test.js`) without pulling in
 * `pdf-parse` — Fix round 1 specifically got `extract.js` (and, by not
 * `require`ing this file's sibling, the test file too) to no longer load
 * pdf-parse's `@napi-rs/canvas` binding in the Jest process at all; a test
 * that needs `pdf-extract-worker.js`'s formula but not pdf-parse itself
 * should not have to pay that back.
 *
 * @module services/document-precheck/pdf-raster-scale
 */

/** I3 (task-4-review.md): the long side of any rasterised page, in pixels. */
const MAX_RASTER_LONG_SIDE_PX = 2500;

/** The scale used when a page's own dimensions would need less than MAX_RASTER_LONG_SIDE_PX to reach it. */
const DEFAULT_SCALE = 2;

/**
 * Page long side (in PDF points) → the `getScreenshot` scale that keeps the
 * rasterised long side ≤ `MAX_RASTER_LONG_SIDE_PX` px. A PDF that declares
 * an enormous page (task-4-review.md's example: 14400×14400 pt) gets a
 * proportionally small scale instead of the fixed default.
 *
 * @param {{width?: number, height?: number}} [pageInfo]
 * @returns {number}
 */
function scaleForPage(pageInfo) {
    const longSidePt = Math.max(pageInfo?.width || 0, pageInfo?.height || 0);
    if (longSidePt <= 0) {
        return DEFAULT_SCALE;
    }
    return Math.min(DEFAULT_SCALE, MAX_RASTER_LONG_SIDE_PX / longSidePt);
}

module.exports = { scaleForPage, MAX_RASTER_LONG_SIDE_PX, DEFAULT_SCALE };
