/**
 * Thai Baht Text Converter (จำนวนเงิน → ตัวอักษรภาษาไทย)
 *
 * Converts a number to Thai baht text representation.
 * Examples:
 *   5000  → "ห้าพันบาทถ้วน"
 *   25000 → "สองหมื่นห้าพันบาทถ้วน"
 *   30000 → "สามหมื่นบาทถ้วน"
 *   1234.50 → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์"
 */

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

/**
 * Convert a group of up to 6 digits to Thai text
 */
function groupToThaiText(n: number): string {
    if (n === 0) return '';

    const str = String(Math.floor(n));
    const len = str.length;
    let result = '';

    for (let i = 0; i < len; i++) {
        const digit = Number(str[i]);
        const position = len - i - 1;

        if (digit === 0) continue;

        // Special case: เอ็ด for 1 in units position (except standalone 1)
        if (digit === 1 && position === 0 && len > 1) {
            result += 'เอ็ด';
            continue;
        }

        // Special case: ยี่ for 2 in tens position
        if (digit === 2 && position === 1) {
            result += 'ยี่สิบ';
            continue;
        }

        // Special case: สิบ for 1 in tens position (no "หนึ่ง" prefix)
        if (digit === 1 && position === 1) {
            result += 'สิบ';
            continue;
        }

        result += (THAI_DIGITS[digit] ?? '') + (THAI_POSITIONS[position] ?? '');
    }

    return result;
}

/**
 * Convert a number to Thai baht text
 *
 * @param amount - The amount in baht (supports up to 2 decimal places for satang)
 * @returns Thai text representation with บาท/สตางค์ suffix
 *
 * @example
 * numberToThaiText(5000)    // "ห้าพันบาทถ้วน"
 * numberToThaiText(30000)   // "สามหมื่นบาทถ้วน"
 * numberToThaiText(1234.50) // "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์"
 */
export function numberToThaiText(amount: number): string {
    if (!Number.isFinite(amount) || amount < 0) {
        return 'ศูนย์บาทถ้วน';
    }

    if (amount === 0) {
        return 'ศูนย์บาทถ้วน';
    }

    // Split into baht and satang
    const bahtPart = Math.floor(amount);
    const satangPart = Math.round((amount - bahtPart) * 100);

    let result = '';

    // Handle baht: split into groups of 6 for ล้าน
    if (bahtPart === 0) {
        // No baht part
    } else if (bahtPart >= 1_000_000) {
        const millions = Math.floor(bahtPart / 1_000_000);
        const remainder = bahtPart % 1_000_000;
        result += groupToThaiText(millions) + 'ล้าน';
        if (remainder > 0) {
            result += groupToThaiText(remainder);
        }
    } else {
        result += groupToThaiText(bahtPart);
    }

    // Add baht suffix
    if (bahtPart > 0) {
        result += 'บาท';
    }

    // Handle satang
    if (satangPart === 0) {
        result += 'ถ้วน';
    } else {
        result += groupToThaiText(satangPart) + 'สตางค์';
    }

    return result;
}

export default numberToThaiText;
