/**
 * Password strength policy (auth security audit 2026-06-11, owner directive
 * "ระบบ password ต้องเข้ม").
 *
 * Single source of truth for what a STRONG password is on this platform. Used
 * by every password-SETTING path — health register, change-password, reset-
 * with-token, and admin provider-account creation — so the rule can never
 * drift between flows. It is deliberately NOT applied to LOGIN: login compares
 * against the stored bcrypt hash and must keep accepting whatever a legacy user
 * already set, or strengthening the policy would lock existing users out.
 *
 * Government platform holding citizens' PII → length + full character-class
 * composition + trivial-pattern rejection. (HIBP/breach-list lookup is a
 * deliberate non-goal here: it needs an external network call + a fail-open
 * vs fail-closed decision; tracked as a follow-up.)
 */
'use strict';

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

// The most-guessed passwords (lowercased). Small, high-signal denylist — not a
// substitute for a breach-list, just a cheap block on the obvious ones.
const COMMON_WEAK_PASSWORDS = new Set([
    'password', 'password1', 'password12', 'password123', 'passw0rd', 'passw0rd123',
    '1234567890', '12345678', '123456789', '123456789012', 'qwertyuiop', 'qwerty123',
    'iloveyou', 'admin123', 'administrator', 'letmein123', 'welcome123', 'changeme',
    'p@ssword', 'p@ssw0rd', 'gacp123456', 'gacp@12345', 'thailand123',
]);

/**
 * Validate a candidate password against the platform strength policy.
 *
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }} Thai-language error messages
 *          (one per failed rule) so callers can surface them directly.
 */
function validatePasswordStrength(password) {
    const errors = [];
    const pw = typeof password === 'string' ? password : '';

    if (pw.length < MIN_LENGTH) {
        errors.push(`รหัสผ่านต้องมีอย่างน้อย ${MIN_LENGTH} ตัวอักษร`);
    }
    if (pw.length > MAX_LENGTH) {
        errors.push(`รหัสผ่านต้องไม่เกิน ${MAX_LENGTH} ตัวอักษร`);
    }
    if (!/[a-z]/.test(pw)) {
        errors.push('รหัสผ่านต้องมีตัวอักษรพิมพ์เล็ก (a-z)');
    }
    if (!/[A-Z]/.test(pw)) {
        errors.push('รหัสผ่านต้องมีตัวอักษรพิมพ์ใหญ่ (A-Z)');
    }
    if (!/\d/.test(pw)) {
        errors.push('รหัสผ่านต้องมีตัวเลข (0-9)');
    }
    if (!/[^A-Za-z0-9]/.test(pw)) {
        errors.push('รหัสผ่านต้องมีอักขระพิเศษ (เช่น ! @ # $ %)');
    }
    // 4+ of the same character in a row (aaaa, 1111) — trivially guessable.
    if (/(.)\1{3,}/.test(pw)) {
        errors.push('รหัสผ่านต้องไม่มีอักขระเดิมซ้ำกันเกิน 3 ตัวติดต่อกัน');
    }
    if (COMMON_WEAK_PASSWORDS.has(pw.toLowerCase())) {
        errors.push('รหัสผ่านนี้คาดเดาได้ง่ายเกินไป กรุณาเลือกรหัสผ่านอื่น');
    }

    return { valid: errors.length === 0, errors };
}

module.exports = {
    validatePasswordStrength,
    PASSWORD_MIN_LENGTH: MIN_LENGTH,
    PASSWORD_MAX_LENGTH: MAX_LENGTH,
};
