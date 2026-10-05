/**
 * The Thai 13-digit check digit — correctness of the ONE implementation.
 *
 * Ledger F-G4-10. Every number used as a "known good" anchor here is either
 * published on a real document this platform issues, or DERIVED from the rule by
 * an independently-written second implementation in this file. Nothing is
 * invented by pattern, because a number invented by pattern proves only that the
 * test author and the implementation author made the same assumption.
 */

'use strict';

const {
    THAI_ID_LENGTH,
    THAI_ID_REJECTION,
    normalizeThaiId,
    thaiIdCheckDigit,
    isThaiIdChecksumValid,
    checkThaiId,
} = require('@gacp/validation/thai-id-checksum');

/**
 * เลขประจำตัวผู้เสียภาษีของกรมการแพทย์แผนไทยฯ — เก็บไว้ที่นี่เป็น **ตัวอย่างทดสอบ**
 * ไม่ใช่ค่าที่ระบบใช้งาน · เดิมอ่านจาก DTAM_ISSUER ใน config/invoice-issuers.js
 * ซึ่งถูกถอดเมื่อ 2026-09-11 ตอน operator สั่งให้มีผู้ออกเอกสารรายเดียว
 *
 * ค่านี้ยังมีประโยชน์เพราะมันเป็นเลขที่ **จับสูตร mod-11 ผิดได้** (ดูข้อล่าง) —
 * คุณสมบัติของตัวเลข ไม่ใช่ของบทบาทที่กรมเคยมีในระบบ
 */
const DTAM_TAX_ID_AS_A_TEST_VECTOR = '0994000036540';

const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');

/**
 * An independent re-derivation of DOPA's rule, written in a deliberately
 * different shape from the implementation (modular negation rather than a
 * subtraction, explicit weight table rather than `13 - i`).
 *
 * Its job is to make "the implementation agrees with itself" impossible: if both
 * were the same expression, agreement would prove nothing.
 */
function independentCheckDigit(first12) {
    const WEIGHTS = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
        sum += Number(first12[i]) * WEIGHTS[i];
    }
    const negated = (((-sum) % 11) + 11) % 11; // === (11 - sum % 11) % 11
    return (negated === 0 ? 11 : negated) % 10;
}

describe('Thai 13-digit check digit — published anchors', () => {
    // These are not test fixtures. They are the tax IDs this platform prints on
    // the receipts it actually issues, so their final digits are real published
    // check digits that the ministry and the Revenue Department both rely on.
    const publishedIds = [
        // เดิมมีสองแถว — เลขของกรมบนใบเสร็จเงินรายได้แผ่นดิน และของบริษัทบนใบกำกับภาษี
        // ใบเสร็จในนามกรมถูกยกเลิกไปพร้อมผู้ออกเอกสารสองราย (operator 2026-09-11)
        ['บริษัทผู้ออกเอกสาร บนใบกำกับภาษีทุกใบ', PLATFORM_ISSUER.taxId],
    ];

    it.each(publishedIds)('%s: %s passes the checksum', (_who, taxId) => {
        expect(taxId).toMatch(/^\d{13}$/);
        expect(isThaiIdChecksumValid(taxId)).toBe(true);
    });

    it.each(publishedIds)('%s: the rule REPRODUCES its real final digit', (_who, taxId) => {
        const first12 = taxId.slice(0, 12);
        const publishedCheckDigit = Number(taxId[12]);
        expect(thaiIdCheckDigit(first12)).toBe(publishedCheckDigit);
        // and the independent derivation lands on the same digit
        expect(independentCheckDigit(first12)).toBe(publishedCheckDigit);
    });

    it('เลขของกรมคือเคสที่จับสูตร mod-11 ผิดได้', () => {
        // `apps/backend/shared/zod-schemas.js` used to compute the ISBN-style
        // fold `r < 2 ? r : 11 - r`. On DTAM's own tax ID that yields 1, but the
        // digit the ministry actually publishes is 0. Pinning this specific
        // number means the wrong variant cannot come back unnoticed.
        const first12 = DTAM_TAX_ID_AS_A_TEST_VECTOR.slice(0, 12);
        let sum = 0;
        for (let i = 0; i < 12; i += 1) { sum += Number(first12[i]) * (13 - i); }
        const wrongVariant = (sum % 11) < 2 ? (sum % 11) : 11 - (sum % 11);

        expect(thaiIdCheckDigit(first12)).toBe(Number(DTAM_TAX_ID_AS_A_TEST_VECTOR[12]));
        expect(wrongVariant).not.toBe(Number(DTAM_TAX_ID_AS_A_TEST_VECTOR[12]));
    });
});

describe('Thai 13-digit check digit — agreement with an independent derivation', () => {
    it('matches over every residue class, across 50,000 prefixes', () => {
        const residuesSeen = new Set();
        for (let n = 0; n < 50000; n += 1) {
            const first12 = String(n).padStart(12, '0');
            expect(thaiIdCheckDigit(first12)).toBe(independentCheckDigit(first12));
            let sum = 0;
            for (let i = 0; i < 12; i += 1) { sum += Number(first12[i]) * (13 - i); }
            residuesSeen.add(sum % 11);
        }
        // All 11 residues exercised, so the agreement is not an accident of range.
        expect(residuesSeen.size).toBe(11);
    });

    it('a derived check digit always produces a valid ID', () => {
        for (let n = 0; n < 5000; n += 1) {
            const first12 = String(n * 7919).padStart(12, '0').slice(-12);
            const id = first12 + String(thaiIdCheckDigit(first12));
            expect(isThaiIdChecksumValid(id)).toBe(true);
        }
    });
});

describe('transposition — the error class a checksum exists to catch', () => {
    // Derived, not chosen: take a real published number and swap one adjacent
    // pair. Nothing about these is hand-picked to pass.
    const bases = [DTAM_TAX_ID_AS_A_TEST_VECTOR, PLATFORM_ISSUER.taxId];

    function adjacentSwaps(id) {
        const out = [];
        for (let i = 0; i < 11; i += 1) {
            if (id[i] === id[i + 1]) {continue;} // swapping equal digits is not an error
            const chars = id.split('');
            [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
            out.push([i, chars.join('')]);
        }
        return out;
    }

    it.each(bases)('%s: every adjacent transposition inside the first 12 digits is rejected', (base) => {
        const swaps = adjacentSwaps(base);
        expect(swaps.length).toBeGreaterThan(5); // the test would be vacuous otherwise
        for (const [position, mutated] of swaps) {
            expect(mutated).not.toBe(base);
            expect({ position, mutated, valid: isThaiIdChecksumValid(mutated) })
                .toEqual({ position, mutated, valid: false });
        }
    });

    it.each(bases)('%s: the refusal names the check digit, not a length problem', (base) => {
        const [, mutated] = adjacentSwaps(base)[0];
        const result = checkThaiId(mutated);
        expect(result.ok).toBe(false);
        expect(result.code).toBe(THAI_ID_REJECTION.CHECKSUM);
    });

    it('documents the collision the NATIONAL STANDARD has, rather than hiding it', () => {
        // Residue 0 and residue 10 both map to check digit 1, so an adjacent
        // transposition that moves the sum between those two residues is NOT
        // caught. This is a property of DOPA's rule. It is pinned here so nobody
        // "fixes" the arithmetic to close it — a stricter rule would reject real
        // citizens holding real cards, which is the worse failure.
        const undetected = [];
        for (let n = 0; n < 20000 && undetected.length === 0; n += 1) {
            const first12 = String(n).padStart(12, '0');
            const id = first12 + String(thaiIdCheckDigit(first12));
            for (let i = 0; i < 11; i += 1) {
                if (id[i] === id[i + 1]) {continue;}
                const chars = id.split('');
                [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
                const mutated = chars.join('');
                if (isThaiIdChecksumValid(mutated)) {
                    undetected.push({ id, mutated, checkDigit: id[12] });
                    break;
                }
            }
        }
        expect(undetected.length).toBe(1);
        // Every undetected adjacent transposition belongs to an ID whose check
        // digit is 1 — the residue 0/10 collision, and only that.
        expect(undetected[0].checkDigit).toBe('1');
    });
});

describe('length and shape', () => {
    it('rejects 12 and 14 digits derived from a real valid number', () => {
        const valid = DTAM_TAX_ID_AS_A_TEST_VECTOR;
        expect(isThaiIdChecksumValid(valid.slice(0, 12))).toBe(false);
        expect(isThaiIdChecksumValid(`${valid}0`)).toBe(false);
    });

    it('names the length and the next action', () => {
        const short = checkThaiId(DTAM_TAX_ID_AS_A_TEST_VECTOR.slice(0, 12));
        expect(short.ok).toBe(false);
        expect(short.code).toBe(THAI_ID_REJECTION.WRONG_LENGTH);
        expect(short.message).toContain('12 หลัก');
        expect(short.message).toContain('คุณสามารถ');
    });

    it('rejects letters instead of silently stripping them into a short number', () => {
        const result = checkThaiId('11000000000ab');
        expect(result.ok).toBe(false);
        expect(result.code).toBe(THAI_ID_REJECTION.NOT_DIGITS);
    });

    it('rejects an empty value with a prompt, not a checksum complaint', () => {
        expect(checkThaiId('').code).toBe(THAI_ID_REJECTION.MISSING);
        expect(checkThaiId(null).code).toBe(THAI_ID_REJECTION.MISSING);
        expect(checkThaiId(undefined).code).toBe(THAI_ID_REJECTION.MISSING);
    });

    it('accepts the dashed form printed on the card itself', () => {
        const v = DTAM_TAX_ID_AS_A_TEST_VECTOR;
        const dashed = `${v[0]}-${v.slice(1, 5)}-${v.slice(5, 10)}-${v.slice(10, 12)}-${v[12]}`;
        expect(normalizeThaiId(dashed)).toBe(v);
        expect(isThaiIdChecksumValid(dashed)).toBe(true);
        expect(checkThaiId(dashed)).toEqual({ ok: true, normalized: v });
    });

    it('thaiIdCheckDigit throws rather than returning a number for bad input', () => {
        expect(() => thaiIdCheckDigit('123')).toThrow(TypeError);
        expect(() => thaiIdCheckDigit('12345678901a')).toThrow(TypeError);
    });

    it('THAI_ID_LENGTH is the constant callers key off', () => {
        expect(THAI_ID_LENGTH).toBe(13);
    });
});

describe('the message a farmer reads', () => {
    it('names the cause AND the next action, addressing them as คุณ', () => {
        const wrong = DTAM_TAX_ID_AS_A_TEST_VECTOR.slice(0, 12) + String((Number(DTAM_TAX_ID_AS_A_TEST_VECTOR[12]) + 1) % 10);
        const result = checkThaiId(wrong);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('หลักสุดท้าย');   // the cause
        expect(result.message).toContain('คุณสามารถ');      // the next action
        expect(result.message).not.toContain('—');          // no em dash in Thai copy
    });

    it('quotes the field label the form used, so a company sees its own wording', () => {
        const wrong = DTAM_TAX_ID_AS_A_TEST_VECTOR.slice(0, 12) + String((Number(DTAM_TAX_ID_AS_A_TEST_VECTOR[12]) + 1) % 10);
        const result = checkThaiId(wrong, { label: 'เลขประจำตัวผู้เสียภาษี' });
        expect(result.message).toContain('เลขประจำตัวผู้เสียภาษี');
        expect(result.message).not.toContain('เลขบัตรประชาชน');
    });
});
