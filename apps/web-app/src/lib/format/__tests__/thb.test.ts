/**
 * thb.test.ts — X4-FIX-B (H-5) regression.
 *
 * Pins the canonical Thai-baht formatter contract that the 3 divergent
 * formatters (`formatTHB` 2dp suffix / `Intl.NumberFormat` 0dp prefix
 * / `toLocaleString() + " ฿"`) will migrate to.
 *
 * Defaults: 2 decimals + suffix `฿` (matches the existing receipt
 * convention used by the 9 finance-chrome files, the most common
 * shape in the codebase).
 */

import { describe, expect, it } from '@jest/globals';

import { formatTHB, formatTHBShort } from '../thb';

describe('[X4-FIX-B H-5] formatTHB — canonical Thai-baht formatter', () => {
    describe('defaults: 2 decimals + suffix ฿', () => {
        it('formats 0 as "0.00 ฿"', () => {
            expect(formatTHB(0)).toBe('0.00 ฿');
        });

        it('formats 0.5 as "0.50 ฿"', () => {
            expect(formatTHB(0.5)).toBe('0.50 ฿');
        });

        it('formats 1000 with thousand separator: "1,000.00 ฿"', () => {
            expect(formatTHB(1000)).toBe('1,000.00 ฿');
        });

        it('rounds 12345.678 to 2dp: "12,345.68 ฿"', () => {
            expect(formatTHB(12345.678)).toBe('12,345.68 ฿');
        });

        it('handles large amounts: 1234567.89 → "1,234,567.89 ฿"', () => {
            expect(formatTHB(1234567.89)).toBe('1,234,567.89 ฿');
        });
    });

    describe('prefix variant', () => {
        it('formats 1234.56 with prefix: "฿1,234.56"', () => {
            expect(formatTHB(1234.56, { prefix: true })).toBe('฿1,234.56');
        });
    });

    describe('0-decimal variant', () => {
        it('formats 1234.56 with 0 decimals: "1,235 ฿" (rounded)', () => {
            expect(formatTHB(1234.56, { decimals: 0 })).toBe('1,235 ฿');
        });

        it('combines 0 decimals + prefix: "฿1,235"', () => {
            expect(formatTHB(1234.56, { decimals: 0, prefix: true })).toBe('฿1,235');
        });
    });

    describe('defensive coercion', () => {
        it('coerces null → 0', () => {
            expect(formatTHB(null)).toBe('0.00 ฿');
        });

        it('coerces undefined → 0', () => {
            expect(formatTHB(undefined)).toBe('0.00 ฿');
        });

        it('coerces NaN → 0 (mirrors accounting-service Number.isFinite guard)', () => {
            expect(formatTHB(Number.NaN)).toBe('0.00 ฿');
        });

        it('coerces Infinity → 0', () => {
            expect(formatTHB(Number.POSITIVE_INFINITY)).toBe('0.00 ฿');
        });

        it('parses numeric strings', () => {
            expect(formatTHB('1234.5')).toBe('1,234.50 ฿');
        });

        it('coerces non-numeric strings → 0', () => {
            expect(formatTHB('not-a-number')).toBe('0.00 ฿');
        });
    });

    describe('formatTHBShort — 0dp + prefix shortcut', () => {
        it('returns prefix ฿ + 0 decimal places', () => {
            expect(formatTHBShort(12345.67)).toBe('฿12,346');
        });

        it('formats 0 as "฿0"', () => {
            expect(formatTHBShort(0)).toBe('฿0');
        });
    });
});
