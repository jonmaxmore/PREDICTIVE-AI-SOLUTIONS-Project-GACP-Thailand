/**
 * The plant cap is computed from square metres, and there is no other option.
 *
 * `calculateMaxPlants(areaSize, areaUnit = 'Rai', cultivationType)` had a unit
 * parameter that defaulted to rai. `shared/area-utils` defaulted the same
 * absent value to square metres. So the answer to "how many plants may this
 * farm register?" depended on which module you asked, and the two answers
 * differed by 1,600×.
 *
 * The cap decides how many QR-coded plant units a licensed grower may create.
 * Too low and a legitimate farm cannot register its crop; too high and the
 * platform mints traceability codes for plants that no inspector has counted.
 * Neither is a rounding error.
 *
 * The unit parameter is gone. The function takes square metres.
 */

const {
    PLANT_DENSITY,
    calculateMaxPlants,
    getDensityRate,
} = require('../../config/plant-density');

describe('calculateMaxPlants', () => {
    describe('takes square metres', () => {
        it.each([
            ['OUTDOOR', 2.5],
            ['GREENHOUSE', 5],
            ['INDOOR', 8],
            ['INDOOR_CONTROLLED', 8],
        ])('%s allows %s plants per square metre', (method, perSqm) => {
            expect(calculateMaxPlants(1000, method)).toBe(Math.floor(1000 * perSqm));
        });

        it('scales linearly', () => {
            expect(calculateMaxPlants(1600, 'OUTDOOR')).toBe(4000);
            expect(calculateMaxPlants(3200, 'OUTDOOR')).toBe(8000);
            expect(calculateMaxPlants(16000, 'OUTDOOR')).toBe(40000);
        });

        it('is exactly the published per-rai figure for 1,600 m²', () => {
            // The GACP tables are published per rai. Anyone checking this code
            // against them will convert 1,600 m² and expect these numbers.
            expect(calculateMaxPlants(1600, 'OUTDOOR')).toBe(PLANT_DENSITY.DENSITY_RATES.OUTDOOR.plantsPerRai);
            expect(calculateMaxPlants(1600, 'GREENHOUSE')).toBe(PLANT_DENSITY.DENSITY_RATES.GREENHOUSE.plantsPerRai);
            expect(calculateMaxPlants(1600, 'INDOOR')).toBe(PLANT_DENSITY.DENSITY_RATES.INDOOR.plantsPerRai);
        });
    });

    describe('there is no unit argument to get wrong', () => {
        it('reads the second argument as the cultivation method, not a unit', () => {
            // If a caller left `'rai'` in the old second position, it must not
            // be interpreted as an area unit — and it is not a method either,
            // so it falls to the default density rather than multiplying by
            // 1,600.
            expect(calculateMaxPlants(1000, 'rai')).toBe(calculateMaxPlants(1000, 'DEFAULT'));
        });

        it('has an arity of at most two', () => {
            expect(calculateMaxPlants.length).toBeLessThanOrEqual(2);
        });
    });

    describe('an unknown cultivation method is the most restrictive one', () => {
        it('falls back to the outdoor density, not the indoor one', () => {
            // Guessing high would let a farm mint 8 units per square metre on
            // the strength of a typo.
            expect(calculateMaxPlants(1000)).toBe(2500);
            expect(calculateMaxPlants(1000, 'HYDROPONIC')).toBe(2500);
            expect(calculateMaxPlants(1000, null)).toBe(2500);
            expect(calculateMaxPlants(1000, '')).toBe(2500);
        });

        it('accepts a method in any casing', () => {
            expect(calculateMaxPlants(1000, 'greenhouse')).toBe(5000);
            expect(calculateMaxPlants(1000, 'GreenHouse')).toBe(5000);
        });
    });

    describe('areas that are not areas', () => {
        it('is zero for zero, absent, negative, or unparseable', () => {
            expect(calculateMaxPlants(0, 'OUTDOOR')).toBe(0);
            expect(calculateMaxPlants(null, 'OUTDOOR')).toBe(0);
            expect(calculateMaxPlants(undefined, 'OUTDOOR')).toBe(0);
            expect(calculateMaxPlants(-100, 'OUTDOOR')).toBe(0);
            expect(calculateMaxPlants('abc', 'OUTDOOR')).toBe(0);
            expect(calculateMaxPlants(NaN, 'OUTDOOR')).toBe(0);
            expect(calculateMaxPlants(Infinity, 'OUTDOOR')).toBe(0);
        });

        it('reads a numeric string, because Prisma Decimal arrives as one', () => {
            expect(calculateMaxPlants('1000', 'OUTDOOR')).toBe(2500);
        });

        it('never returns a fraction of a plant', () => {
            // 2.5 plants/m² on an odd area. Rounding up would authorise one
            // plant more than the density allows.
            expect(calculateMaxPlants(1, 'OUTDOOR')).toBe(2);
            expect(calculateMaxPlants(3, 'OUTDOOR')).toBe(7);
            expect(Number.isInteger(calculateMaxPlants(999.9, 'GREENHOUSE'))).toBe(true);
        });
    });

    describe('the density table itself', () => {
        it('states the per-rai figure consistently with the per-sqm one', () => {
            for (const [name, rate] of Object.entries(PLANT_DENSITY.DENSITY_RATES)) {
                expect(`${name}: ${rate.plantsPerRai}`).toBe(`${name}: ${rate.plantsPerSqm * 1600}`);
            }
        });

        it('orders the methods from least to most dense', () => {
            const { OUTDOOR, GREENHOUSE, INDOOR } = PLANT_DENSITY.DENSITY_RATES;
            expect(OUTDOOR.plantsPerSqm).toBeLessThan(GREENHOUSE.plantsPerSqm);
            expect(GREENHOUSE.plantsPerSqm).toBeLessThan(INDOOR.plantsPerSqm);
        });

        it('defaults to the outdoor rate', () => {
            expect(PLANT_DENSITY.DENSITY_RATES.DEFAULT.plantsPerSqm)
                .toBe(PLANT_DENSITY.DENSITY_RATES.OUTDOOR.plantsPerSqm);
        });

        it('no longer carries a unit-conversion table — that lives in one place', () => {
            expect(PLANT_DENSITY.AREA_CONVERSION).toBeUndefined();
        });
    });

    describe('getDensityRate', () => {
        it('returns the rate for a known method', () => {
            expect(getDensityRate('GREENHOUSE').plantsPerSqm).toBe(5);
        });

        it('returns the default for anything else', () => {
            expect(getDensityRate('nonsense').plantsPerSqm).toBe(2.5);
            expect(getDensityRate(null).plantsPerSqm).toBe(2.5);
        });
    });
});
