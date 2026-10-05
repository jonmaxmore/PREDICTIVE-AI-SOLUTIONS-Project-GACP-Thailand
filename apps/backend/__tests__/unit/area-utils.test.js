/**
 * Area is square metres. That is the whole contract.
 *
 * It used to be four units — rai, ngan, square wa, square metres — chosen from
 * a dropdown, stored alongside the number, and converted at each of a dozen
 * read sites. Every one of those sites had to remember to convert, and the two
 * modules that did the converting disagreed about what an *absent* unit meant:
 * `area-utils` read it as square metres, `config/plant-density` read it as rai.
 * The same row, read by two different code paths, was 1,600 square metres or
 * one, and the number that came out set a farm's legal plant cap.
 *
 * So: one unit, no dropdown, no defaulting.
 *
 * The one thing that cannot simply be deleted is the ability to read a row
 * written before the switch. `areaUnit: 'rai', area: 5` means eight thousand
 * square metres and will still mean that after the code forgets what rai was.
 * `storedAreaToSqm` is that reader, and it refuses to guess: an unrecognised or
 * missing unit throws rather than silently returning a farm 1,600 times too
 * small. Once scripts/maintenance/migrate-area-to-sqm.js has run everywhere,
 * the legacy table can go.
 */

const {
    AREA_UNIT,
    AREA_UNIT_LABEL_TH,
    LEGACY_UNIT_TO_SQM,
    storedAreaToSqm,
    isLegacyAreaUnit,
} = require('../../shared/area-utils');

describe('the platform has one area unit', () => {
    it('is square metres', () => {
        expect(AREA_UNIT).toBe('sqm');
    });

    it('is labelled ตร.ม. wherever it is shown', () => {
        expect(AREA_UNIT_LABEL_TH).toBe('ตร.ม.');
    });
});

describe('storedAreaToSqm', () => {
    describe('the current unit', () => {
        it('passes square metres through untouched', () => {
            expect(storedAreaToSqm(1600, 'sqm')).toBe(1600);
            expect(storedAreaToSqm(0.5, 'sqm')).toBe(0.5);
        });

        it('accepts the unit however it was cased or padded on the way in', () => {
            expect(storedAreaToSqm(50, 'Sqm')).toBe(50);
            expect(storedAreaToSqm(50, ' SQM ')).toBe(50);
        });
    });

    describe('rows written before the switch', () => {
        it('still reads rai as 1,600 square metres', () => {
            // A farm registered as 5 rai is 8,000 m². If this ever returns 5,
            // that farm's plant cap drops by a factor of 1,600 and the
            // certificate prints the wrong area.
            expect(storedAreaToSqm(5, 'rai')).toBe(8000);
        });

        it('still reads ngan and square wa', () => {
            expect(storedAreaToSqm(2, 'ngan')).toBe(800);
            expect(storedAreaToSqm(10, 'sqwa')).toBe(40);
        });

        it('recognises the Thai and alternate spellings that reached the database', () => {
            expect(storedAreaToSqm(10, 'ตารางวา')).toBe(40);
            expect(storedAreaToSqm(10, 'squarewa')).toBe(40);
            expect(storedAreaToSqm(10, 'sqw')).toBe(40);
            expect(storedAreaToSqm(10, 'square_wa')).toBe(40);
            expect(storedAreaToSqm(10, 'wa2')).toBe(40);
        });

        it('reads the wizard\'s capitalised spellings', () => {
            // The web wizard wrote 'Rai' / 'Ngan' / 'Sqm', the API wrote
            // lowercase. Both are in the table.
            expect(storedAreaToSqm(1, 'Rai')).toBe(1600);
            expect(storedAreaToSqm(1, 'Ngan')).toBe(400);
        });
    });

    describe('it refuses to guess', () => {
        it('throws on a missing unit rather than assuming square metres', () => {
            // This is the defect that motivated the whole change. Absent meant
            // sqm in one module and rai in another, and nothing said so.
            expect(() => storedAreaToSqm(5, null)).toThrow(/unit/i);
            expect(() => storedAreaToSqm(5, undefined)).toThrow(/unit/i);
            expect(() => storedAreaToSqm(5, '')).toThrow(/unit/i);
        });

        it('throws on a unit it does not recognise, naming it', () => {
            expect(() => storedAreaToSqm(5, 'hectare')).toThrow(/hectare/);
            expect(() => storedAreaToSqm(5, 'acre')).toThrow(/acre/);
        });

        it('says what to do about it', () => {
            expect(() => storedAreaToSqm(5, 'hectare')).toThrow(/migrate-area-to-sqm/);
        });
    });

    describe('numbers that are not areas', () => {
        it('treats absent as zero', () => {
            expect(storedAreaToSqm(null, 'sqm')).toBe(0);
            expect(storedAreaToSqm(undefined, 'sqm')).toBe(0);
        });

        it('refuses a negative area', () => {
            // Land cannot be negative, and a negative here would enlarge a
            // remaining-capacity calculation somewhere downstream.
            expect(storedAreaToSqm(-5, 'rai')).toBe(0);
        });

        it('refuses NaN and infinity rather than propagating them', () => {
            expect(storedAreaToSqm(NaN, 'rai')).toBe(0);
            expect(storedAreaToSqm(Infinity, 'rai')).toBe(0);
            expect(storedAreaToSqm('not a number', 'rai')).toBe(0);
        });

        it('reads a numeric string, because Prisma Decimal arrives as one', () => {
            expect(storedAreaToSqm('2.5', 'rai')).toBe(4000);
        });
    });

    describe('arithmetic that has to be exact', () => {
        it.each([
            [1, 'rai', 1600],
            [2, 'rai', 3200],
            [10, 'rai', 16000],
            [100, 'rai', 160000],
            [0.25, 'rai', 400],
            [0.0625, 'rai', 100],
            [1, 'ngan', 400],
            [4, 'ngan', 1600],
            [400, 'sqwa', 1600],
            [1, 'sqwa', 4],
        ])('%s %s is %s m²', (value, unit, expected) => {
            expect(storedAreaToSqm(value, unit)).toBe(expected);
        });

        it('keeps a rai-to-sqm-to-rai round trip exact for whole rai', () => {
            for (let rai = 1; rai <= 200; rai += 1) {
                expect(storedAreaToSqm(rai, 'rai') / 1600).toBe(rai);
            }
        });

        it('holds the relationships between the legacy units', () => {
            expect(LEGACY_UNIT_TO_SQM.rai).toBe(LEGACY_UNIT_TO_SQM.ngan * 4);
            expect(LEGACY_UNIT_TO_SQM.ngan).toBe(LEGACY_UNIT_TO_SQM.sqwa * 100);
            expect(LEGACY_UNIT_TO_SQM.sqm).toBe(1);
        });
    });

    it('cannot be reopened from a caller', () => {
        expect(() => {
            LEGACY_UNIT_TO_SQM.rai = 1;
        }).toThrow();
    });
});

describe('isLegacyAreaUnit', () => {
    it('is how the migration finds rows still to convert', () => {
        expect(isLegacyAreaUnit('rai')).toBe(true);
        expect(isLegacyAreaUnit('Ngan')).toBe(true);
        expect(isLegacyAreaUnit('ตารางวา')).toBe(true);
    });

    it('is false for the unit everything is being moved to', () => {
        expect(isLegacyAreaUnit('sqm')).toBe(false);
        expect(isLegacyAreaUnit('Sqm')).toBe(false);
    });

    it('is false for something unrecognised — that is a different problem', () => {
        expect(isLegacyAreaUnit('hectare')).toBe(false);
        expect(isLegacyAreaUnit(null)).toBe(false);
    });
});
