/**
 * Thai Number to Text Converter
 *
 * Converts any positive number (including satang) to formal Thai text
 * suitable for legal/financial documents (invoices, receipts, certificates).
 *
 * Examples:
 *   5535   → "ห้าพันห้าร้อยสามสิบห้าบาทถ้วน"
 *   27675  → "สองหมื่นเจ็ดพันหกร้อยเจ็ดสิบห้าบาทถ้วน"
 *   0      → "ศูนย์บาทถ้วน"
 *   100.50 → "หนึ่งร้อยบาทห้าสิบสตางค์"
 *
 * Rules (Royal Institute of Thailand):
 *   - 1 in ones place → "เอ็ด" (except when alone → "หนึ่ง")
 *   - 2 in tens place → "ยี่สิบ" (not "สองสิบ")
 *   - 1 in tens place → "สิบ" (not "หนึ่งสิบ")
 *
 * @module utils/number-to-thai-text
 */

const THAI_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

/**
 * Convert a group of up to 6 digits to Thai text.
 * @param {number} n — integer 0–999999
 * @returns {string}
 */
function groupToThai(n) {
    if (n === 0) { return ''; }

    const digits = String(n).split('').map(Number);
    const len = digits.length;
    let result = '';

    for (let i = 0; i < len; i++) {
        const digit = digits[i];
        const unitIndex = len - 1 - i;

        if (digit === 0) { continue; }

        // Special: tens place
        if (unitIndex === 1) {
            if (digit === 1) {
                result += 'สิบ';
            } else if (digit === 2) {
                result += 'ยี่สิบ';
            } else {
                result += THAI_DIGITS[digit] + 'สิบ';
            }
            continue;
        }

        // Special: ones place
        if (unitIndex === 0) {
            if (len > 1 && digit === 1) {
                result += 'เอ็ด';
            } else {
                result += THAI_DIGITS[digit];
            }
            continue;
        }

        // Normal: ร้อย, พัน, หมื่น, แสน
        result += THAI_DIGITS[digit] + THAI_UNITS[unitIndex];
    }

    return result;
}

/**
 * Convert a number to formal Thai currency text (บาท/สตางค์).
 *
 * @param {number} amount — positive number (supports decimals for satang)
 * @returns {string} Thai text, e.g. "ห้าพันห้าร้อยสามสิบห้าบาทถ้วน"
 */
function numberToThaiText(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        return 'ศูนย์บาทถ้วน';
    }

    const absAmount = Math.abs(amount);
    if (absAmount === 0) { return 'ศูนย์บาทถ้วน'; }

    const baht = Math.floor(absAmount);
    const satang = Math.round((absAmount - baht) * 100);

    let result = '';

    // Handle millions+ by splitting into groups of 6
    if (baht > 0) {
        if (baht >= 1000000) {
            const millions = Math.floor(baht / 1000000);
            const remainder = baht % 1000000;
            result = groupToThai(millions) + 'ล้าน' + groupToThai(remainder);
        } else {
            result = groupToThai(baht);
        }
        result += 'บาท';
    }

    if (satang > 0) {
        result += groupToThai(satang) + 'สตางค์';
    } else {
        result += 'ถ้วน';
    }

    if (amount < 0) {
        result = 'ลบ' + result;
    }

    return result;
}

module.exports = { numberToThaiText };
