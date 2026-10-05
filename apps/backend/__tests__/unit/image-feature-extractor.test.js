'use strict';

/**
 * Pixel-math core of the feature extractor (สัญญา C05F680149 ต้นแบบที่ 6.1).
 * deriveLesionRatios is the REAL computer-vision primitive (no ML): it
 * classifies each RGB pixel into dark / white / yellow coverage. Pure —
 * testable without sharp.
 */

const { deriveLesionRatios } = require('../../services/image-assessment/image-feature-extractor');

// helper: build an interleaved RGB buffer from a list of [r,g,b]
function rgbBuffer(pixels) {
    const buf = Buffer.alloc(pixels.length * 3);
    pixels.forEach(([r, g, b], i) => {
        buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b;
    });
    return buf;
}

describe('deriveLesionRatios', () => {
    test('all-green pixels → high green mean, ~zero lesion ratios', () => {
        const buf = rgbBuffer(Array.from({ length: 100 }, () => [40, 160, 40]));
        const r = deriveLesionRatios(buf, 3);
        expect(r.colorMeans.g).toBe(160);
        expect(r.darkSpotRatio).toBe(0);
        expect(r.whiteCoverageRatio).toBe(0);
        expect(r.yellowRatio).toBe(0);
    });

    test('half black → darkSpotRatio ~0.5', () => {
        const buf = rgbBuffer([
            ...Array.from({ length: 50 }, () => [0, 0, 0]),
            ...Array.from({ length: 50 }, () => [40, 160, 40]),
        ]);
        const r = deriveLesionRatios(buf, 3);
        expect(r.darkSpotRatio).toBeCloseTo(0.5, 2);
    });

    test('white pixels → whiteCoverageRatio counts them', () => {
        const buf = rgbBuffer([
            ...Array.from({ length: 30 }, () => [230, 230, 230]),
            ...Array.from({ length: 70 }, () => [40, 160, 40]),
        ]);
        const r = deriveLesionRatios(buf, 3);
        expect(r.whiteCoverageRatio).toBeCloseTo(0.3, 2);
    });

    test('yellow pixels (high r,g low b) → yellowRatio counts them', () => {
        const buf = rgbBuffer([
            ...Array.from({ length: 25 }, () => [200, 200, 60]),
            ...Array.from({ length: 75 }, () => [40, 160, 40]),
        ]);
        const r = deriveLesionRatios(buf, 3);
        expect(r.yellowRatio).toBeCloseTo(0.25, 2);
    });

    test('RGBA (4 channels) is handled — alpha byte skipped', () => {
        const buf = Buffer.alloc(4 * 4);
        for (let i = 0; i < 4; i++) {
            buf[i * 4] = 0; buf[i * 4 + 1] = 0; buf[i * 4 + 2] = 0; buf[i * 4 + 3] = 255;
        }
        const r = deriveLesionRatios(buf, 4);
        expect(r.darkSpotRatio).toBe(1);
    });

    test('empty buffer → zeros, no crash', () => {
        const r = deriveLesionRatios(Buffer.alloc(0), 3);
        expect(r.darkSpotRatio).toBe(0);
        expect(r.colorMeans).toEqual({ r: 0, g: 0, b: 0 });
    });
});
