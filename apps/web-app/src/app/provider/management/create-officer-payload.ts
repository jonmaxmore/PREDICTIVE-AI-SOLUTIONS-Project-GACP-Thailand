/**
 * Payload builder for creating an officer account — the single place the
 * create dialog's data becomes the backend contract.
 *
 * Exists because the dialog and the contract drifted apart in production
 * (2026-08-14, screenshot 9.PNG): the form collected a username the backend
 * ignores and omitted the providerId it requires
 * (routes/api/system/provider.js:297-311 — 13-digit Thai ID, and
 * createProviderUser's min-10 password policy). Pure function so the
 * behavioral suite survives the planned redesign of the page around it.
 */

export interface CreateOfficerInput {
    providerId: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
}

export type CreateOfficerResult =
    | { ok: true; payload: CreateOfficerInput }
    | { ok: false; messageTh: string };

const THAI_ID_13 = /^\d{13}$/;
/** createProviderUser owns the full strength policy; 10 is its floor —
 *  mirrored here only so the user hears it before the network does. */
const PASSWORD_MIN = 10;

export function buildCreateOfficerPayload(input: CreateOfficerInput): CreateOfficerResult {
    const providerId = (input.providerId || '').trim();
    if (!THAI_ID_13.test(providerId)) {
        return { ok: false, messageTh: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' };
    }
    if (!(input.email || '').trim()) {
        return { ok: false, messageTh: 'กรุณากรอกอีเมล' };
    }
    if ((input.password || '').length < PASSWORD_MIN) {
        return { ok: false, messageTh: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร` };
    }
    if (!(input.firstName || '').trim() || !(input.lastName || '').trim()) {
        return { ok: false, messageTh: 'กรุณากรอกชื่อและนามสกุล' };
    }
    return {
        ok: true,
        payload: {
            providerId,
            email: input.email.trim(),
            password: input.password,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            role: input.role,
        },
    };
}

export interface EditOfficerInput {
    email: string;
    firstName: string;
    lastName: string;
    role: string;
}

/**
 * Payload for PUT /provider/directory/:id — profile fields only.
 *
 * Operator 2026-09-26 ("ปิด"): the directory sets no one's password; the
 * backend refuses a body that carries one (DIRECTORY_PASSWORD_WRITE_FORBIDDEN).
 * The dialog used to PUT its raw form state, which also carried `providerId: ''`
 * (refused as an identity edit, PROVIDER_ID_EDIT_FORBIDDEN) and `username`
 * (ignored). Staff change their own password at /provider/profile/security.
 */
export function buildEditOfficerPayload(input: EditOfficerInput): EditOfficerInput {
    return {
        email: (input.email || '').trim(),
        firstName: (input.firstName || '').trim(),
        lastName: (input.lastName || '').trim(),
        role: input.role,
    };
}
