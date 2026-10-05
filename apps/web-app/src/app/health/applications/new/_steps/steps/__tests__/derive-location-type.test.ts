/**
 * The cultivation method the application says it uses.
 *
 * `state.locationType` is written by exactly one place in this codebase: the
 * edit page, hydrating a value from an application that already exists. No step
 * of the new-application wizard ever sets it. So for every new application it
 * is null, and both submit paths sent `state.locationType || 'OUTDOOR'`.
 *
 * That single field is not cosmetic. It becomes:
 *   - "วิธีการปลูก" on the printed application form (pdf/application-template-service.js:194)
 *   - `Farm.cultivationMethod` at certificate issuance (certificate-service.js:449),
 *     overwriting whatever the farm actually said
 *   - the fee fallback when plots carry no method (billing/internal/fee-service.js:75)
 *
 * So an indoor grower's legal paperwork said outdoor, their certified farm
 * record was rewritten to outdoor, and DTAM's cultivation statistics read 100%
 * outdoor for the whole country.
 *
 * The wizard does collect this — as `cultivationMethods`, and again per plot as
 * `solarSystem`. It was simply never carried across. This derives it, and where
 * the answer is genuinely ambiguous it errs towards the more controlled
 * environment, which is the one with the higher fee and the stricter
 * obligations: erring there does not under-charge or under-regulate anyone.
 */

import { deriveLocationType } from '../derive-location-type';

describe('deriveLocationType', () => {
    describe('from the plots, which are the most specific thing the wizard has', () => {
        it('uses the method when every plot agrees', () => {
            expect(deriveLocationType({
                plots: [{ solarSystem: 'GREENHOUSE' }, { solarSystem: 'GREENHOUSE' }],
                cultivationMethods: ['greenhouse'],
            })).toBe('GREENHOUSE');
        });

        it('prefers the plots over the method list when they disagree', () => {
            // The plot rows are what an auditor will walk. The method list is
            // an earlier, coarser answer.
            expect(deriveLocationType({
                plots: [{ solarSystem: 'INDOOR' }, { solarSystem: 'INDOOR' }],
                cultivationMethods: ['outdoor'],
            })).toBe('INDOOR');
        });

        it('ignores a plot that has no method yet', () => {
            expect(deriveLocationType({
                plots: [{ solarSystem: 'GREENHOUSE' }, { solarSystem: null }],
                cultivationMethods: [],
            })).toBe('GREENHOUSE');
        });
    });

    describe('when the farm uses more than one', () => {
        it('reports the most controlled environment present', () => {
            expect(deriveLocationType({
                plots: [{ solarSystem: 'OUTDOOR' }, { solarSystem: 'INDOOR' }],
                cultivationMethods: [],
            })).toBe('INDOOR');

            expect(deriveLocationType({
                plots: [{ solarSystem: 'OUTDOOR' }, { solarSystem: 'GREENHOUSE' }],
                cultivationMethods: [],
            })).toBe('GREENHOUSE');
        });

        it('does the same with the method list', () => {
            expect(deriveLocationType({ plots: [], cultivationMethods: ['outdoor', 'indoor'] }))
                .toBe('INDOOR');
        });
    });

    describe('from the method list when there are no plots yet', () => {
        it('reads the wizard\'s lowercase tokens', () => {
            expect(deriveLocationType({ plots: [], cultivationMethods: ['outdoor'] })).toBe('OUTDOOR');
            expect(deriveLocationType({ plots: [], cultivationMethods: ['greenhouse'] })).toBe('GREENHOUSE');
            expect(deriveLocationType({ plots: [], cultivationMethods: ['indoor'] })).toBe('INDOOR');
        });

        it('reads the uppercase ones the API uses', () => {
            expect(deriveLocationType({ plots: [], cultivationMethods: ['INDOOR_CONTROLLED'] })).toBe('INDOOR');
            expect(deriveLocationType({ plots: [], cultivationMethods: ['GREENHOUSE'] })).toBe('GREENHOUSE');
        });

        it('ignores a method it cannot map rather than counting it as outdoor', () => {
            expect(deriveLocationType({ plots: [], cultivationMethods: ['hydroponic'] })).toBeNull();
            expect(deriveLocationType({ plots: [], cultivationMethods: ['hydroponic', 'indoor'] })).toBe('INDOOR');
        });
    });

    describe('an explicit answer wins', () => {
        it('uses locationType when the application already carries one', () => {
            // Edit mode hydrates this from a saved application. Re-deriving
            // would silently rewrite what an applicant already stated.
            expect(deriveLocationType({
                locationType: 'GREENHOUSE',
                plots: [{ solarSystem: 'OUTDOOR' }],
                cultivationMethods: ['outdoor'],
            })).toBe('GREENHOUSE');
        });

        it('ignores an explicit value that is not a method', () => {
            expect(deriveLocationType({
                locationType: 'SOMETHING',
                plots: [{ solarSystem: 'INDOOR' }],
                cultivationMethods: [],
            })).toBe('INDOOR');
        });
    });

    describe('when there is genuinely nothing to go on', () => {
        it('is null, not OUTDOOR', () => {
            // This is the whole bug. A missing answer looked exactly like an
            // outdoor farm to every consumer downstream.
            expect(deriveLocationType({ plots: [], cultivationMethods: [] })).toBeNull();
            expect(deriveLocationType({})).toBeNull();
            expect(deriveLocationType(null)).toBeNull();
            expect(deriveLocationType(undefined)).toBeNull();
        });
    });
});
