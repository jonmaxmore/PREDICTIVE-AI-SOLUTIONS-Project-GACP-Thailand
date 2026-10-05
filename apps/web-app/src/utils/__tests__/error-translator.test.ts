/**
 * Unit Tests for Error Translator
 * @jest-environment node
 */

import { translateError } from '../error-translator';

describe('Error Translator', () => {
    describe('translateError', () => {
        it('should translate exact match errors', () => {
            expect(translateError('Invalid credentials')).toBe('เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง');
            expect(translateError('User not found')).toBe('ไม่พบบัญชีผู้ใช้นี้ กรุณาลงทะเบียนก่อน');
            expect(translateError('Network Error')).toBe('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        });

        it('should translate partial match errors', () => {
            expect(translateError('Account locked. Try again in 5 minutes')).toContain('ล็อค');
        });

        it('should return generic Thai error for unknown English errors', () => {
            expect(translateError('Some unknown error')).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        });

        it('should return original for Thai text', () => {
            const thaiError = 'ข้อผิดพลาดภาษาไทย';
            expect(translateError(thaiError)).toBe(thaiError);
        });

        it('should handle registration errors', () => {
            expect(translateError('Email already exists')).toContain('อีเมล');
            expect(translateError('Phone number already registered')).toContain('เบอร์โทรศัพท์');
        });

        it('should handle network errors', () => {
            expect(translateError('Failed to fetch')).toContain('เชื่อมต่อ');
            expect(translateError('Internal Server Error')).toContain('เซิร์ฟเวอร์');
        });

        // Wave-C adversarial-verify F2 (2026-07-03): the workspace
        // per-permission denial branch was REMOVED from this module —
        // translateError has zero runtime callers, so the branch (and its
        // test) were false-green dead code. The LIVE denial translation is
        // the api-client 403 pass-through
        // (lib/api/entity-permission-denial.ts), tested in
        // lib/api/__tests__/api-client.test.ts.
    });
});
