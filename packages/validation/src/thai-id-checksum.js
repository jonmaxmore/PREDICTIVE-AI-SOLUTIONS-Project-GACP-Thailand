'use strict';

/**
 * The Thai 13-digit ID check digit, computed in ONE place for the whole platform.
 *
 * F-G4-10: the application wizard's step 4 checked the national ID with
 * `/^\d{13}$/` and nothing else, while registration (auth-schemas.js) ran the
 * real Mod-11 checksum. A farmer could therefore be refused a made-up number at
 * sign-up and accept the same made-up number onto the application that becomes
 * the certificate. The gap was not that anyone forgot the rule: the rule existed
 * in SEVEN separate copies across the repo, and step 4 happened to use the one
 * that was only a length test.
 *
 * ── Why this file is CommonJS, not TypeScript ────────────────────────────────
 * The same reason `upload-rules.js` next door is: the browser half of the wizard
 * is TypeScript compiled by Next, the server half is CommonJS Node running
 * straight off the pnpm workspace symlink. A `.ts` module is invisible to the
 * second. `packages/validation/src/thai-id.ts` has existed since 2026-04 and is
 * named as canonical by the identity manual, yet
 * both backend copies were written anyway — because the backend could not
 * require it. A shared module the server cannot load is not shared, it is a
 * fourth copy with better documentation. CommonJS + JSDoc is the one shape both
 * halves can consume, so that is what the arithmetic lives in.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * DOPA's published rule for the 13-digit เลขประจำตัวประชาชน:
 *
 *     sum   = Σ digit[i] × (13 − i)   for i = 0..11
 *     check = (11 − (sum mod 11)) mod 10
 *     valid ⟺ check === digit[12]
 *
 * The SAME check digit governs the 13-digit เลขประจำตัวผู้เสียภาษีอากร /
 * juristic-person registration number, which is why one function serves both the
 * farmer's ID card and a company's tax ID. Verified against numbers this product
 * itself prints on real documents: DTAM's `0994000036540` and the platform
 * company's `0105568045932` (config/invoice-issuers.js:283,337) both reproduce
 * their real published final digit under this rule. The single-source test pins
 * that, so a "cleanup" of the arithmetic has to survive the ministry's own number.
 *
 * ── What this rule does and does not catch ───────────────────────────────────
 * Because 11 residues are folded onto 10 check digits, residue 0 and residue 10
 * BOTH produce check digit 1. That collision is in the national standard, not in
 * this implementation. Measured over 1,550,000 adjacent transpositions inside the
 * first 12 digits (scratch derivation, 2026-08-26): 97.85% are caught, and every
 * one of the 2.15% missed belongs to an ID whose check digit is 1.
 *
 * That number is a property of the standard and must NOT be "fixed" here. A
 * stricter rule would reject real citizens holding real cards, which is a far
 * worse failure than the one it would prevent. Catching the remainder is a job
 * for verifying the ID against DOPA, not for changing the arithmetic.
 *
 * ── What this module deliberately does NOT judge ─────────────────────────────
 * Whether the number belongs to the person holding it. A checksum-valid number
 * can still be somebody else's, or nobody's. Only a DOPA/ThaiD lookup answers
 * that, and until one is wired the uploaded ID-card document remains the thing an
 * officer actually reads.
 */

/** เลขประจำตัวประชาชน / เลขประจำตัวผู้เสียภาษีอากร are both exactly this long. */
const THAI_ID_LENGTH = 13;

/** How many leading digits feed the checksum. The 13th IS the checksum. */
const THAI_ID_PAYLOAD_LENGTH = 12;

/** Machine-readable refusal reasons. The Thai sentence is what a farmer reads. */
const THAI_ID_REJECTION = Object.freeze({
    MISSING: 'THAI_ID_MISSING',
    NOT_DIGITS: 'THAI_ID_NOT_DIGITS',
    WRONG_LENGTH: 'THAI_ID_WRONG_LENGTH',
    CHECKSUM: 'THAI_ID_CHECKSUM_FAILED',
});

/**
 * Strip the separators a farmer may legitimately type.
 *
 * Cards are printed `X-XXXX-XXXXX-XX-X`, so people copy the dashes across. Spaces
 * come from paste. Neither is an error worth refusing — normalise, then judge.
 * Anything else surviving here is a real non-digit and IS refused, so this cannot
 * quietly "clean" `12345abc678901` into a shorter number that then fails on
 * length and tells the farmer the wrong thing.
 *
 * @param {unknown} input
 * @returns {string} the input with dashes and whitespace removed
 */
function normalizeThaiId(input) {
    return String(input == null ? '' : input).replace(/[-\s]/g, '');
}

/**
 * The check digit DOPA's rule derives from the first 12 digits.
 *
 * This is the ONE place the arithmetic exists. Everything else in the platform
 * calls through to here.
 *
 * @param {string} first12 exactly 12 numeric characters
 * @returns {number} the expected 13th digit, 0-9
 * @throws {TypeError} when the input is not 12 digits — a caller that reaches
 *   this with anything else has a bug, and returning a number would hide it
 */
function thaiIdCheckDigit(first12) {
    const digits = String(first12 == null ? '' : first12);
    if (!/^\d{12}$/.test(digits)) {
        throw new TypeError(`thaiIdCheckDigit expects exactly ${THAI_ID_PAYLOAD_LENGTH} digits`);
    }
    // Weights run 13, 12, … 2 across the twelve payload digits. The 13 is the
    // published weight of the first digit, NOT a reuse of THAI_ID_LENGTH — the
    // two happen to be the same number and mean different things, so the literal
    // stays literal.
    let sum = 0;
    for (let i = 0; i < THAI_ID_PAYLOAD_LENGTH; i += 1) {
        sum += Number(digits[i]) * (13 - i);
    }
    return (11 - (sum % 11)) % 10;
}

/**
 * Does this string pass the Thai 13-digit checksum?
 *
 * Accepts the dashed card format. Returns a plain boolean for call sites that
 * only need a yes/no (Zod `.refine`, a disabled-button check). Call sites that
 * must TELL the user what went wrong want {@link checkThaiId} instead.
 *
 * @param {unknown} input
 * @returns {boolean}
 */
function isThaiIdChecksumValid(input) {
    const cleaned = normalizeThaiId(input);
    if (!new RegExp(`^\\d{${THAI_ID_LENGTH}}$`).test(cleaned)) {
        return false;
    }
    return thaiIdCheckDigit(cleaned.slice(0, THAI_ID_PAYLOAD_LENGTH)) === Number(cleaned[THAI_ID_PAYLOAD_LENGTH]);
}

/**
 * Judge an ID and, when it is wrong, say what is wrong and what to do next.
 *
 * `label` exists because the same 13-digit number is called different things on
 * different forms: a farmer's own card is เลขบัตรประชาชน, a company's is
 * เลขประจำตัวผู้เสียภาษี. Quoting the field's own label back is what makes the
 * refusal checkable against the box the farmer just typed into.
 *
 * @param {unknown} input
 * @param {{label?: string}} [options]
 * @returns {{ok: true, normalized: string} | {ok: false, code: string, message: string}}
 */
function checkThaiId(input, options) {
    const label = (options && options.label) || 'เลขบัตรประชาชน';
    const cleaned = normalizeThaiId(input);

    if (!cleaned) {
        return {
            ok: false,
            code: THAI_ID_REJECTION.MISSING,
            message: `กรุณากรอก${label} 13 หลัก`,
        };
    }

    if (!/^\d+$/.test(cleaned)) {
        return {
            ok: false,
            code: THAI_ID_REJECTION.NOT_DIGITS,
            message: `${label}ต้องเป็นตัวเลขเท่านั้น คุณสามารถลบตัวอักษรและเครื่องหมายอื่นออก แล้วกรอกเฉพาะตัวเลข 13 หลัก`,
        };
    }

    if (cleaned.length !== THAI_ID_LENGTH) {
        return {
            ok: false,
            code: THAI_ID_REJECTION.WRONG_LENGTH,
            message: `${label}ต้องมี 13 หลัก แต่กรอกมา ${cleaned.length} หลัก คุณสามารถตรวจสอบเลขบนบัตรแล้วกรอกใหม่ให้ครบ โดยไม่ต้องใส่ขีดคั่น`,
        };
    }

    if (!isThaiIdChecksumValid(cleaned)) {
        // Naming the check digit is what makes this refusal actionable: the
        // farmer can compare the last digit on the card without knowing the
        // arithmetic, and a typo in any of the first 12 shows up here too.
        return {
            ok: false,
            code: THAI_ID_REJECTION.CHECKSUM,
            message: `${label}ไม่ถูกต้อง หลักสุดท้ายเป็นเลขตรวจสอบที่คำนวณจาก 12 หลักแรก และไม่ตรงกัน คุณสามารถตรวจสอบเลขบนบัตรอีกครั้งแล้วกรอกใหม่`,
        };
    }

    return { ok: true, normalized: cleaned };
}

module.exports = {
    THAI_ID_LENGTH,
    THAI_ID_PAYLOAD_LENGTH,
    THAI_ID_REJECTION,
    normalizeThaiId,
    thaiIdCheckDigit,
    isThaiIdChecksumValid,
    checkThaiId,
};
