const { resolveApplicantInfo } = require('../../utils/applicant-resolver');

describe('resolveApplicantInfo', () => {
    describe('legacy path (no entity included)', () => {
        it('resolves an INDIVIDUAL from formData + applicant', () => {
            // `applicant` here stands in for the Prisma User relation, whose
            // column is `phoneNumber` (auth.prisma:21) — NOT `phone`. This
            // fixture used to write `phone`, which a mocked `applicant.phone`
            // read never validates against the real schema: the "select
            // gap" class (2026-09-27) went unnoticed here for the same
            // reason it went unnoticed at the two Prisma call sites.
            const record = {
                applicant: { firstName: 'Somchai', lastName: 'Test', nationalId: '1100000000008', phoneNumber: '0812345678' },
                formData: { applicantType: 'INDIVIDUAL' },
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('Somchai Test');
            // Operator rule 2026-09-27: a person's national ID is never returned
            // (this line used to pin `'1100000000008'` — the L-084 leak).
            expect(out.id).toBe('-');
            expect(JSON.stringify(out)).not.toContain('1100000000008');
            expect(out.phone).toBe('0812345678');
        });

        // Fix round 1 (payer-block-by-type): `id` is the PRINTED id, so a juristic
        // fixture must carry a checksum-valid company tax id — the old
        // '0105561234567' fails mod-11 and now resolves to '-' (pinned in
        // payer-block-by-type.test.js).
        it('resolves a JURISTIC from formData.applicantInfo', () => {
            const record = {
                applicant: {},
                formData: {
                    applicantType: 'JURISTIC',
                    applicantInfo: { companyName: 'ABC Co. Ltd.', taxId: '0105561234560' },
                },
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('ABC Co. Ltd.');
            expect(out.id).toBe('0105561234560');
        });

        it('resolves a COMMUNITY from formData.applicantInfo', () => {
            const record = {
                applicant: {},
                formData: {
                    applicantType: 'COMMUNITY',
                    applicantInfo: { groupName: 'วิสาหกิจชุมชนสมุนไพรบ้านสวน', registrationNumber: '12345678901' },
                },
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('วิสาหกิจชุมชนสมุนไพรบ้านสวน');
            expect(out.id).toBe('12345678901');
        });

        it('returns "-" placeholders when no applicant data is present', () => {
            const out = resolveApplicantInfo({ applicant: {}, formData: {} });
            expect(out.name).toBe('-');
            expect(out.id).toBe('-');
            expect(out.phone).toBe('-');
            expect(out.email).toBe('-');
            expect(out.address).toBe('-');
        });

        it('reads from record.application.applicant when called with an Invoice', () => {
            const record = {
                application: {
                    applicant: { firstName: 'A', lastName: 'B', nationalId: '1100000000009' },
                    formData: { applicantType: 'INDIVIDUAL' },
                },
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('A B');
            // Never the national ID (operator rule 2026-09-27).
            expect(out.id).toBe('-');
            expect(JSON.stringify(out)).not.toContain('1100000000009');
        });
    });

    describe('entity-preferred path (Phase 4d)', () => {
        it('uses Entity.displayName for an INDIVIDUAL entity — and never its thaiCitizenId', () => {
            const record = {
                applicant: { firstName: 'Stale', lastName: 'Cache' }, // legacy data, should be ignored
                entity: {
                    type: 'INDIVIDUAL',
                    displayName: 'สมชาย ทดสอบ',
                    thaiCitizenId: '1100000000008',
                },
                formData: {},
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('สมชาย ทดสอบ');
            // Operator rule 2026-09-27: never the national ID, even when a caller
            // selected it (this line used to pin `'1100000000008'`).
            expect(out.id).toBe('-');
            expect(JSON.stringify(out)).not.toContain('1100000000008');
        });

        it('uses Entity.displayName + juristicId for a JURISTIC entity', () => {
            const record = {
                entity: {
                    type: 'JURISTIC',
                    displayName: 'ABC Co. Ltd.',
                    juristicId: '0105561234560',
                },
                formData: {},
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('ABC Co. Ltd.');
            expect(out.id).toBe('0105561234560');
        });

        it('uses Entity.displayName + communityRegNo for a COMMUNITY_ENTERPRISE entity', () => {
            const record = {
                entity: {
                    type: 'COMMUNITY_ENTERPRISE',
                    displayName: 'วิสาหกิจชุมชนสมุนไพรบ้านสวน',
                    communityRegNo: '12345678901',
                },
                formData: {},
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('วิสาหกิจชุมชนสมุนไพรบ้านสวน');
            expect(out.id).toBe('12345678901');
        });

        it('reads entity from record.application.entity when called with an Invoice', () => {
            const record = {
                application: {
                    entity: {
                        type: 'JURISTIC',
                        displayName: 'XYZ Ltd.',
                        juristicId: '0107554321098',
                    },
                    formData: {},
                },
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('XYZ Ltd.');
            expect(out.id).toBe('0107554321098');
        });

        it('falls back to legacy resolution when entity has unknown type', () => {
            const record = {
                applicant: { firstName: 'A', lastName: 'B' },
                entity: { type: 'WHATEVER', displayName: 'should-be-ignored' },
                formData: { applicantType: 'INDIVIDUAL' },
            };
            const out = resolveApplicantInfo(record);
            expect(out.name).toBe('A B');
        });

        it('falls back to legacy resolution when the missing identifier on the entity is null', () => {
            const record = {
                applicant: {},
                entity: { type: 'INDIVIDUAL', displayName: 'No ID Entity', thaiCitizenId: null },
                formData: {},
            };
            const out = resolveApplicantInfo(record);
            // Name still comes from entity, but id is "-"
            expect(out.name).toBe('No ID Entity');
            expect(out.id).toBe('-');
        });
    });
});
