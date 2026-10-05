/**
 * Health ID & Document Validation Utilities
 * 
 * Centralized validation functions for Health IDs and business rules.
 * Unit tested for accuracy (critical for GACP compliance)
 * 
 * NOTE: The system uses "Health ID" internally (MOPH domain naming).
 *       The actual identifier IS a 13-digit เลขประจำตัวประชาชน.
 * 
 * Usage:
 * import { validateHealthId, validateLaserCode } from '@/utils/validation';
 */

// F-G4-10 — the check digit is computed once, platform-wide.
import { isThaiIdChecksumValid } from '@gacp/validation/thai-id-checksum';

// HEALTH ID VALIDATION

/**
 * Validate Health ID (13-digit เลขประจำตัวประชาชน)
 * Uses checksum algorithm per MOI standard
 * 
 * @param id - 13-digit Health ID number
 * @returns Validation result with error message if invalid
 */
export function validateHealthId(id: string): { valid: boolean; error?: string } {
    const cleanId = id.replace(/\D/g, '');

    if (cleanId.length !== 13) {
        return { valid: false, error: 'เลขบัตรประชาชนต้องมี 13 หลัก' };
    }

    // A citizen's card never starts with 0; a leading 0 means a juristic person's
    // 13-digit number, which is a different form on a different screen.
    if (cleanId[0] === '0') {
        return { valid: false, error: 'เลขบัตรประชาชนไม่ถูกต้อง' };
    }

    if (!isThaiIdChecksumValid(cleanId)) {
        return { valid: false, error: 'เลขบัตรประชาชนไม่ถูกต้อง (checksum ไม่ตรง)' };
    }

    return { valid: true };
}
/** @deprecated Use validateHealthId */
export const validateThaiIdCard = validateHealthId;

/**
 * Format Health ID for display (X-XXXX-XXXXX-XX-X)
 */
export function formatHealthIdCard(id: string): string {
    const clean = id.replace(/\D/g, '');
    if (clean.length !== 13) return id;

    return `${clean[0]}-${clean.slice(1, 5)}-${clean.slice(5, 10)}-${clean.slice(10, 12)}-${clean[12]}`;
}
/** @deprecated Use formatHealthIdCard */
export const formatThaiIdCard = formatHealthIdCard;

/**
 * Mask Health ID for privacy (X-XXXX-XXXXX-XX-X → X-XXXX-XXXXX-**-*)
 */
export function maskHealthIdCard(id: string): string {
    const clean = id.replace(/\D/g, '');
    if (clean.length !== 13) return id;

    return `${clean[0]}-${clean.slice(1, 5)}-${clean.slice(5, 10)}-**-*`;
}
/** @deprecated Use maskHealthIdCard */
export const maskThaiIdCard = maskHealthIdCard;

// LASER CODE VALIDATION

/**
 * Validate ID Card Laser Code
 * Format: XX0-XXXXXXX-XX (12 characters with hyphens)
 * 
 * @param laserCode - Laser code from the physical ID card
 * @returns Validation result with error message if invalid
 */
export function validateLaserCode(laserCode: string): { valid: boolean; error?: string } {
    // Remove all non-alphanumeric
    const clean = laserCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    // Must be exactly 12 characters
    if (clean.length !== 12) {
        return { valid: false, error: 'รหัส Laser ต้องมี 12 ตัวอักษร' };
    }

    // Format: 2 letters + 1 digit + 7 digits + 2 digits
    const pattern = /^[A-Z]{2}[0-9]{10}$/;

    if (!pattern.test(clean)) {
        return { valid: false, error: 'รูปแบบรหัส Laser ไม่ถูกต้อง' };
    }

    return { valid: true };
}

/**
 * Format Laser Code for display (XX0-XXXXXXX-XX)
 */
export function formatLaserCode(laserCode: string): string {
    const clean = laserCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (clean.length !== 12) return laserCode;

    return `${clean.slice(0, 3)}-${clean.slice(3, 10)}-${clean.slice(10)}`;
}

// TAX ID VALIDATION

/**
 * Validate Thai Tax ID (13 digits for companies)
 * 
 * @param taxId - 13-digit Tax ID
 * @returns Validation result
 */
export function validateTaxId(taxId: string): { valid: boolean; error?: string } {
    const clean = taxId.replace(/\D/g, '');

    if (clean.length !== 13) {
        return { valid: false, error: 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก' };
    }

    // First digit should be 0 for companies
    if (clean[0] !== '0') {
        return { valid: false, error: 'เลขประจำตัวผู้เสียภาษีนิติบุคคลต้องขึ้นต้นด้วย 0' };
    }

    return { valid: true };
}

// PHONE NUMBER VALIDATION

/**
 * Validate Thai Phone Number
 * Accepts formats: 0XXXXXXXXX, 66XXXXXXXXX, +66XXXXXXXXX
 * 
 * @param phone - Phone number
 * @returns Validation result
 */
export function validateThaiPhone(phone: string): { valid: boolean; error?: string } {
    // Remove all non-digits except +
    let clean = phone.replace(/[^\d+]/g, '');

    // Convert international format to local
    if (clean.startsWith('+66')) {
        clean = '0' + clean.slice(3);
    } else if (clean.startsWith('66')) {
        clean = '0' + clean.slice(2);
    }

    // Must be 10 digits starting with 0
    if (!/^0[0-9]{9}$/.test(clean)) {
        return { valid: false, error: 'หมายเลขโทรศัพท์ไม่ถูกต้อง' };
    }

    // Check valid prefixes (mobile: 06, 08, 09 | landline: 02, 03, 04, 05, 07)
    const validPrefixes = ['02', '03', '04', '05', '06', '07', '08', '09'];
    const prefix = clean.slice(0, 2);

    if (!validPrefixes.includes(prefix)) {
        return { valid: false, error: 'หมายเลขโทรศัพท์ไม่ถูกต้อง' };
    }

    return { valid: true };
}

/**
 * Format Thai phone for display
 */
export function formatThaiPhone(phone: string): string {
    const clean = phone.replace(/[^\d]/g, '');

    // Mobile: 0XX-XXX-XXXX
    if (clean.length === 10 && /^0[6-9]/.test(clean)) {
        return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    }

    // Landline: 0X-XXX-XXXX
    if (clean.length === 9 && /^0[2-5]/.test(clean)) {
        return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5)}`;
    }

    return phone;
}

// EMAIL VALIDATION

/**
 * Validate email address
 * Uses RFC 5322 compliant regex
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!pattern.test(email)) {
        return { valid: false, error: 'รูปแบบอีเมลไม่ถูกต้อง' };
    }

    return { valid: true };
}

// PASSWORD VALIDATION

/**
 * Validate password strength (GACP Thai security requirements)
 * 
 * ALIGNED with backend shared/zod-schemas.js passwordSchema
 * and backend shared/validation.js isStrongPassword
 * 
 * Required:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * 
 * Optional (improves strength):
 * - Special character (not required for validity)
 */
export function validatePassword(password: string): {
    valid: boolean;
    error?: string;
    strength: 'weak' | 'medium' | 'strong';
    requirements: {
        minLength: boolean;
        hasUppercase: boolean;
        hasLowercase: boolean;
        hasNumber: boolean;
        hasSpecial: boolean;
    };
} {
    const requirements = {
        minLength: password.length >= 8,
        hasUppercase: /[A-Z]/.test(password),
        hasLowercase: /[a-z]/.test(password),
        hasNumber: /[0-9]/.test(password),
        hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };

    // Core requirements (special char is optional)
    const coreRequirements = {
        minLength: requirements.minLength,
        hasUppercase: requirements.hasUppercase,
        hasLowercase: requirements.hasLowercase,
        hasNumber: requirements.hasNumber,
    };

    const corePassedCount = Object.values(coreRequirements).filter(Boolean).length;
    const hasSpecial = requirements.hasSpecial;

    let strength: 'weak' | 'medium' | 'strong' = 'weak';
    if (corePassedCount === 4 && hasSpecial) strength = 'strong';
    else if (corePassedCount >= 4) strength = 'strong';
    else if (corePassedCount >= 3) strength = 'medium';

    const allCorePassed = Object.values(coreRequirements).every(Boolean);

    if (!allCorePassed) {
        const errors: string[] = [];
        if (!requirements.minLength) errors.push('อย่างน้อย 8 ตัวอักษร');
        if (!requirements.hasUppercase) errors.push('มีตัวพิมพ์ใหญ่');
        if (!requirements.hasLowercase) errors.push('มีตัวพิมพ์เล็ก');
        if (!requirements.hasNumber) errors.push('มีตัวเลข');

        return {
            valid: false,
            error: `รหัสผ่านต้อง: ${errors.join(', ')}`,
            strength,
            requirements,
        };
    }

    return { valid: true, strength, requirements };
}

// GENERAL UTILITIES

/**
 * Check if a string is empty or only whitespace
 */
export function isEmpty(value: string | null | undefined): boolean {
    return !value || value.trim().length === 0;
}

/**
 * Escape HTML-significant characters for DISPLAY.
 *
 * Named sanitizeInput until 2026-09-08, which is the wrong end of the pipe: the
 * name invites calling it on data on its way IN, and a value stored as
 * "&lt;b&gt;" is corrupt — it renders as literal &lt;b&gt; on the next screen and
 * double-escapes on the one after. The backend made exactly that mistake (see
 * apps/backend/middleware/sanitize-input.js): live since 2026-03-19, it ate
 * ordinary Thai text for five months. Escape at the moment of rendering, never at the moment of receiving.
 *
 * React escapes by default, so this is only needed when building a string that
 * will bypass it — a dangerouslySetInnerHTML payload or a document template.
 */
export function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

const validationUtils = {
    validateHealthId,
    validateThaiIdCard, // @deprecated alias
    formatHealthIdCard,
    formatThaiIdCard,   // @deprecated alias
    maskHealthIdCard,
    maskThaiIdCard,     // @deprecated alias
    validateLaserCode,
    formatLaserCode,
    validateTaxId,
    validateThaiPhone,
    formatThaiPhone,
    validateEmail,
    validatePassword,
    isEmpty,
    escapeHtml,
};

export default validationUtils;
