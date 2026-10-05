const {
    isThaiIdMod11Valid,
    validateIndividual,
    validateJuristic,
    validateCommunityEnterprise,
} = require('../../services/applicant-validation');

describe('applicant-validation', () => {
    describe('isThaiIdMod11Valid', () => {
        // These are real-pattern Thai IDs constructed to satisfy mod-11.
        // (Not real people — just valid checksums.)
        it('accepts a valid 13-digit personal ID', () => {
            expect(isThaiIdMod11Valid('1100000000008')).toBe(true);
        });
        it('accepts a valid 13-digit juristic ID (starts 0)', () => {
            expect(isThaiIdMod11Valid('0105561234560')).toBe(true);
        });
        it('rejects wrong-length input', () => {
            expect(isThaiIdMod11Valid('110000000000')).toBe(false); // 12
            expect(isThaiIdMod11Valid('11000000000088')).toBe(false); // 14
        });
        it('rejects non-digits', () => {
            expect(isThaiIdMod11Valid('1100000000A08')).toBe(false);
        });
        it('rejects bad checksum', () => {
            expect(isThaiIdMod11Valid('1100000000000')).toBe(false);
        });
    });

    describe('validateIndividual', () => {
        it('accepts a complete record', () => {
            const out = validateIndividual({ idCard: '1100000000008', firstName: 'A', lastName: 'B' });
            expect(out.valid).toBe(true);
            expect(out.errors).toEqual([]);
        });
        it('rejects missing idCard', () => {
            const out = validateIndividual({ firstName: 'A', lastName: 'B' });
            expect(out.valid).toBe(false);
            expect(out.errors).toContainEqual({ field: 'idCard', message: 'idCard is required' });
        });
        it('rejects bad checksum', () => {
            const out = validateIndividual({ idCard: '1100000000000', firstName: 'A', lastName: 'B' });
            expect(out.valid).toBe(false);
            expect(out.errors[0].message).toMatch(/mod-11/);
        });
        it('rejects ID starting with 0 (that would be a JURISTIC)', () => {
            const out = validateIndividual({ idCard: '0105561234560', firstName: 'A', lastName: 'B' });
            expect(out.valid).toBe(false);
            expect(out.errors).toContainEqual(
                expect.objectContaining({ field: 'idCard', message: expect.stringMatching(/JURISTIC/) }),
            );
        });
        it('rejects missing names', () => {
            const out = validateIndividual({ idCard: '1100000000008' });
            expect(out.valid).toBe(false);
            expect(out.errors.map(e => e.field).sort()).toEqual(['firstName', 'lastName']);
        });
    });

    describe('validateJuristic', () => {
        it('accepts a complete record', () => {
            const out = validateJuristic({ taxId: '0105561234560', companyName: 'ABC Co.' });
            expect(out.valid).toBe(true);
        });
        it('rejects taxId not starting with 0', () => {
            const out = validateJuristic({ taxId: '1100000000008', companyName: 'X' });
            expect(out.valid).toBe(false);
            expect(out.errors).toContainEqual(
                expect.objectContaining({ field: 'taxId', message: expect.stringMatching(/start with 0/) }),
            );
        });
        it('rejects missing companyName', () => {
            const out = validateJuristic({ taxId: '0105561234560' });
            expect(out.valid).toBe(false);
            expect(out.errors).toContainEqual(
                expect.objectContaining({ field: 'companyName' }),
            );
        });
    });

    describe('validateCommunityEnterprise', () => {
        it('accepts an 11-digit DOAE registration number', () => {
            const out = validateCommunityEnterprise({
                communityRegNumber: '12345678901',
                communityName: 'วิสาหกิจชุมชนสมุนไพร',
            });
            expect(out.valid).toBe(true);
        });
        it('rejects wrong-length numbers', () => {
            const out = validateCommunityEnterprise({
                communityRegNumber: '1234567890',
                communityName: 'X',
            });
            expect(out.valid).toBe(false);
            expect(out.errors).toContainEqual(
                expect.objectContaining({ field: 'communityRegNumber', message: expect.stringMatching(/11 digits/) }),
            );
        });
        it('rejects missing community name', () => {
            const out = validateCommunityEnterprise({ communityRegNumber: '12345678901' });
            expect(out.valid).toBe(false);
            expect(out.errors).toContainEqual(
                expect.objectContaining({ field: 'communityName' }),
            );
        });
    });
});
