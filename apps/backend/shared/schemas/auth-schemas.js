/**
 * Auth Request Schemas (Zod)
 * ──────────────────────────
 * Schema สำหรับ validate request body ของ auth endpoints
 * ใช้คู่กับ middleware/validate.js
 */

const { z } = require('zod');
const { validateThaiId } = require('../../utils/thai-id-validator');
const { validatePasswordStrength } = require('../../utils/password-policy');

// ── Shared field schemas ────────────────────────────────────────────

/** เลขบัตรประจำตัว 13 หลัก (รองรับทั้งแบบมีขีดและไม่มีขีด) */
const thaiIdField = z
    .string({ message: 'กรุณากรอกเลขบัตรประชาชน' })
    .transform((v) => v.replace(/-/g, '').trim())
    .refine((v) => /^\d{13}$/.test(v), {
        message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก',
    })
    // Sprint 6 H9: enforce the Mod-11 checksum at the schema layer so
    // structurally-valid-but-algorithmically-invalid IDs (e.g.
    // `1234567890123`) are rejected before they reach the service.
    .refine((v) => validateThaiId(v).valid, {
        message: 'เลขบัตรประชาชนไม่ถูกต้องตามมาตรฐาน (Mod-11 checksum failed)',
    });

// passwordField — for SETTING a password (register / change / reset-with-token).
// Enforces the strong policy in utils/password-policy.js (owner directive
// 2026-06-11 "ระบบ password ต้องเข้ม"). superRefine surfaces every failed rule.
const passwordField = z
    .string({ message: 'กรุณากรอกรหัสผ่าน' })
    .superRefine((value, ctx) => {
        const { valid, errors } = validatePasswordStrength(value);
        if (!valid) {
            for (const message of errors) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message });
            }
        }
    });

// loginPasswordField — for LOGIN only. Validates presence, NOT strength: login
// compares against the stored bcrypt hash, so a legacy user whose password
// predates the strong policy must still be able to sign in. Strengthening
// passwordField must never lock existing users out.
const loginPasswordField = z
    .string({ message: 'กรุณากรอกรหัสผ่าน' })
    .min(1, 'กรุณากรอกรหัสผ่าน');

const phoneField = z
    .string({ message: 'กรุณากรอกเบอร์โทรศัพท์' })
    .regex(/^0\d{8,9}$/, 'เบอร์โทรศัพท์ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก');

// ── Health Login ────────────────────────────────────────────────────

const healthLoginSchema = z.object({
    identifier: z.string({ message: 'กรุณากรอกเลขบัตรประชาชน 13 หลัก' }).min(1, 'กรุณากรอกเลขบัตรประชาชน 13 หลัก'),
    password: loginPasswordField,
    healthId: z.string().optional(),
    accountType: z.string().optional(),
}).passthrough().superRefine((data, ctx) => {
    // National-ID-only login (owner directive 2026-06-11): the login identifier
    // MUST be a valid 13-digit Thai national ID. Email is NOT accepted — the
    // service login() no longer has an email lookup branch, so anything that is
    // not a checksum-valid 13-digit ID can never resolve to a user. Reject it
    // here with a clear message instead of letting it fall through to a generic
    // "invalid credentials".
    const cleaned = String(data.identifier || '').replace(/-/g, '').trim();
    if (!/^\d{13}$/.test(cleaned) || !validateThaiId(cleaned).valid) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['identifier'],
            message: 'กรุณากรอกเลขบัตรประชาชน 13 หลักให้ถูกต้อง (เข้าสู่ระบบด้วยเลขบัตรประชาชนเท่านั้น ไม่รองรับอีเมล)',
        });
    }
});

// ── Provider Login ──────────────────────────────────────────────────
// Public unauthenticated endpoint: type-validates providerId/password as
// strings before the route handler touches them. Earlier the handler
// destructured `req.body` and called `providerId.replace(/-/g, '')`
// directly — sending `{"providerId":["x"]}` or `{"providerId":{"$ne":null}}`
// triggered TypeError → 500 SERVER_ERROR. With Zod validation, those
// payloads now fail at the middleware boundary with a 400
// VALIDATION_ERROR + Thai message.
const providerLoginSchema = z.object({
    providerId: z
        .string({ message: 'กรุณากรอก Provider ID (เลขบัตรประชาชน 13 หลัก)' })
        .min(1, 'กรุณากรอก Provider ID (เลขบัตรประชาชน 13 หลัก)'),
    // Login validates presence only (see loginPasswordField) — the route
    // handler enforces the 13-digit providerId format.
    password: loginPasswordField,
}).passthrough();

// ── Health Register ─────────────────────────────────────────────────

const healthRegisterSchema = z.object({
    healthId: thaiIdField.optional(),
    idCard: thaiIdField.optional(),
    identifier: thaiIdField.optional(),
    password: passwordField,
    phoneNumber: phoneField,
    firstName: z.string({ message: 'กรุณากรอกชื่อ' }).min(1, 'กรุณากรอกชื่อ'),
    lastName: z.string({ message: 'กรุณากรอกนามสกุล' }).min(1, 'กรุณากรอกนามสกุล'),
    accountType: z.enum(['INDIVIDUAL', 'JURISTIC', 'COMMUNITY_ENTERPRISE']).default('INDIVIDUAL'),
    // COMP-006 (PDPA ม.19): explicit consent MUST be captured at registration.
    // Both required consents have to be affirmatively accepted (=== true) or the
    // request is rejected; the controller then persists them as UserConsent rows.
    acceptedTermsOfService: z.boolean().refine((v) => v === true, {
        message: 'ต้องยอมรับเงื่อนไขการให้บริการก่อนสมัครใช้งาน',
    }),
    acceptedPrivacyPolicy: z.boolean().refine((v) => v === true, {
        message: 'ต้องยอมรับนโยบายความเป็นส่วนตัว (PDPA) ก่อนสมัครใช้งาน',
    }),
}).passthrough().refine(
    (data) => data.healthId || data.idCard || data.identifier,
    { message: 'กรุณากรอกเลขบัตรประชาชน (healthId, idCard, หรือ identifier)', path: ['identifier'] },
);

// ── Change Password ─────────────────────────────────────────────────

const changePasswordSchema = z.object({
    oldPassword: z.string({ message: 'กรุณากรอกรหัสผ่านเดิม' }).min(1),
    newPassword: passwordField,
});

// ── Reset Password: none ────────────────────────────────────────────
// มติ operator 2026-09-16: ไม่มีระบบลืมรหัสผ่าน ผู้ใช้ขอรีเซ็ตเองไม่ได้ จึงไม่มี schema ของคำขอ
// มติ operator 2026-09-17 "เราไม่มีการกู้บัญชี": ไม่มีการตั้งรหัสใหม่ด้วย token ที่เจ้าหน้าที่ออกให้ด้วย

// ── Check Identifier ────────────────────────────────────────────────

const checkIdentifierSchema = z.object({
    identifier: z.string({ message: 'กรุณากรอกหมายเลขประจำตัว' }).min(1),
    accountType: z.string().optional(),
});

module.exports = {
    healthLoginSchema,
    healthRegisterSchema,
    providerLoginSchema,
    changePasswordSchema,
    checkIdentifierSchema,
};
