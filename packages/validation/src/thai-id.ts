/**
 * Thai National ID Validator — the TypeScript-facing shape of the rules.
 *
 * Used by: web-app (Next.js). The backend reaches the same rules through
 * `./thai-id-checksum.js` directly.
 *
 * The checksum arithmetic is deliberately NOT in this file. It lives in
 * `./thai-id-checksum.js`, which is CommonJS so that the backend — plain Node,
 * no compile step — can require the very same function. A `.ts` module is
 * invisible to that half of the platform, which is exactly how this repo ended
 * up with seven copies of one national standard (ledger F-G4-10). This module is
 * the presentation layer over the shared rule: formatting, id-type inference,
 * and the per-account-type dispatch. It must never grow its own copy of the loop.
 */

import { isThaiIdChecksumValid, normalizeThaiId, THAI_ID_LENGTH } from './thai-id-checksum';

export interface ThaiIdValidationResult {
    isValid: boolean;
    formatted: string;
    error?: string;
    idType?: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE';
}

/**
 * Validates a Thai 13-digit national ID (or the 13-digit juristic/tax number,
 * which carries the same check digit).
 */
export function validateThaiId(id: string): ThaiIdValidationResult {
    const cleanId = normalizeThaiId(id).replace(/\D/g, '');

    if (cleanId.length !== THAI_ID_LENGTH) {
        return {
            isValid: false,
            formatted: id,
            error: 'เลขประจำตัวต้องมี 13 หลัก',
        };
    }

    if (!isThaiIdChecksumValid(cleanId)) {
        return {
            isValid: false,
            formatted: formatThaiId(cleanId),
            error: 'เลขประจำตัวไม่ถูกต้อง (ผลรวมตรวจสอบไม่ตรง)',
        };
    }

    const firstDigit = cleanId[0];
    let idType: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE' = 'INDIVIDUAL';

    if (firstDigit === '0') {
        idType = 'JURISTIC';
    }

    return {
        isValid: true,
        formatted: formatThaiId(cleanId),
        idType,
    };
}

/**
 * Format Thai ID: X-XXXX-XXXXX-XX-X
 */
export function formatThaiId(id: string): string {
    const clean = id.replace(/\D/g, '');
    if (clean.length !== THAI_ID_LENGTH) return id;
    return `${clean[0]}-${clean.slice(1, 5)}-${clean.slice(5, 10)}-${clean.slice(10, 12)}-${clean[12]}`;
}

/**
 * Validates Juristic Person ID (starts with 0)
 */
export function validateJuristicId(id: string): ThaiIdValidationResult {
    const result = validateThaiId(id);

    if (result.isValid) {
        const clean = id.replace(/\D/g, '');
        if (clean[0] !== '0') {
            return {
                isValid: false,
                formatted: result.formatted,
                error: 'เลขทะเบียนนิติบุคคลต้องขึ้นต้นด้วย 0',
            };
        }
        result.idType = 'JURISTIC';
    }

    return result;
}

/**
 * Validates Community Enterprise ID (XXXX-XXXX-XXX).
 *
 * NO checksum, on purpose: DOAE's 11-digit วิสาหกิจชุมชน registration number has
 * never had a published check digit, so there is nothing to verify beyond shape.
 * Running the national-ID checksum over it would reject every legitimate
 * community enterprise in the country.
 */
export function validateCommunityEnterpriseId(id: string): ThaiIdValidationResult {
    const clean = id.replace(/\D/g, '');

    if (clean.length < 11 || clean.length > 13) {
        return {
            isValid: false,
            formatted: id,
            error: 'เลขทะเบียนวิสาหกิจชุมชนไม่ถูกต้อง',
        };
    }

    const formatted = clean.length >= 11
        ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}`
        : id;

    return {
        isValid: true,
        formatted,
        idType: 'COMMUNITY_ENTERPRISE',
    };
}

/**
 * Unified ID validator based on account type
 */
export function validateIdByType(
    id: string,
    accountType: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE'
): ThaiIdValidationResult {
    switch (accountType) {
        case 'INDIVIDUAL':
            return validateThaiId(id);
        case 'JURISTIC':
            return validateJuristicId(id);
        case 'COMMUNITY_ENTERPRISE':
            return validateCommunityEnterpriseId(id);
        default:
            return validateThaiId(id);
    }
}
