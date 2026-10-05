/**
 * Tests for utils/thai-numerals (B16-D, 2026-05-16).
 *
 * Covers:
 *   - arabicToThai: every digit, mixed strings, null/undefined, number input,
 *     padded zeros (receipt-number context).
 *   - thaiToArabic: round-trip, passthrough of ASCII digits, mixed input.
 *   - formatThaiCurrency: integers, fractional, negatives, NaN guard.
 *   - formatThaiDate: full Thai-script + พุทธศักราช + BE year + Thai digits.
 *   - formatThaiTaxId: canonical 1-4-5-2-1 grouping, malformed input.
 *
 * Implementation notes referenced in the spec:
 *   - U+0E50..U+0E59 are ๐..๙ (digit block).
 *   - Tax-ID grouping is 1-4-5-2-1 (X-XXXX-XXXXX-XX-X) per the Revenue
 *     Department's display convention — fix round 4 (2026-09-27 review):
 *     an earlier 1-1-4-4-1 grouping silently dropped two digits (positions
 *     11-12). See utils/thai-numerals.js formatThaiTaxId for the history.
 */

'use strict';

const {
    arabicToThai,
    thaiToArabic,
    formatThaiCurrency,
    formatThaiDate,
    formatThaiTaxId,
} = require('../../utils/thai-numerals');

describe('[B16-D] thai-numerals — arabicToThai', () => {
    it('converts the full digit alphabet', () => {
        expect(arabicToThai('0123456789')).toBe('๐๑๒๓๔๕๖๗๘๙');
    });

    it('preserves non-digit characters in a receipt number', () => {
        expect(arabicToThai('RCP-DTAM-2569-000001')).toBe('RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑');
    });

    it('accepts a numeric argument', () => {
        expect(arabicToThai(2569)).toBe('๒๕๖๙');
        expect(arabicToThai(0)).toBe('๐');
    });

    it('handles null / undefined safely (empty string)', () => {
        expect(arabicToThai(null)).toBe('');
        expect(arabicToThai(undefined)).toBe('');
    });

    it('preserves padding (leading zeros)', () => {
        expect(arabicToThai('00042')).toBe('๐๐๐๔๒');
    });
});

describe('[B16-D] thai-numerals — thaiToArabic', () => {
    it('round-trips arabicToThai output', () => {
        const original = '2569-000001';
        expect(thaiToArabic(arabicToThai(original))).toBe(original);
    });

    it('passes ASCII digits through unchanged', () => {
        expect(thaiToArabic('hello 123')).toBe('hello 123');
    });

    it('handles null / undefined', () => {
        expect(thaiToArabic(null)).toBe('');
        expect(thaiToArabic(undefined)).toBe('');
    });
});

describe('[B16-D] thai-numerals — formatThaiCurrency', () => {
    it('formats integers with thousand-separators + 2 decimal places', () => {
        expect(formatThaiCurrency(33210)).toBe('๓๓,๒๑๐.๐๐');
        expect(formatThaiCurrency(1535)).toBe('๑,๕๓๕.๐๐');
    });

    it('formats fractions with 2-decimal padding', () => {
        expect(formatThaiCurrency(1535.5)).toBe('๑,๕๓๕.๕๐');
        expect(formatThaiCurrency(0)).toBe('๐.๐๐');
    });

    it('re-parses a pre-formatted string with commas', () => {
        expect(formatThaiCurrency('1,535.00')).toBe('๑,๕๓๕.๐๐');
    });

    it('falls back to ๐.๐๐ on NaN / Infinity', () => {
        expect(formatThaiCurrency('not a number')).toBe('๐.๐๐');
        expect(formatThaiCurrency(NaN)).toBe('๐.๐๐');
        expect(formatThaiCurrency(Infinity)).toBe('๐.๐๐');
    });

    it('preserves minus sign on negatives', () => {
        expect(formatThaiCurrency(-50)).toBe('-๕๐.๐๐');
    });
});

describe('[B16-D] thai-numerals — formatThaiDate', () => {
    it('renders full พุทธศักราช date with Thai numerals', () => {
        // 16 May 2026 CE → 16 พฤษภาคม BE 2569 → '๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙'
        // Use UTC to make month indexing deterministic across CI timezones.
        // Pinning the LOCAL date (constructor with explicit fields) avoids the
        // off-by-one when the test runner sits in a UTC+X timezone.
        const d = new Date(2026, 4, 16);  // May = month index 4
        expect(formatThaiDate(d)).toBe('๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙');
    });

    it('handles every month index without crashing', () => {
        for (let m = 0; m < 12; m += 1) {
            const result = formatThaiDate(new Date(2026, m, 1));
            // sanity: starts with '๑ ' or '๑๐ ' depending on the day; we just
            // assert the BE year ends correctly.
            expect(result).toMatch(/พุทธศักราช ๒๕๖๙$/);
        }
    });

    it('returns "-" on null / invalid input', () => {
        expect(formatThaiDate(null)).toBe('-');
        expect(formatThaiDate(undefined)).toBe('-');
        expect(formatThaiDate('not a date')).toBe('-');
    });
});

describe('[B16-D] thai-numerals — formatThaiTaxId', () => {
    it('formats a 13-digit Tax ID in canonical 1-4-5-2-1 grouping (X-XXXX-XXXXX-XX-X)', () => {
        expect(formatThaiTaxId('0105568045932'))
            .toBe('๐-๑๐๕๕-๖๘๐๔๕-๙๓-๒');
    });

    it('normalises already-grouped 13-digit input before re-grouping', () => {
        // Same 13 digits as the previous test, with spaces / dashes injected —
        // the helper strips separators and re-applies the canonical grouping.
        expect(formatThaiTaxId('0 105 5680 4593 2'))
            .toBe('๐-๑๐๕๕-๖๘๐๔๕-๙๓-๒');
    });

    // Fix round 4 (2026-09-27 review) — RED-first regression for the
    // dropped-digits bug: a PRIOR 1-1-4-4-1 grouping read only the first 10
    // digits plus the check digit, silently dropping positions 11-12
    // (`0105561234560` → `๐-๑-๐๕๕๖-๑๒๓๔-๐`, an 11-digit result). Asserted
    // against the LITERAL expected string (not `formatThaiTaxId(...)`
    // compared to itself, which would be circular and pass on any grouping)
    // — this is the exact input/output pair the coordinator specified.
    it('drops NO digit — every one of the 13 input digits appears, in order, in the output (regression, 2026-09-27)', () => {
        const input = '0105561234560';
        const result = formatThaiTaxId(input);
        expect(result).toBe(arabicToThai('0-1055-61234-56-0'));
        const digitsOnly = thaiToArabic(result).replace(/[^0-9]/g, '');
        expect(digitsOnly).toBe(input);
    });

    it('returns input unchanged when shape is wrong (surfaces error to QA)', () => {
        expect(formatThaiTaxId('123')).toBe('123');
        expect(formatThaiTaxId('')).toBe('');
    });

    it('handles null / undefined gracefully', () => {
        expect(formatThaiTaxId(null)).toBe('');
        expect(formatThaiTaxId(undefined)).toBe('');
    });
});
