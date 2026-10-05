/**
 * Encryption Utility Unit Tests
 */

const crypto = require('crypto');
const { encrypt, decrypt } = require('../../shared/encryption');

describe('🔐 Encryption Utility (AES-256-GCM)', () => {
    const testCases = [
        { input: 'ME0123456789', description: 'Standard Laser Code' },
        { input: 'AB9999999999', description: 'Edge Case Laser Code' },
        { input: 'Hello World!', description: 'Generic String' },
        { input: '1234567890123', description: 'ID Card Number' },
    ];

    test.each(testCases)('should encrypt and decrypt $description correctly', ({ input }) => {
        const encrypted = encrypt(input);

        // Encrypted should be different from original and use the gcm: prefix.
        expect(encrypted).not.toBe(input);
        expect(encrypted.startsWith('gcm:')).toBe(true);

        // Decrypted should match original
        expect(decrypt(encrypted)).toBe(input);
    });

    test('should return falsy for null/empty input', () => {
        expect(encrypt(null)).toBeNull();
        expect(decrypt(null)).toBeNull();
        expect(encrypt('')).toBe('');
        expect(decrypt('')).toBe('');
    });

    test('should throw when decrypt receives non-encrypted / malformed data', () => {
        // No colon, no prefix → cannot match either GCM or legacy CBC layout.
        expect(() => decrypt('ME0123456789')).toThrow(/CRYPTO|Malformed/);
        // Wrong number of parts.
        expect(() => decrypt('gcm:abc')).toThrow();
        // Non-string input.
        expect(() => decrypt(123)).toThrow();
    });

    test('should detect ciphertext tampering (auth tag verification)', () => {
        const cipher = encrypt('1234567890123');
        // Flip the last hex char of the ciphertext segment.
        const flipped = cipher.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
        expect(() => decrypt(flipped)).toThrow();
    });

    test('should produce different ciphertexts for same input (random IV)', () => {
        const input = 'ME0123456789';
        const encrypted1 = encrypt(input);
        const encrypted2 = encrypt(input);

        expect(encrypted1).not.toBe(encrypted2);
        expect(decrypt(encrypted1)).toBe(input);
        expect(decrypt(encrypted2)).toBe(input);
    });

    test('should still decrypt legacy AES-256-CBC ciphertext (`<iv>:<ct>`)', () => {
        // Reproduce the previous implementation's output to confirm
        // backward-compatibility for values already stored in the DB.
        const KEY = crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY)).digest();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
        const ct = Buffer.concat([cipher.update('legacy-value', 'utf8'), cipher.final()]);
        const legacy = `${iv.toString('hex')}:${ct.toString('hex')}`;

        expect(decrypt(legacy)).toBe('legacy-value');
    });
});

