/**
 * Zod schema contracts — shared/zod-schemas.js.
 *
 * Input-validation schemas applied by every route that accepts user input.
 * The Thai ID checksum, password complexity rules, and phone format
 * directly gate registration + login. A regression that loosens any
 * regex / refine() lets malformed data into the database.
 */

const {
    thaiIdSchema,
    taxIdSchema,
    passwordSchema,
    loginPasswordSchema,
    emailSchema,
    phoneSchema,
    entityTypeEnum,
    healthLoginSchema,
    ApplicantLoginSchema,
    healthRegistrationSchema,
} = require('../../shared/zod-schemas');

/**
 * Compute the Thai-ID checksum digit (matches the schema's refine logic).
 * Lets the test build a valid 13-digit ID from any 12-digit prefix.
 */
function computeThaiIdCheckDigit(first12) {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
        sum += parseInt(first12[i], 10) * (13 - i);
    }
    const remainder = sum % 11;
    return remainder < 2 ? remainder : 11 - remainder;
}

function buildValidThaiId(first12 = '110170020030') {
    return first12 + computeThaiIdCheckDigit(first12);
}

describe('zod-schemas', () => {
    describe('thaiIdSchema — checksum + format', () => {
        it('accepts a valid 13-digit Thai ID', () => {
            const id = buildValidThaiId();
            expect(thaiIdSchema.safeParse(id).success).toBe(true);
        });

        it('rejects when length != 13', () => {
            expect(thaiIdSchema.safeParse('123').success).toBe(false);
            expect(thaiIdSchema.safeParse('12345678901234').success).toBe(false);
        });

        it('rejects non-digit characters', () => {
            expect(thaiIdSchema.safeParse('abcdefghijklm').success).toBe(false);
            expect(thaiIdSchema.safeParse('1234567890-12').success).toBe(false);
        });

        it('rejects when last digit doesn\'t match the computed checksum', () => {
            const valid = buildValidThaiId();
            // Flip the last digit — checksum will mismatch.
            const lastDigit = parseInt(valid[12], 10);
            const flipped = valid.slice(0, 12) + ((lastDigit + 1) % 10);
            expect(thaiIdSchema.safeParse(flipped).success).toBe(false);
        });
    });

    describe('taxIdSchema — 13 digits, no checksum', () => {
        it('accepts any 13-digit string', () => {
            expect(taxIdSchema.safeParse('1234567890123').success).toBe(true);
        });

        it('rejects wrong length / non-digit', () => {
            expect(taxIdSchema.safeParse('123').success).toBe(false);
            expect(taxIdSchema.safeParse('12345678901a3').success).toBe(false);
        });
    });

    describe('passwordSchema — full complexity', () => {
        it('accepts strings with upper + lower + digit, length >= 8', () => {
            expect(passwordSchema.safeParse('Abcdef12').success).toBe(true);
            expect(passwordSchema.safeParse('LongPassword99').success).toBe(true);
        });

        it('rejects too-short input', () => {
            expect(passwordSchema.safeParse('Ab1').success).toBe(false);
        });

        it('rejects when missing uppercase', () => {
            expect(passwordSchema.safeParse('abcdef12').success).toBe(false);
        });

        it('rejects when missing lowercase', () => {
            expect(passwordSchema.safeParse('ABCDEF12').success).toBe(false);
        });

        it('rejects when missing digit', () => {
            expect(passwordSchema.safeParse('Abcdefgh').success).toBe(false);
        });

        it('rejects > 100 chars', () => {
            expect(passwordSchema.safeParse('Aa1' + 'x'.repeat(98)).success).toBe(false);
        });
    });

    describe('loginPasswordSchema — login flow (length only)', () => {
        it('accepts any 8-100 char string (no complexity)', () => {
            // The login form does not re-enforce complexity — that's a
            // registration concern. Login just confirms format.
            expect(loginPasswordSchema.safeParse('abcdefgh').success).toBe(true);
            expect(loginPasswordSchema.safeParse('all-lowercase-pass').success).toBe(true);
        });

        it('rejects too-short / too-long', () => {
            expect(loginPasswordSchema.safeParse('abc').success).toBe(false);
            expect(loginPasswordSchema.safeParse('x'.repeat(101)).success).toBe(false);
        });
    });

    describe('emailSchema', () => {
        it('accepts standard email formats', () => {
            expect(emailSchema.safeParse('a@b.com').success).toBe(true);
            expect(emailSchema.safeParse('user.name+tag@example.co.th').success).toBe(true);
        });

        it('rejects malformed', () => {
            expect(emailSchema.safeParse('not-an-email').success).toBe(false);
            expect(emailSchema.safeParse('@no-local.com').success).toBe(false);
            expect(emailSchema.safeParse('no-at-sign.com').success).toBe(false);
        });
    });

    describe('phoneSchema — Thai mobile format', () => {
        it('accepts 10-digit numbers starting with 0', () => {
            expect(phoneSchema.safeParse('0812345678').success).toBe(true);
            expect(phoneSchema.safeParse('0900000000').success).toBe(true);
        });

        it('rejects non-Thai formats', () => {
            expect(phoneSchema.safeParse('+66812345678').success).toBe(false); // +66 prefix
            expect(phoneSchema.safeParse('1234567890').success).toBe(false);   // doesn't start with 0
            expect(phoneSchema.safeParse('081-234-5678').success).toBe(false); // dashes
            expect(phoneSchema.safeParse('081234567').success).toBe(false);    // 9 digits
        });
    });

    describe('entityTypeEnum', () => {
        it('accepts the 3 documented entity types', () => {
            for (const type of ['INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE']) {
                expect(entityTypeEnum.safeParse(type).success).toBe(true);
            }
        });

        it('rejects unknown values + lowercase', () => {
            expect(entityTypeEnum.safeParse('individual').success).toBe(false);
            expect(entityTypeEnum.safeParse('PERSON').success).toBe(false);
        });
    });

    describe('healthLoginSchema', () => {
        it('accepts valid input + strips dashes/spaces from identifier', () => {
            const result = healthLoginSchema.safeParse({
                entityType: 'INDIVIDUAL',
                identifier: '1-1017-0023-45-1',
                password: 'Abcdef12',
            });
            expect(result.success).toBe(true);
            expect(result.data.identifier).toBe('1101700234 51'.replace(/[-\s]/g, ''));
        });

        it('defaults entityType to INDIVIDUAL when omitted', () => {
            const result = healthLoginSchema.safeParse({
                identifier: '1234567890123',
                password: 'Abcdef12',
            });
            expect(result.success).toBe(true);
            expect(result.data.entityType).toBe('INDIVIDUAL');
        });

        it('rejects identifier shorter than 8 chars', () => {
            const result = healthLoginSchema.safeParse({
                identifier: '1234',
                password: 'Abcdef12',
            });
            expect(result.success).toBe(false);
        });

        it('rejects extra fields (strict mode)', () => {
            const result = healthLoginSchema.safeParse({
                identifier: '12345678901',
                password: 'Abcdef12',
                extraField: 'should-fail',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('ApplicantLoginSchema (backward-compat alias)', () => {
        it('is the same schema instance as healthLoginSchema', () => {
            // Pin the alias so a future "cleanup" that breaks the alias
            // (e.g., re-defines ApplicantLoginSchema separately) fails.
            expect(ApplicantLoginSchema).toBe(healthLoginSchema);
        });
    });

    describe('healthRegistrationSchema — password match refine', () => {
        const baseValid = {
            entityType: 'INDIVIDUAL',
            phoneNumber: '0812345678',
            password: 'Abcdef12',
            confirmPassword: 'Abcdef12',
            termsAccepted: true,
            privacyAccepted: true,
        };

        it('accepts a complete valid registration', () => {
            expect(healthRegistrationSchema.safeParse(baseValid).success).toBe(true);
        });

        it('rejects mismatched passwords', () => {
            const result = healthRegistrationSchema.safeParse({
                ...baseValid,
                confirmPassword: 'DifferentPass1',
            });
            expect(result.success).toBe(false);
            // The refine error attaches to confirmPassword path
            const issue = result.error.issues.find((i) => i.path.includes('confirmPassword'));
            expect(issue).toBeTruthy();
        });

        it('rejects when termsAccepted is false (must opt-in)', () => {
            expect(healthRegistrationSchema.safeParse({
                ...baseValid,
                termsAccepted: false,
            }).success).toBe(false);
        });

        it('rejects when privacyAccepted is false (must opt-in)', () => {
            expect(healthRegistrationSchema.safeParse({
                ...baseValid,
                privacyAccepted: false,
            }).success).toBe(false);
        });
    });

    // passwordResetSchema / passwordResetRequestSchema were removed 2026-09-16
    // (operator: no forgot-password by email or SMS). They had no production
    // caller; no-self-service-password-reset.test.js pins their absence.
});
