/**
 * SHOULD-B2a (audit batch-2) + SHOULD-#3 (batch-2 adversarial-verify fast-follow)
 * — maskThaiIdsInText must catch FORMATTED national IDs, not just BARE
 * 13-consecutive-digit runs, and must do so CONSISTENTLY with the bare branch.
 *
 * Context: maskThaiIdsInText is the single helper behind 5 platform call sites
 * (audit-logger metadata, entity grant `reason`, and 3 interoperability
 * revokedReason projections on the UNAUTHENTICATED /verify + partner feeds).
 * Before B2a a dashed `1-1000-00000-00-8` or spaced `1 1000 00000 00 8`
 * operator-typed ID passed through UNMASKED and was broadcast in cleartext.
 *
 * SHOULD-#3 (this fast-follow) closes TWO residual leaks the B2a Mod-11 gate on
 * the separated branch still allowed, and makes the "mask FORMATTED IDs" claim
 * ACTUALLY TRUE (before, a formatted-but-Mod-11-INVALID id leaked while the bare
 * branch redacts an invalid id unconditionally — an INCONSISTENCY):
 *   (a) a formatted Mod-11-INVALID id (dashed `1-1017-00230-70-5`) leaked past
 *       the gate even though the BARE form of the same value is redacted.
 *   (b) a genuinely Mod-11-VALID id written with `/`, `,`, en-dash, em-dash,
 *       NBSP, thin-space, or DOUBLED separators leaked because the class only
 *       covered a single ASCII space/dot/hyphen.
 *
 * Design (post-#3):
 *   - BARE 13-consecutive-digit runs keep the PRE-EXISTING UNCONDITIONAL mask.
 *   - A SEPARATED run that normalises to exactly 13 digits is now masked
 *     UNCONDITIONALLY too (the Mod-11 gate is DROPPED) — same as the bare
 *     branch. Over-masking a rare 13-digit formatted non-ID on a redaction path
 *     is fail-safe; phones (10 digits) and dates (8 digits) are never 13-runs,
 *     so there is no real over-mask.
 *   - Separator class broadened to space / dot / hyphen / slash / comma /
 *     en-dash / em-dash / NBSP / thin-space, and REPEATED separators between
 *     digits are allowed — boundary-guarded to still capture exactly 13 digits.
 *
 * Thai-numeral (๐๑๒) IDs are a DOCUMENTED residual — `\d` is ASCII-only and
 * supporting Thai digits would materially complicate the regex + normalisation
 * for a case operators effectively never type. Covered by report, not code.
 */

'use strict';

const {
    maskThaiIdsInText,
    maskThaiId,
} = require('../../utils/field-encryption');
const { isThaiIdMod11Valid } = require('../../utils/thai-id-validator');

// A REAL Mod-11-valid national ID (checked in-suite below).
const VALID_ID = '1100000000008';
const VALID_MASKED = maskThaiId(VALID_ID); // 1-XXXX-XXXX-X-0008
// Dashed (1-4-5-2-1) and spaced formats that NORMALISE to VALID_ID.
const VALID_DASHED = '1-1000-00000-00-8';
const VALID_SPACED = '1 1000 00000 00 8';

// SHOULD-#3 broadened-separator variants that ALSO normalise to VALID_ID.
// Built from the raw digit groups + an explicit separator so the invisible
// separators (NBSP U+00A0, thin-space U+2009) are UNAMBIGUOUS in source.
const GROUPS = ['1', '1000', '00000', '00', '8']; // → 1100000000008
const withSep = (sep) => GROUPS.join(sep);
const VALID_SLASH = withSep('/');
const VALID_COMMA = withSep(',');
const VALID_ENDASH = withSep('–'); // en-dash –
const VALID_EMDASH = withSep('—'); // em-dash —
const VALID_NBSP = withSep(' '); // non-breaking space
const VALID_THIN = withSep(' '); // thin space
const VALID_DOUBLED = withSep('--'); // DOUBLED separators

// A 13-digit run that FAILS Mod-11 (same value interop-trace uses).
const INVALID_ID = '1101700230705';
const INVALID_DASHED = '1-1017-00230-70-5';

const BARE_13 = /(?<!\d)\d{13}(?!\d)/;

describe('[B2a] maskThaiIdsInText — fixtures are what we think they are', () => {
    it('VALID_ID passes Mod-11 and all formatted variants normalise to it', () => {
        expect(isThaiIdMod11Valid(VALID_ID)).toBe(true);
        for (const v of [
            VALID_DASHED, VALID_SPACED, VALID_SLASH, VALID_COMMA,
            VALID_ENDASH, VALID_EMDASH, VALID_NBSP, VALID_THIN, VALID_DOUBLED,
        ]) {
            expect(v.replace(/[^0-9]/g, '')).toBe(VALID_ID);
        }
        expect(VALID_MASKED).toBe('1-XXXX-XXXX-X-0008');
    });
    it('INVALID_ID fails Mod-11', () => {
        expect(isThaiIdMod11Valid(INVALID_ID)).toBe(false);
        expect(INVALID_DASHED.replace(/[^0-9]/g, '')).toBe(INVALID_ID);
    });
});

describe('[B2a] NEW — formatted (dashed/spaced) Mod-11-valid IDs are masked', () => {
    it('masks a DASHED valid ID embedded in prose (was broadcast unmasked)', () => {
        const out = maskThaiIdsInText(`ยกเลิกเพราะ ${VALID_DASHED} ปลอม`);
        expect(out).toContain(VALID_MASKED);
        expect(out).toContain('ยกเลิกเพราะ'); // prose preserved
        expect(out).not.toContain(VALID_DASHED); // original digits gone
        expect(out).not.toContain(VALID_ID);
    });

    it('masks a SPACED valid ID embedded in prose', () => {
        const out = maskThaiIdsInText(`แจ้ง ${VALID_SPACED} ที่ปลอม`);
        expect(out).toContain(VALID_MASKED);
        expect(out).not.toContain(VALID_SPACED);
        expect(out).not.toContain(VALID_ID);
    });

    it('masks a DOT-separated valid ID', () => {
        const out = maskThaiIdsInText('id 1.1000.00000.00.8 x');
        expect(out).toContain(VALID_MASKED);
        expect(out).not.toContain(VALID_ID);
    });
});

describe('[SHOULD-#3] broadened separator class — /, comma, en/em-dash, NBSP, thin-space, doubled', () => {
    it.each([
        ['slash', () => VALID_SLASH],
        ['comma', () => VALID_COMMA],
        ['en-dash', () => VALID_ENDASH],
        ['em-dash', () => VALID_EMDASH],
        ['NBSP', () => VALID_NBSP],
        ['thin-space', () => VALID_THIN],
        ['doubled hyphen', () => VALID_DOUBLED],
    ])('masks a %s-separated Mod-11-valid ID (was leaked)', (_label, get) => {
        const raw = get();
        const out = maskThaiIdsInText(`เหตุผล ${raw} จบ`);
        expect(out).toContain(VALID_MASKED);
        expect(out).not.toContain(raw); // original separated digits gone
        expect(out).not.toContain(VALID_ID);
        expect(out).toContain('เหตุผล'); // prose preserved
    });
});

describe('[SHOULD-#3] Mod-11 gate DROPPED — separated non-Mod-11 IDs are now masked (consistency with bare)', () => {
    it('masks a DASHED Mod-11-INVALID id (was leaked; bare form is redacted)', () => {
        // The BARE form of this exact value is masked unconditionally; the dashed
        // form must be too. This REPLACES the old "NOT masked" precision case.
        const out = maskThaiIdsInText(`อ้างอิง ${INVALID_DASHED} จบ`);
        expect(out).not.toContain(INVALID_DASHED);
        expect(out).not.toContain(INVALID_ID);
        expect(out).not.toMatch(BARE_13);
        expect(out).toContain('อ้างอิง'); // prose preserved
        // masks with the last-4 of the normalised digits.
        expect(out).toContain(maskThaiId(INVALID_ID)); // 1-XXXX-XXXX-X-0705
    });
});

describe('[B2a] REGRESSION — bare runs keep their unconditional mask', () => {
    it('a BARE Mod-11-valid ID is still masked', () => {
        const out = maskThaiIdsInText(`applicant ${VALID_ID} flagged`);
        expect(out).toBe(`applicant ${VALID_MASKED} flagged`);
        expect(out).not.toMatch(BARE_13);
    });

    it('a BARE NON-Mod-11 run is STILL masked (interop-trace preservation)', () => {
        // Gating bare runs on Mod-11 would leak this — bare stays unconditional.
        const out = maskThaiIdsInText(`ปลอมแปลงโดย ${INVALID_ID}`);
        expect(out).not.toContain(INVALID_ID);
        expect(out).not.toMatch(BARE_13);
        expect(out).toContain('ปลอมแปลงโดย');
    });

    it('a bare valid AND a bare invalid in one string are BOTH masked', () => {
        const out = maskThaiIdsInText(`a ${VALID_ID} b ${INVALID_ID} c`);
        expect(out).not.toContain(VALID_ID);
        expect(out).not.toContain(INVALID_ID);
        expect(out).not.toMatch(BARE_13);
    });
});

describe('[SHOULD-#3] no over-mask — non-13-run sequences are left alone (Mod-11 gate not needed)', () => {
    it('a 10-digit phone (bare and dashed) is NOT masked (only 10 digits)', () => {
        expect(maskThaiIdsInText('โทร 0812345678')).toBe('โทร 0812345678');
        expect(maskThaiIdsInText('โทร 081-234-5678')).toBe('โทร 081-234-5678');
    });

    it('an 8-digit ISO date is NOT masked (only 8 digits)', () => {
        expect(maskThaiIdsInText(' วันที่ 2026-07-06')).toBe(' วันที่ 2026-07-06');
    });

    it('a 13-digit run inside a LONGER bare digit run is NOT mangled', () => {
        const text = 'ใบแจ้งหนี้ 12345678901234567890';
        expect(maskThaiIdsInText(text)).toBe(text);
    });
});

describe('[B2a] passthrough — non-string / empty inputs unchanged', () => {
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['empty string', ''],
        ['number', 42],
        ['object', { a: 1 }],
    ])('%s passes through unchanged', (_label, input) => {
        expect(maskThaiIdsInText(input)).toBe(input);
    });
});
