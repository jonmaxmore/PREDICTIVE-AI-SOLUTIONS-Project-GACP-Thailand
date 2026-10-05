/**
 * Unit Tests — Health ID, Laser Code, Phone & Email Validation
 * 
 * Critical tests for identity and contact validation.
 * Must pass 100% before production deployment.
 */

import {
    validateHealthId,
    formatHealthIdCard,
    maskHealthIdCard,
    validateLaserCode,
    formatLaserCode,
    validateThaiPhone,
    formatThaiPhone,
    validateEmail,
    validatePassword,
} from '../src/utils/validation';

describe('Health ID Validation', () => {
    // Valid test cases
    describe('Valid ID Cards', () => {
        const validIds = [
            '1100700000001', // Known valid format
            '3100100000009', // Bangkok format
        ];

        test.each(validIds)('should validate correct ID: %s', (id) => {
            // Generate valid checksum for testing
            const digits = id.slice(0, 12).split('').map(Number);
            const weights = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
            let sum = 0;
            for (let i = 0; i < 12; i++) {
                sum += digits[i] * weights[i];
            }
            const checkDigit = (11 - (sum % 11)) % 10;
            const validId = id.slice(0, 12) + checkDigit;

            const result = validateHealthId(validId);
            expect(result.valid).toBe(true);
        });
    });

    // Invalid test cases
    describe('Invalid ID Cards', () => {
        test('should reject too short ID', () => {
            const result = validateHealthId('123456');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('13 หลัก');
        });

        test('should reject too long ID', () => {
            const result = validateHealthId('12345678901234567');
            expect(result.valid).toBe(false);
        });

        test('should reject ID starting with 0', () => {
            const result = validateHealthId('0123456789012');
            expect(result.valid).toBe(false);
        });

        test('should reject invalid checksum', () => {
            const result = validateHealthId('1234567890123');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('checksum');
        });

        test('should handle non-numeric characters', () => {
            const result = validateHealthId('1-2345-67890-12-3');
            // Should strip non-digits and validate
            expect(result.valid).toBe(false);
        });
    });

    // Formatting tests
    describe('Formatting', () => {
        test('should format ID correctly', () => {
            const formatted = formatHealthIdCard('1234567890123');
            expect(formatted).toBe('1-2345-67890-12-3');
        });

        test('should mask ID for privacy', () => {
            const masked = maskHealthIdCard('1234567890123');
            expect(masked).toBe('1-2345-67890-**-*');
        });
    });
});

describe('Laser Code Validation', () => {
    describe('Valid Laser Codes', () => {
        test('should validate correct format (XX0-XXXXXXX-XX)', () => {
            const result = validateLaserCode('JT0-1234567-89');
            expect(result.valid).toBe(true);
        });

        test('should validate without hyphens', () => {
            const result = validateLaserCode('AB0123456789');
            expect(result.valid).toBe(true);
        });
    });

    describe('Invalid Laser Codes', () => {
        test('should reject too short code', () => {
            const result = validateLaserCode('ABC12345');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('12');
        });

        test('should reject invalid format', () => {
            const result = validateLaserCode('123456789012');
            expect(result.valid).toBe(false);
        });
    });

    describe('Formatting', () => {
        test('should format code correctly', () => {
            const formatted = formatLaserCode('AB0123456789');
            expect(formatted).toBe('AB0-1234567-89');
        });
    });
});

describe('Phone Validation', () => {
    describe('Valid Phone Numbers', () => {
        const validPhones = [
            '0812345678',   // Mobile 08
            '0912345678',   // Mobile 09
            '0612345678',   // Mobile 06
            '021234567',    // Bangkok landline
        ];

        test.each(validPhones)('should validate: %s', (phone) => {
            const result = validateThaiPhone(phone);
            expect(result.valid).toBe(true);
        });

        test('should accept international format', () => {
            expect(validateThaiPhone('+66812345678').valid).toBe(true);
            expect(validateThaiPhone('66812345678').valid).toBe(true);
        });
    });

    describe('Invalid Phone Numbers', () => {
        test('should reject too short', () => {
            const result = validateThaiPhone('08123456');
            expect(result.valid).toBe(false);
        });

        test('should reject invalid prefix', () => {
            const result = validateThaiPhone('0112345678');
            expect(result.valid).toBe(false);
        });
    });

    describe('Formatting', () => {
        test('should format mobile number', () => {
            const formatted = formatThaiPhone('0812345678');
            expect(formatted).toBe('081-234-5678');
        });
    });
});

describe('Email Validation', () => {
    describe('Valid Emails', () => {
        const validEmails = [
            'test@example.com',
            'user.name@domain.co.th',
            'user+tag@gmail.com',
        ];

        test.each(validEmails)('should validate: %s', (email) => {
            expect(validateEmail(email).valid).toBe(true);
        });
    });

    describe('Invalid Emails', () => {
        const invalidEmails = [
            'invalid',
            'no@domain',
            '@missing.com',
            'spaces in@email.com',
        ];

        test.each(invalidEmails)('should reject: %s', (email) => {
            expect(validateEmail(email).valid).toBe(false);
        });
    });
});

describe('Password Validation', () => {
    test('should accept strong password', () => {
        const result = validatePassword('StrongP@ss123');
        expect(result.valid).toBe(true);
        expect(result.strength).toBe('strong');
    });

    test('should reject weak password', () => {
        const result = validatePassword('weak');
        expect(result.valid).toBe(false);
        expect(result.strength).toBe('weak');
        expect(result.requirements.minLength).toBe(false);
    });

    test('should check all requirements', () => {
        const result = validatePassword('onlylowercase');
        expect(result.requirements.hasLowercase).toBe(true);
        expect(result.requirements.hasUppercase).toBe(false);
        expect(result.requirements.hasNumber).toBe(false);
        expect(result.requirements.hasSpecial).toBe(false);
    });
});
