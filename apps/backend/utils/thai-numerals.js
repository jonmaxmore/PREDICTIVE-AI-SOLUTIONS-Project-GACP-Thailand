/**
 * Thai Numeral Utilities (B16-D, 2026-05-16)
 *
 * Single source of truth for Arabic ↔ Thai-digit transliteration used by
 * receipt / invoice PDF templates. The helpers are pure, allocation-free,
 * and safe to call on any string — non-digit characters pass through
 * unchanged, so receipt numbers like `RCP-DTAM-2569-000001` become
 * `RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑` without disturbing the prefix.
 *
 * Why this lives in `utils/` rather than the receipt-numbering service:
 *   - The same digit-mapping is used outside the receipt pipeline
 *     (certificate templates, audit reports, signed PDFs) and we don't
 *     want each consumer to re-implement the substitution loop.
 *   - The function is intentionally tiny so it can be inlined into hot
 *     PDF render paths without pulling in the rest of the receipt module.
 *
 * Unicode reference:
 *   Thai digits live at U+0E50 (๐) through U+0E59 (๙) — a contiguous block
 *   that maps 1-to-1 onto Arabic '0'..'9'. We use a 10-entry lookup array
 *   rather than `String.fromCharCode(0x0E50 + (c - 48))` so the code reads
 *   the same way the spec does (and so future translators can see the
 *   Thai glyph next to its Arabic counterpart at review time).
 *
 * @module utils/thai-numerals
 */

'use strict';

const { getZonedParts } = require('./working-days');

// ── Static lookup tables ────────────────────────────────────────────────────
//
// Frozen object so callers can `import { ARABIC_TO_THAI }` without risk of
// accidental mutation in a long-running process. The reverse table allows
// round-tripping (Thai-numeral DOC numbers from external sources back to
// Arabic before they hit the database — see `thaiToArabic`).

const ARABIC_TO_THAI = Object.freeze({
    '0': '๐',
    '1': '๑',
    '2': '๒',
    '3': '๓',
    '4': '๔',
    '5': '๕',
    '6': '๖',
    '7': '๗',
    '8': '๘',
    '9': '๙',
});

const THAI_TO_ARABIC = Object.freeze({
    '๐': '0',
    '๑': '1',
    '๒': '2',
    '๓': '3',
    '๔': '4',
    '๕': '5',
    '๖': '6',
    '๗': '7',
    '๘': '8',
    '๙': '9',
});

// ── Public helpers ──────────────────────────────────────────────────────────

/**
 * Convert every ASCII digit in `input` to its Thai numeral equivalent.
 * Non-digit characters pass through unchanged. `null` / `undefined` are
 * normalised to the empty string (so template substitution is safe).
 *
 * @example
 *   arabicToThai('0123456789')       // → '๐๑๒๓๔๕๖๗๘๙'
 *   arabicToThai('Total: 1,535.00')  // → 'Total: ๑,๕๓๕.๐๐'
 *   arabicToThai('RCP-DTAM-2569-1')  // → 'RCP-DTAM-๒๕๖๙-๑'
 *   arabicToThai(2569)               // → '๒๕๖๙'
 *   arabicToThai(null)               // → ''
 *
 * @param {string|number|null|undefined} input
 * @returns {string}
 */
function arabicToThai(input) {
    if (input === null || input === undefined) { return ''; }
    return String(input).replace(/[0-9]/g, (d) => ARABIC_TO_THAI[d]);
}

/**
 * Reverse of `arabicToThai` — convert Thai digits to ASCII digits. Used by
 * data-ingest paths that accept user-typed Thai numerals (e.g. a finance
 * officer typing "๑๒๓" into a search box) and need to normalise before a
 * DB lookup.
 *
 * @example
 *   thaiToArabic('๒๕๖๙')             // → '2569'
 *   thaiToArabic('123')              // → '123'    (passthrough)
 *   thaiToArabic('๑,๕๓๕.๐๐')         // → '1,535.00'
 *
 * @param {string|null|undefined} input
 * @returns {string}
 */
function thaiToArabic(input) {
    if (input === null || input === undefined) { return ''; }
    return String(input).replace(/[๐-๙]/g, (d) => THAI_TO_ARABIC[d]);
}

/**
 * Format an amount with thousand-separators in Thai numerals. The cents
 * are always rendered to 2 decimal places per Thai accounting convention.
 *
 * @example
 *   formatThaiCurrency(1535)         // → '๑,๕๓๕.๐๐'
 *   formatThaiCurrency(1535.5)       // → '๑,๕๓๕.๕๐'
 *   formatThaiCurrency(0)            // → '๐.๐๐'
 *   formatThaiCurrency('1,535.00')   // → '๑,๕๓๕.๐๐'  (re-formatted)
 *
 * Behaviour notes:
 *   - Non-finite inputs (NaN, ±Infinity) fall back to '๐.๐๐' so a malformed
 *     invoice row doesn't crash the renderer.
 *   - Negative amounts keep the minus sign (rendered as ASCII '-').
 *
 * @param {string|number} amount
 * @returns {string}
 */
function formatThaiCurrency(amount) {
    let num = typeof amount === 'number' ? amount : Number(String(amount).replace(/,/g, ''));
    if (!Number.isFinite(num)) { num = 0; }
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    // Two-decimal fixed; insert comma thousand-separators on the integer half.
    const arabic = abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + arabicToThai(arabic);
}

/**
 * Format a 13-digit Thai tax ID / national ID in the canonical display form
 * `๓-๔๕๖๗-๘๙๐๑๒-๓๔-๕` (1-4-5-2-1 grouping — X-XXXX-XXXXX-XX-X — per the
 * Revenue Department's published display convention for both the
 * เลขประจำตัวประชาชน and the เลขประจำตัวผู้เสียภาษีอากร, which share one
 * 13-digit format). Fix round 4 (2026-09-27 review): an EARLIER version of
 * this function used a 1-1-4-4-1 grouping that silently DROPPED two digits
 * (positions 11 and 12) — it read the first 10 digits plus the check digit
 * only. That was never caught because on `main` `PAYER_TAX_ID_TH` (the one
 * caller) always printed '-' (see invoice-tax-id fix round); this branch is
 * what first prints a real value through it. All 13 digits of the input
 * must appear, in order, in the output — see the single-source test in
 * `__tests__/unit/thai-numerals.test.js`.
 *
 * Input may be already-grouped (with hyphens or spaces), pure digits, or
 * Thai numerals — the function strips separators, validates 13 digits, and
 * re-groups in the canonical pattern.
 *
 * Returns the input string unchanged when validation fails so the renderer
 * can still surface "looks wrong" data to a human reviewer rather than
 * silently dropping the field.
 *
 * @example
 *   formatThaiTaxId('3456789012345')   // → '๓-๔๕๖๗-๘๙๐๑๒-๓๔-๕'
 *   formatThaiTaxId('3-4567-89012-34-5') // → '๓-๔๕๖๗-๘๙๐๑๒-๓๔-๕'
 *
 * @param {string} taxId
 * @returns {string}
 */
function formatThaiTaxId(taxId) {
    if (taxId === null || taxId === undefined) { return ''; }
    const normalized = thaiToArabic(String(taxId)).replace(/[^0-9]/g, '');
    if (normalized.length !== 13) { return String(taxId); }  // surface as-is on shape mismatch
    const grouped = `${normalized[0]}-${normalized.slice(1, 5)}-${normalized.slice(5, 10)}-${normalized.slice(10, 12)}-${normalized[12]}`;
    return arabicToThai(grouped);
}

/**
 * Format a Date as the canonical Thai-script date with พุทธศักราช spelling
 * and Buddhist Era year — every digit in Thai numerals.
 *
 *   formatThaiDate(new Date('2026-05-16'))
 *     → '๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙'
 *
 * Used by DTAM revenue receipts and any signed-PDF audit field that the
 * Comptroller General's Department audits. The full-month + full-era form is
 * the convention published in the DTAM finance manual; the compact form
 * ("๑๖ พ.ค. ๒๕๖๙") is reserved for headers where vertical space is tight.
 *
 * Null / invalid dates resolve to the literal '-' so the renderer surfaces a
 * harmless placeholder rather than crashing on a malformed Invoice row.
 *
 * @param {Date|string|null|undefined} date
 * @returns {string}
 */
function formatThaiDate(date) {
    if (date === null || date === undefined) { return '-'; }
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) { return '-'; }
    // Inlined to avoid a runtime require() cycle with utils/thai-format.js —
    // that module imports only utils/working-days, so the constant is stable.
    const THAI_MONTHS_FULL = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
    ];
    // The Bangkok day, not the process clock's (the containers run on UTC).
    const parts = getZonedParts(d);
    const day = arabicToThai(parts.day);
    const month = THAI_MONTHS_FULL[parts.month - 1];
    const year = arabicToThai(parts.year + 543);
    return `${day} ${month} พุทธศักราช ${year}`;
}

module.exports = {
    ARABIC_TO_THAI,
    THAI_TO_ARABIC,
    arabicToThai,
    thaiToArabic,
    formatThaiCurrency,
    formatThaiDate,
    formatThaiTaxId,
};
