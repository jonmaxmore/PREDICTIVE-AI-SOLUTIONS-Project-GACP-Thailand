/**
 * What cultivation method an application actually states.
 *
 * `mapAreaTypeToSolarSystem` in certificate-service returned 'OUTDOOR' for
 * anything it did not recognise — including an empty string, including null.
 * Its result is written to `Farm.cultivationMethod` at issuance, overwriting
 * whatever the farm itself said, and it becomes "วิธีการปลูก" on the printed
 * application form.
 *
 * The wizard never set `formData.locationType` for a new application (nothing
 * in the flow called the setter), so that fallback fired for every applicant:
 * indoor growers' legal paperwork said outdoor, their certified farm records
 * were rewritten to outdoor, and DTAM's cultivation statistics read 100%
 * outdoor for the whole country.
 *
 * The frontend now derives the value. This is the same rule on the server, so
 * an application submitted by the mobile client or an older web build is read
 * the same way — and so that "we do not know" is an answer the caller has to
 * handle rather than a silent OUTDOOR.
 */

const {
    normalizeCultivationMethod,
    mostControlledMethod,
    applicationCultivationMethod,
} = require('../../shared/cultivation-method');

describe('normalizeCultivationMethod', () => {
    it('accepts the tokens the web wizard writes', () => {
        expect(normalizeCultivationMethod('outdoor')).toBe('OUTDOOR');
        expect(normalizeCultivationMethod('greenhouse')).toBe('GREENHOUSE');
        expect(normalizeCultivationMethod('indoor')).toBe('INDOOR');
    });

    it('accepts the tokens the API and Prisma use', () => {
        expect(normalizeCultivationMethod('OUTDOOR')).toBe('OUTDOOR');
        expect(normalizeCultivationMethod('INDOOR_CONTROLLED')).toBe('INDOOR');
    });

    it('is null for anything else, rather than outdoor', () => {
        expect(normalizeCultivationMethod('')).toBeNull();
        expect(normalizeCultivationMethod(null)).toBeNull();
        expect(normalizeCultivationMethod(undefined)).toBeNull();
        expect(normalizeCultivationMethod('hydroponic')).toBeNull();
        expect(normalizeCultivationMethod('   ')).toBeNull();
    });
});

describe('mostControlledMethod', () => {
    it('picks the most controlled environment present', () => {
        // No single answer is true for a mixed farm. The more controlled one
        // carries the higher fee and the stricter obligations, so erring there
        // does not under-charge or under-regulate anyone.
        expect(mostControlledMethod(['outdoor', 'indoor'])).toBe('INDOOR');
        expect(mostControlledMethod(['outdoor', 'greenhouse'])).toBe('GREENHOUSE');
        expect(mostControlledMethod(['greenhouse', 'indoor'])).toBe('INDOOR');
    });

    it('returns the only one when there is only one', () => {
        expect(mostControlledMethod(['outdoor'])).toBe('OUTDOOR');
    });

    it('skips tokens it cannot read', () => {
        expect(mostControlledMethod(['hydroponic', 'greenhouse'])).toBe('GREENHOUSE');
        expect(mostControlledMethod(['hydroponic'])).toBeNull();
    });

    it('is null for nothing', () => {
        expect(mostControlledMethod([])).toBeNull();
        expect(mostControlledMethod(null)).toBeNull();
        expect(mostControlledMethod(undefined)).toBeNull();
    });
});

describe('applicationCultivationMethod', () => {
    it('uses what the application explicitly states', () => {
        expect(applicationCultivationMethod({ formData: { locationType: 'GREENHOUSE' } }))
            .toBe('GREENHOUSE');
    });

    it('falls back to areaType, in either position', () => {
        expect(applicationCultivationMethod({ areaType: 'INDOOR' })).toBe('INDOOR');
        expect(applicationCultivationMethod({ formData: { areaType: 'INDOOR' } })).toBe('INDOOR');
    });

    it('reads the plots when the application states nothing', () => {
        expect(applicationCultivationMethod({
            formData: { plots: [{ solarSystem: 'GREENHOUSE' }, { solarSystem: 'GREENHOUSE' }] },
        })).toBe('GREENHOUSE');
    });

    it('reads the per-plot cultivationMethod alias too', () => {
        expect(applicationCultivationMethod({
            formData: { plots: [{ cultivationMethod: 'indoor' }] },
        })).toBe('INDOOR');
    });

    it('reads the method list last', () => {
        expect(applicationCultivationMethod({ formData: { cultivationMethods: ['greenhouse'] } }))
            .toBe('GREENHOUSE');
    });

    it('prefers an explicit statement over the plots', () => {
        expect(applicationCultivationMethod({
            formData: { locationType: 'INDOOR', plots: [{ solarSystem: 'OUTDOOR' }] },
        })).toBe('INDOOR');
    });

    it('is null when the application says nothing anywhere', () => {
        // The caller decides what to do about that. Previously it was
        // indistinguishable from a farm that had said "outdoor".
        expect(applicationCultivationMethod({})).toBeNull();
        expect(applicationCultivationMethod({ formData: {} })).toBeNull();
        expect(applicationCultivationMethod(null)).toBeNull();
        expect(applicationCultivationMethod({ formData: { locationType: '' } })).toBeNull();
    });
});
