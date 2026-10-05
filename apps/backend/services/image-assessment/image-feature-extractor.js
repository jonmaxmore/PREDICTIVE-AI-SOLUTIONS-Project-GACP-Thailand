'use strict';

/**
 * Image Feature Extractor — สัญญา C05F680149 ต้นแบบที่ 6.
 * Extracts REAL image features with `sharp` (already a dependency — no new ML
 * runtime): resolution, brightness, colour means, and lesion ratios
 * (dark-spot / white-coverage / yellowing) from a downsampled pixel buffer.
 * These features feed both image inspection (6.1) and the disease classifier
 * (6.3). Pure pixel math lives in `deriveLesionRatios` (unit-testable without
 * sharp).
 */

let sharpLib = null;
function getSharp() {
    if (!sharpLib) {
        // Lazy require: keeps the module importable in environments without the
        // native binary (tests mock this module); real routes have sharp.
        sharpLib = require('sharp');
    }
    return sharpLib;
}

const SAMPLE_SIZE = 64; // downsample edge for cheap per-pixel analysis

/**
 * Pure: classify each RGB pixel and return coverage ratios + colour means.
 * @param {Buffer|Uint8Array} data — interleaved pixels
 * @param {number} channels — 3 (RGB) or 4 (RGBA)
 * @param {number} [side] — grid width (rows are `side` px wide) for the spot
 *   fragmentation texture metric; defaults to round(sqrt(pixelCount)).
 *
 * Two features added for ต้นแบบ-6 classifier v2 (2026-07-11): `brownRatio`
 * (brown necrotic tissue — separates blight/leaf-spot from black rot/pest) and
 * `spotFragmentation` (dark-region edge density normalised by dark area — HIGH
 * for many discrete lesions like leaf-spot/pest chewing, LOW for one contiguous
 * necrotic patch like blight). These are what let the classifier tell the
 * dark-based diseases apart, which brightness+darkRatio alone cannot.
 */
function deriveLesionRatios(data, channels, side) {
    const step = channels >= 3 ? channels : 3;
    const pixelCount = Math.floor(data.length / step);
    if (pixelCount === 0) {
        return { colorMeans: { r: 0, g: 0, b: 0 }, brightness: 0, darkSpotRatio: 0, whiteCoverageRatio: 0, yellowRatio: 0, brownRatio: 0, spotFragmentation: 0 };
    }
    const gridSide = Number.isInteger(side) && side > 0 ? side : Math.round(Math.sqrt(pixelCount));

    let sumR = 0, sumG = 0, sumB = 0;
    let dark = 0, white = 0, yellow = 0, brown = 0, lesion = 0;
    const isLesion = new Uint8Array(pixelCount); // dark OR brown necrotic tissue

    for (let i = 0; i < pixelCount; i++) {
        const o = i * step;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        sumR += r; sumG += g; sumB += b;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        let les = false;
        if (lum < 60) { dark += 1; les = true; }             // dark necrotic lesion
        if (r > 190 && g > 190 && b > 190) { white += 1; }   // white powdery coverage
        if (r > 150 && g > 150 && b < 110) { yellow += 1; }  // yellowing (viral/nutrient)
        // brown necrosis: warm mid-tone, r>g>b, not too dark/bright
        if (r >= 80 && r <= 200 && g >= 40 && g <= 150 && r > g + 12 && g > b && b < 110 && lum >= 45) { brown += 1; les = true; }
        if (les) { lesion += 1; isLesion[i] = 1; }
    }

    // spot fragmentation: dark↔/brown↔healthy transitions scanning rows+cols,
    // normalised by lesion area. One big necrotic patch (blight/rot) → few
    // transitions per lesion pixel (LOW); many small discrete lesions
    // (leaf-spot/pest) → many (HIGH). Counts BROWN lesions too, so brown spots
    // register (v1's dark-only frag missed leaf-spot entirely). Bounded [0,~4].
    let transitions = 0;
    if (gridSide > 1 && gridSide * gridSide <= pixelCount) {
        for (let y = 0; y < gridSide; y++) {
            for (let x = 1; x < gridSide; x++) {
                if (isLesion[y * gridSide + x] !== isLesion[y * gridSide + x - 1]) { transitions += 1; }
            }
        }
        for (let x = 0; x < gridSide; x++) {
            for (let y = 1; y < gridSide; y++) {
                if (isLesion[y * gridSide + x] !== isLesion[(y - 1) * gridSide + x]) { transitions += 1; }
            }
        }
    }
    const spotFragmentation = lesion > 0 ? Math.min(4, transitions / lesion) : 0;

    return {
        colorMeans: {
            r: Math.round(sumR / pixelCount),
            g: Math.round(sumG / pixelCount),
            b: Math.round(sumB / pixelCount),
        },
        brightness: Math.round((sumR + sumG + sumB) / (pixelCount * 3)),
        darkSpotRatio: dark / pixelCount,
        whiteCoverageRatio: white / pixelCount,
        yellowRatio: yellow / pixelCount,
        brownRatio: brown / pixelCount,
        spotFragmentation,
    };
}

/**
 * Extract features from an image path or buffer.
 * @param {string|Buffer} input
 */
async function extractImageFeatures(input) {
    const sharp = getSharp();
    const metadata = await sharp(input).metadata();

    // Downsample to a fixed small size (RGB) for cheap per-pixel analysis.
    const { data, info } = await sharp(input)
        .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const lesion = deriveLesionRatios(data, info.channels || 3, SAMPLE_SIZE);

    return {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || null,
        channels: metadata.channels || info.channels || 3,
        ...lesion,
    };
}

module.exports = { extractImageFeatures, deriveLesionRatios };
