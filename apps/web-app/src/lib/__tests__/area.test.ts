/**
 * area.test.ts
 *
 * The farm-info step compared plot areas against the farm area by converting
 * everything to rai — `convertToRai(size, plot.areaUnit || 'Rai')` — while the
 * form itself defaulted every new plot and the farm to `'Sqm'`. So the fallback
 * disagreed with the default it was meant to cover, and the summary line above
 * the plot list printed the rai figure with a ตร.ม. suffix: enter a 1,600 m²
 * plot and the wizard told you it was "1 ตร.ม.".
 *
 * There is one unit now. These are the sums the step does with it.
 */

import {
    plotAreaTotalSqm,
    farmAreaSqm,
    plotsExceedFarmArea,
    formatAreaSqm,
    legacyAreaToSqm,
    suggestPlantCount,
    PLANT_DENSITY_PER_SQM,
} from '../area';

describe('plotAreaTotalSqm', () => {
    it('adds the plots up', () => {
        expect(plotAreaTotalSqm([{ areaSize: '400' }, { areaSize: '1200' }])).toBe(1600);
    });

    it('is zero for no plots', () => {
        expect(plotAreaTotalSqm([])).toBe(0);
        expect(plotAreaTotalSqm(undefined)).toBe(0);
    });

    it('ignores a plot whose area has not been typed yet', () => {
        expect(plotAreaTotalSqm([{ areaSize: '' }, { areaSize: '500' }])).toBe(500);
        expect(plotAreaTotalSqm([{ areaSize: undefined }, { areaSize: '500' }])).toBe(500);
    });

    it('ignores something that is not a number rather than producing NaN', () => {
        // A NaN total silently disables the over-allocation check, because
        // every comparison against NaN is false.
        expect(plotAreaTotalSqm([{ areaSize: 'abc' }, { areaSize: '500' }])).toBe(500);
    });

    it('ignores a negative area', () => {
        expect(plotAreaTotalSqm([{ areaSize: '-400' }, { areaSize: '500' }])).toBe(500);
    });

    it('keeps decimals', () => {
        expect(plotAreaTotalSqm([{ areaSize: '0.5' }, { areaSize: '0.25' }])).toBe(0.75);
    });
});

describe('farmAreaSqm', () => {
    it('reads the total the farmer entered', () => {
        expect(farmAreaSqm({ totalAreaSize: '1600' })).toBe(1600);
    });

    it('is zero when nothing has been entered', () => {
        expect(farmAreaSqm({ totalAreaSize: '' })).toBe(0);
        expect(farmAreaSqm({})).toBe(0);
        expect(farmAreaSqm(undefined)).toBe(0);
    });

    it('is zero rather than NaN for junk', () => {
        expect(farmAreaSqm({ totalAreaSize: 'abc' })).toBe(0);
    });
});

describe('plotsExceedFarmArea', () => {
    it('is true when the plots add up to more than the farm', () => {
        expect(plotsExceedFarmArea(1601, 1600)).toBe(true);
    });

    it('is false when they fit exactly', () => {
        expect(plotsExceedFarmArea(1600, 1600)).toBe(false);
    });

    it('is false when they fit with room to spare', () => {
        expect(plotsExceedFarmArea(800, 1600)).toBe(false);
    });

    it('tolerates floating-point dust', () => {
        // 0.1 + 0.2 is 0.30000000000000004. Three plots of 0.1 must not be
        // reported as exceeding a farm of 0.3.
        expect(plotsExceedFarmArea(0.1 + 0.2, 0.3)).toBe(false);
        expect(plotsExceedFarmArea(1000.0000001, 1000)).toBe(false);
    });

    it('still catches a real overrun just above the tolerance', () => {
        expect(plotsExceedFarmArea(1000.01, 1000)).toBe(true);
    });

    it('does not complain before the farm area has been entered', () => {
        // Zero here means "not filled in yet", not "a farm of no size". The
        // farm total is a required field and is validated separately; blocking
        // on it here would show the wrong message.
        expect(plotsExceedFarmArea(500, 0)).toBe(false);
    });
});

describe('formatAreaSqm', () => {
    it('groups thousands the way a Thai reader expects', () => {
        expect(formatAreaSqm(1600)).toBe('1,600');
        expect(formatAreaSqm(160000)).toBe('160,000');
    });

    it('shows decimals only when there are any', () => {
        expect(formatAreaSqm(1600)).toBe('1,600');
        expect(formatAreaSqm(1600.5)).toBe('1,600.5');
        expect(formatAreaSqm(0.25)).toBe('0.25');
    });

    it('does not invent precision', () => {
        expect(formatAreaSqm(1 / 3)).toBe('0.33');
    });

    it('shows zero as zero', () => {
        expect(formatAreaSqm(0)).toBe('0');
    });
});

describe('legacyAreaToSqm', () => {
    /**
     * Rows written before the switch are still in the database until
     * scripts/maintenance/migrate-area-to-sqm.js has run against it. The API
     * converts on the way out, but a client that reads a raw row must not
     * silently render 5 rai as 5 square metres.
     */
    it('leaves square metres alone', () => {
        expect(legacyAreaToSqm(1600, 'sqm')).toBe(1600);
        expect(legacyAreaToSqm(1600, 'Sqm')).toBe(1600);
    });

    it('reads the units that reached the database', () => {
        expect(legacyAreaToSqm(5, 'rai')).toBe(8000);
        expect(legacyAreaToSqm(5, 'Rai')).toBe(8000);
        expect(legacyAreaToSqm(2, 'ngan')).toBe(800);
        expect(legacyAreaToSqm(10, 'sqwa')).toBe(40);
    });

    it('treats an absent unit as square metres, because that is what the API now sends', () => {
        // Unlike the backend reader, this one cannot throw — it renders a
        // number on a page. Square metres is the only defensible reading of a
        // value the API has already normalised.
        expect(legacyAreaToSqm(1600, undefined)).toBe(1600);
        expect(legacyAreaToSqm(1600, null)).toBe(1600);
        expect(legacyAreaToSqm(1600, '')).toBe(1600);
    });

    it('does not multiply by a unit it does not know', () => {
        expect(legacyAreaToSqm(1600, 'hectare')).toBe(1600);
    });

    it('is zero for a negative or unreadable area', () => {
        expect(legacyAreaToSqm(-5, 'rai')).toBe(0);
        expect(legacyAreaToSqm(Number.NaN, 'rai')).toBe(0);
    });
});

describe('suggestPlantCount', () => {
    /**
     * The wizard suggests a plant count; the backend enforces a cap from the
     * same density table. They disagreed: an unrecognised cultivation method
     * gave the frontend a density of 1 and the backend a cap of 2.5, so the
     * suggestion was always low and never explained why.
     */
    it('matches the density the backend enforces', () => {
        expect(PLANT_DENSITY_PER_SQM.OUTDOOR).toBe(2.5);
        expect(PLANT_DENSITY_PER_SQM.GREENHOUSE).toBe(5);
        expect(PLANT_DENSITY_PER_SQM.INDOOR).toBe(8);
        expect(PLANT_DENSITY_PER_SQM.INDOOR_CONTROLLED).toBe(8);
    });

    it('suggests area times density', () => {
        expect(suggestPlantCount(1600, 'OUTDOOR')).toBe(4000);
        expect(suggestPlantCount(1000, 'GREENHOUSE')).toBe(5000);
        expect(suggestPlantCount(1000, 'INDOOR')).toBe(8000);
    });

    it('falls back to the outdoor density for an unknown method, as the backend does', () => {
        expect(suggestPlantCount(1000, 'HYDROPONIC')).toBe(2500);
        expect(suggestPlantCount(1000, '')).toBe(2500);
    });

    it('never suggests more than the backend would allow', () => {
        // A suggestion the backend rejects is worse than no suggestion: the
        // farmer types it in and the save fails with a number they did not
        // choose.
        for (const method of ['OUTDOOR', 'GREENHOUSE', 'INDOOR', 'unknown']) {
            const density = PLANT_DENSITY_PER_SQM[method] ?? PLANT_DENSITY_PER_SQM.OUTDOOR;
            expect(suggestPlantCount(999, method)).toBeLessThanOrEqual(Math.floor(999 * density));
        }
    });

    it('is zero for no area, rather than suggesting one plant on nothing', () => {
        expect(suggestPlantCount(0, 'OUTDOOR')).toBe(0);
        expect(suggestPlantCount(-5, 'OUTDOOR')).toBe(0);
    });
});
