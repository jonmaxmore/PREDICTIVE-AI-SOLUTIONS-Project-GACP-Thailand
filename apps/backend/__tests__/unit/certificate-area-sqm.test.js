/**
 * What a certificate says the farm's area is.
 *
 * The wizard collects square metres. `certificate-service` wrote the number
 * straight into `Farm.totalArea` and never wrote `Farm.areaUnit`, so Prisma's
 * column default — `@default("rai")` — decided the unit. A farmer who entered
 * 1,600 ตร.ม. got a certified farm record of 1,600 rai: two and a half square
 * kilometres, on a legal document, and as the basis for every plant-cap and
 * capacity calculation that reads that farm afterwards.
 *
 * The two other places the same file guessed at a unit: plot rows extracted
 * from the application defaulted to `'rai'`, and the fallback plot built from
 * `farm.cultivationArea` hard-coded `'rai'` regardless of what the farm row
 * actually said.
 *
 * Everything is converted once, here, on the way in. What gets stored is square
 * metres, and the stored unit says so.
 */

const { submittedAreaSqm } = require('../../services/certificate/submitted-area');

describe('submittedAreaSqm', () => {
    it('passes the wizard\'s square metres through unchanged', () => {
        expect(submittedAreaSqm(1600, 'Sqm', 'totalArea')).toBe(1600);
        expect(submittedAreaSqm(1600, 'sqm', 'totalArea')).toBe(1600);
    });

    it('converts an application submitted before the switch', () => {
        // Applications already in the queue carry 'Rai'. Reading one as square
        // metres would shrink the farm by a factor of 1,600 on its certificate.
        expect(submittedAreaSqm(5, 'Rai', 'totalArea')).toBe(8000);
        expect(submittedAreaSqm(2, 'Ngan', 'totalArea')).toBe(800);
    });

    it('is zero for an area that was never filled in', () => {
        expect(submittedAreaSqm(0, 'Sqm', 'totalArea')).toBe(0);
        expect(submittedAreaSqm(null, 'Sqm', 'totalArea')).toBe(0);
        expect(submittedAreaSqm(undefined, 'Sqm', 'totalArea')).toBe(0);
        expect(submittedAreaSqm('', 'Sqm', 'totalArea')).toBe(0);
    });

    it('is zero for a negative or unreadable area', () => {
        expect(submittedAreaSqm(-5, 'Rai', 'totalArea')).toBe(0);
        expect(submittedAreaSqm('abc', 'Rai', 'totalArea')).toBe(0);
    });

    it('reads a numeric string, because form data arrives as one', () => {
        expect(submittedAreaSqm('1600', 'Sqm', 'totalArea')).toBe(1600);
        expect(submittedAreaSqm('2.5', 'Rai', 'totalArea')).toBe(4000);
    });

    describe('when the unit is missing or unknown', () => {
        it('refuses, rather than printing a guess on a certificate', () => {
            expect(() => submittedAreaSqm(1600, null, 'totalArea')).toThrow();
            expect(() => submittedAreaSqm(1600, 'hectare', 'totalArea')).toThrow();
        });

        it('names the field, so the application can be corrected', () => {
            expect(() => submittedAreaSqm(1600, null, 'plots[2].areaSize'))
                .toThrow(/plots\[2\]\.areaSize/);
        });

        it('does not refuse when there is no area to convert', () => {
            // A blank optional area with no unit is not ambiguous — zero is
            // zero in every unit. Throwing here would block issuance over a
            // field nobody filled in.
            expect(submittedAreaSqm(0, null, 'cultivationArea')).toBe(0);
            expect(submittedAreaSqm(null, undefined, 'cultivationArea')).toBe(0);
        });
    });
});
