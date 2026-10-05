'use strict';

/**
 * Strong-password policy (auth security audit 2026-06-11, owner directive
 * "ระบบ password ต้องเข้ม"). Pins the rules so they can't silently weaken.
 */

const { validatePasswordStrength, PASSWORD_MIN_LENGTH } = require('../../utils/password-policy');

describe('validatePasswordStrength', () => {
    it('accepts a password meeting all rules', () => {
        const { valid, errors } = validatePasswordStrength('Str0ng#Pass99');
        expect(valid).toBe(true);
        expect(errors).toEqual([]);
    });

    it.each([
        ['too short', 'Ab1!', /อย่างน้อย 10 ตัวอักษร/],
        ['no uppercase', 'str0ng#pass99', /ตัวอักษรพิมพ์ใหญ่/],
        ['no lowercase', 'STR0NG#PASS99', /ตัวอักษรพิมพ์เล็ก/],
        ['no digit', 'Strong#Password', /ตัวเลข/],
        ['no special char', 'Str0ngPass99', /อักขระพิเศษ/],
        ['4+ repeated chars', 'Aaaaa1#bcde', /ซ้ำกันเกิน 3 ตัว/],
    ])('rejects: %s', (_label, pw, messageRe) => {
        const { valid, errors } = validatePasswordStrength(pw);
        expect(valid).toBe(false);
        expect(errors.some((e) => messageRe.test(e))).toBe(true);
    });

    it('rejects a common/guessable password even if it would otherwise pass composition', () => {
        // p@ssw0rd123 has lower/digit/special but is on the denylist (and lacks uppercase)
        const { valid } = validatePasswordStrength('p@ssw0rd123');
        expect(valid).toBe(false);
    });

    it('rejects non-string input safely', () => {
        expect(validatePasswordStrength(undefined).valid).toBe(false);
        expect(validatePasswordStrength(null).valid).toBe(false);
        expect(validatePasswordStrength(12345678901).valid).toBe(false);
    });

    it('enforces the documented minimum length', () => {
        expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(10);
    });
});
