/**
 * [Sprint6] Mod-11 Checksum in Auth Zod Schemas (H9)
 *
 * Sprint 6 healthId-audit Phase C-H9: the Mod-11 validator existed in
 * `utils/thai-id-validator.js` but was never called from the login or register Zod
 * schemas. After Sprint 6, `thaiIdField` and `healthLoginSchema` both `.refine()`
 * with `validateThaiId`, so structurally-valid-but-algorithmically-invalid IDs
 * (e.g., `1234567890123`) are rejected at the schema layer.
 */

const { healthLoginSchema, healthRegisterSchema } = require('../../shared/schemas/auth-schemas');
const { validateThaiId } = require('../../utils/thai-id-validator');

// A real valid Thai national ID — first 12 digits chosen, 13th digit set to the
// correct Mod-11 checksum so the algorithm passes.
function makeValidThaiId() {
    const first12 = '110010010001';
    // sum = Σ digit[i] * (13-i) for i=0..11
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
        sum += Number(first12[i]) * (13 - i);
    }
    const check = (11 - (sum % 11)) % 10;
    return `${first12}${check}`;
}

const VALID_ID = makeValidThaiId(); // dynamically computed so checksum is always correct

describe('[Sprint6] Mod-11 Checksum in Auth Zod Schemas', () => {
    it('healthLoginSchema accepts a checksum-valid Thai ID as identifier', () => {
        // Sanity — confirm the helper produces what the validator considers valid.
        // Note: backend `validateThaiId` returns `{ valid, errors }`, not a boolean.
        expect(validateThaiId(VALID_ID).valid).toBe(true);

        const parsed = healthLoginSchema.safeParse({
            identifier: VALID_ID,
            password: 'p@ssw0rd123',
        });
        expect(parsed.success).toBe(true);
    });

    it('healthLoginSchema REJECTS a 13-digit identifier with invalid Mod-11 checksum', () => {
        // 1234567890123 — every digit is sequential; algorithm rejects.
        expect(validateThaiId('1234567890123').valid).toBe(false);

        const parsed = healthLoginSchema.safeParse({
            identifier: '1234567890123',
            password: 'p@ssw0rd123', // login password = presence-only, any non-empty string is fine
        });
        expect(parsed.success).toBe(false);
        const issues = parsed.error?.issues || [];
        expect(issues.some((i) => /เลขบัตรประชาชน/.test(i.message))).toBe(true);
    });

    it('healthLoginSchema REJECTS an email identifier (national-ID-only, owner directive 2026-06-11)', () => {
        const parsed = healthLoginSchema.safeParse({
            identifier: 'farmer@example.test',
            password: 'p@ssw0rd123',
        });
        expect(parsed.success).toBe(false);
        const issues = parsed.error?.issues || [];
        expect(issues.some((i) => /ไม่รองรับอีเมล|เลขบัตรประชาชน/.test(i.message))).toBe(true);
    });

    it('healthRegisterSchema rejects Mod-11-invalid healthId', () => {
        const parsed = healthRegisterSchema.safeParse({
            healthId: '1234567890123',
            password: 'p@ssw0rd123',
            phoneNumber: '0812345678',
            firstName: 'A',
            lastName: 'B',
        });
        expect(parsed.success).toBe(false);
        const issues = parsed.error?.issues || [];
        expect(issues.some((i) => /checksum/i.test(i.message) || /ไม่ถูกต้องตามมาตรฐาน/.test(i.message))).toBe(true);
    });

    it('healthRegisterSchema accepts a checksum-valid healthId with all required fields', () => {
        const parsed = healthRegisterSchema.safeParse({
            healthId: VALID_ID,
            password: 'Str0ng#Pass99', // strong-password policy (audit 2026-06-11)
            phoneNumber: '0812345678',
            firstName: 'A',
            lastName: 'B',
            acceptedTermsOfService: true,
            acceptedPrivacyPolicy: true,
        });
        expect(parsed.success).toBe(true);
    });

    it('thaiIdField strips dashes before checksum evaluation', () => {
        // Dash-formatted version of VALID_ID — schema must strip dashes first.
        const dashFormatted = `${VALID_ID[0]}-${VALID_ID.slice(1, 5)}-${VALID_ID.slice(5, 10)}-${VALID_ID.slice(10, 12)}-${VALID_ID[12]}`;

        const parsed = healthRegisterSchema.safeParse({
            healthId: dashFormatted,
            password: 'Str0ng#Pass99',
            phoneNumber: '0812345678',
            firstName: 'A',
            lastName: 'B',
            acceptedTermsOfService: true,
            acceptedPrivacyPolicy: true,
        });
        expect(parsed.success).toBe(true);
        // After transform, healthId should be the dash-stripped form.
        expect(parsed.data.healthId).toBe(VALID_ID);
    });

    it('healthLoginSchema REJECTS non-13-digit numeric input (national-ID-only)', () => {
        const parsed = healthLoginSchema.safeParse({
            identifier: '12345', // too short to be a national ID
            password: 'p@ssw0rd123',
        });
        // Owner directive 2026-06-11: the login identifier must be a valid
        // 13-digit Thai national ID. A 5-digit string is now rejected at the
        // schema layer (previously it passed through to the service).
        expect(parsed.success).toBe(false);
        const issues = parsed.error?.issues || [];
        expect(issues.some((i) => /เลขบัตรประชาชน/.test(i.message))).toBe(true);
    });

    it('healthLoginSchema ACCEPTS a weak login password (login validates presence, not strength)', () => {
        // Strengthening passwordField must never lock out a legacy user whose
        // password predates the policy — login uses loginPasswordField (min 1).
        const parsed = healthLoginSchema.safeParse({
            identifier: VALID_ID,
            password: 'old',
        });
        expect(parsed.success).toBe(true);
    });
});
