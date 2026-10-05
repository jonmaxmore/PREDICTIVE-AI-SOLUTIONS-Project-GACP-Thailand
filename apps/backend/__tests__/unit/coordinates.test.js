'use strict';

/**
 * A missing coordinate is NULL. It is never 0.
 *
 * `parseFloat(farmData.gpsLat || 0)` was how application submission spelled "the farmer
 * gave no position" until 2026-08-27 — and 0°N 0°E is a real point in the Gulf of Guinea.
 * Every reader downstream (the GPS check-in tolerance, the per-photo distance the evidence
 * provenance layer records) would then have measured a Thai farm against West Africa and
 * reported it 9,000 km off with total confidence. A wrong number and a missing number must
 * never look the same.
 */

const { parseCoordinate, coordinatePairFrom } = require('../../shared/coordinates');

describe('parseCoordinate', () => {
    it.each([
        [undefined, null],
        [null, null],
        ['', null],
        ['   ', null],
        ['abc', null],
        [NaN, null],
        [Infinity, null],
    ])('%p is missing → null, never 0', (input, expected) => {
        expect(parseCoordinate(input)).toBe(expected);
    });

    it.each([
        ['18.796143', 18.796143],
        ['98.953608', 98.953608],
        [18.796143, 18.796143],
        ['-33.8688', -33.8688],
    ])('%p is a coordinate → the number', (input, expected) => {
        expect(parseCoordinate(input)).toBe(expected);
    });

    it('keeps a genuine 0 — the equator is a place, absence is not', () => {
        expect(parseCoordinate('0')).toBe(0);
        expect(parseCoordinate(0)).toBe(0);
    });
});

describe('coordinatePairFrom', () => {
    it('reads the wizard spelling (gpsLat/gpsLng)', () => {
        expect(coordinatePairFrom({ gpsLat: '18.796143', gpsLng: '98.953608' }))
            .toEqual({ latitude: 18.796143, longitude: 98.953608 });
    });

    it('falls back to the older latitude/longitude spelling', () => {
        expect(coordinatePairFrom({ latitude: 18.796143, longitude: 98.953608 }))
            .toEqual({ latitude: 18.796143, longitude: 98.953608 });
    });

    it('prefers the wizard spelling when both are present', () => {
        expect(coordinatePairFrom({ gpsLat: '1', gpsLng: '2', latitude: 9, longitude: 9 }))
            .toEqual({ latitude: 1, longitude: 2 });
    });

    it.each([
        ['latitude only', { gpsLat: '18.796143' }],
        ['longitude only', { gpsLng: '98.953608' }],
        ['one half unreadable', { gpsLat: '18.796143', gpsLng: 'north' }],
        ['nothing', {}],
        ['no source at all', undefined],
    ])('%s → both null: a half-located farm is an unlocated farm', (_name, source) => {
        expect(coordinatePairFrom(source)).toEqual({ latitude: null, longitude: null });
    });
});
