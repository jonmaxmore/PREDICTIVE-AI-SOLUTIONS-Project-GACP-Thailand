/**
 * Multi-Factor Authentication Service
 * TOTP (Time-based One-Time Password) - RFC 6238
 * 
 * For DTAM Provider accounts (higher security requirement)
 */

const crypto = require('crypto');

// Constants
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const SECRET_LENGTH = 20; // bytes

class MFAService {
    /**
     * Generate a new MFA secret for a user
     */
    generateSecret() {
        const buffer = crypto.randomBytes(SECRET_LENGTH);
        const secret = this.base32Encode(buffer);
        return secret;
    }

    /**
     * Generate provisioning URI for QR code
     */
    generateQRCodeUri(secret, accountName, issuer = 'GACP-DTAM') {
        const encodedIssuer = encodeURIComponent(issuer);
        const encodedAccount = encodeURIComponent(accountName);
        return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
    }

    /**
     * Generate current TOTP code
     */
    generateTOTP(secret, timestamp = Date.now()) {
        const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD);
        return this.generateHOTP(secret, counter);
    }

    /**
     * Verify TOTP code with time window tolerance
     */
    verifyTOTP(secret, token, window = 1) {
        const timestamp = Date.now();
        const currentCounter = Math.floor(timestamp / 1000 / TOTP_PERIOD);

        // Check current and adjacent time windows
        for (let i = -window; i <= window; i++) {
            const expectedToken = this.generateHOTP(secret, currentCounter + i);
            if (this.secureCompare(token, expectedToken)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Generate HOTP (HMAC-based OTP)
     */
    generateHOTP(secret, counter) {
        const decodedSecret = this.base32Decode(secret);

        // Convert counter to 8-byte buffer
        const counterBuffer = Buffer.alloc(8);
        counterBuffer.writeBigUInt64BE(BigInt(counter));

        // HMAC-SHA1
        const hmac = crypto.createHmac('sha1', decodedSecret);
        hmac.update(counterBuffer);
        const digest = hmac.digest();

        // Dynamic truncation
        const offset = digest[digest.length - 1] & 0x0f;
        const binary =
            ((digest[offset] & 0x7f) << 24) |
            ((digest[offset + 1] & 0xff) << 16) |
            ((digest[offset + 2] & 0xff) << 8) |
            (digest[offset + 3] & 0xff);

        const otp = binary % Math.pow(10, TOTP_DIGITS);
        return otp.toString().padStart(TOTP_DIGITS, '0');
    }

    /**
     * Base32 encode (RFC 4648)
     */
    base32Encode(buffer) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        let result = '';

        for (const byte of buffer) {
            bits += byte.toString(2).padStart(8, '0');
        }

        for (let i = 0; i < bits.length; i += 5) {
            const chunk = bits.substr(i, 5).padEnd(5, '0');
            result += alphabet[parseInt(chunk, 2)];
        }

        return result;
    }

    /**
     * Base32 decode (RFC 4648)
     */
    base32Decode(base32String) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';

        for (const char of base32String.toUpperCase()) {
            if (char === '=') {break;}
            const index = alphabet.indexOf(char);
            if (index === -1) {continue;}
            bits += index.toString(2).padStart(5, '0');
        }

        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substr(i, 8), 2));
        }

        return Buffer.from(bytes);
    }

    /**
     * Secure string comparison (timing-safe)
     */
    secureCompare(a, b) {
        if (a.length !== b.length) {return false;}
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }

    /**
     * Generate backup codes
     */
    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            codes.push(`${code.substring(0, 4)}-${code.substring(4)}`);
        }
        return codes;
    }

    /**
     * Hash backup code for storage
     */
    hashBackupCode(code) {
        return crypto.createHash('sha256')
            .update(code.replace(/-/g, ''))
            .digest('hex');
    }
}

// Singleton
const mfaService = new MFAService();

module.exports = { mfaService };
