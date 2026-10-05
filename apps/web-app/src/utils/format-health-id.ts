/**
 * Health ID Formatter
 *
 * Formats 13-digit citizen IDs with dashes for display.
 * Used consistently by login, register, and provider login pages.
 *
 * Format: X-XXXX-XXXXX-XX-X
 *
 * NOTE: The identifier IS a 13-digit เลขประจำตัวประชาชน
 *       (Thai national ID). We refer to it internally as
 *       "Health ID" to match MOPH terminology in this domain.
 */

/**
 * Format a raw input string into the Health ID dash pattern (X-XXXX-XXXXX-XX-X).
 * Strips non-digits and caps at 13 characters.
 */
export function formatHealthId(value: string): string {
    const clean = value.replace(/\D/g, '').slice(0, 13);
    if (clean.length <= 1) return clean;
    if (clean.length <= 5) return `${clean.slice(0, 1)}-${clean.slice(1)}`;
    if (clean.length <= 10) return `${clean.slice(0, 1)}-${clean.slice(1, 5)}-${clean.slice(5)}`;
    if (clean.length <= 12) {
        return `${clean.slice(0, 1)}-${clean.slice(1, 5)}-${clean.slice(5, 10)}-${clean.slice(10)}`;
    }
    return `${clean.slice(0, 1)}-${clean.slice(1, 5)}-${clean.slice(5, 10)}-${clean.slice(10, 12)}-${clean.slice(12)}`;
}

/** @deprecated Use formatHealthId instead */
export const formatThaiId = formatHealthId;
