/**
 * Thai stacks a vowel above a consonant and a tone mark above that, plus a
 * descender below. Two CSS habits borrowed from Latin typography break it, and
 * this repo's own rule says so at globals.css:12 —
 * "Never apply positive letter-spacing to Thai text (breaks sara/วรรณยุกต์)".
 *
 * Both habits were live until 2026-09-07. Measured on the login hero at 2.85rem:
 * each line's ink band is 72px inside a 51.07px line box (line-height 1.12), so
 * the two lines of "มาตรฐานสมุนไพร / ไทยสู่สากล" overlapped by 21px and line 2's
 * mai-ek rendered under line 1's descenders — the mark read as belonging to the
 * line above. letter-spacing was -0.02em on top of that.
 *
 * These stylesheets carry only Thai-bearing UI, so the rule is absolute here:
 * letter-spacing is `normal`, and any line-height on a heading-sized rule leaves
 * room for the mark stack.
 */
import fs from 'node:fs';
import path from 'node:path';

const STYLES = path.join(__dirname, '..');
const THAI_BEARING = ['globals-components-auth.css', 'provider-styles.css'];

/** Thai needs roughly 1.35x the em to clear the vowel+tone stack and the descender. */
const MIN_HEADING_LINE_HEIGHT = 1.35;
/** Rules at or above this font-size are headings for our purposes. */
const HEADING_REM = 1.5;

type Rule = { selector: string; body: string; file: string };

function rules(file: string): Rule[] {
    const css = fs.readFileSync(path.join(STYLES, file), 'utf8');
    const out: Rule[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], file });
    }
    return out;
}

const ALL = THAI_BEARING.flatMap(rules);

describe('letter-spacing on Thai UI', () => {
    it('is never a length — not negative, not positive', () => {
        const offenders = ALL
            .map((r) => {
                const m = /letter-spacing\s*:\s*([^;]+)/.exec(r.body);
                return m ? { file: r.file, selector: r.selector, value: m[1].trim() } : null;
            })
            .filter((x): x is { file: string; selector: string; value: string } => x !== null)
            .filter((x) => !/^(normal|0)$/.test(x.value));
        expect(offenders).toEqual([]);
    });
});

describe('line-height on Thai headings', () => {
    it('leaves room for the vowel and tone-mark stack', () => {
        const tooTight = ALL
            .map((r) => {
                const fs_ = /font-size\s*:\s*([\d.]+)rem/.exec(r.body);
                const lh = /line-height\s*:\s*([\d.]+)\s*;/.exec(r.body);
                if (!fs_ || !lh) return null;
                if (parseFloat(fs_[1]) < HEADING_REM) return null;
                return { file: r.file, selector: r.selector, fontSize: fs_[1], lineHeight: parseFloat(lh[1]) };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .filter((x) => x.lineHeight < MIN_HEADING_LINE_HEIGHT);
        expect(tooTight).toEqual([]);
    });

    it('the login hero clears the 72px ink band that was actually measured', () => {
        // Not the generic floor — the number from the live page. Line 1's ink ran
        // 291..363 and line 2's 342..414, so each band is 72px and the line box has
        // to be at least that. At font-size 2.85rem (45.6px) the minimum ratio is
        // 72 / 45.6 = 1.579; 1.35 would NOT have been enough here, and neither was
        // the first attempt at 1.42.
        const INK_PX = 72;
        const hero = ALL.find((r) => r.selector.includes('.gov-auth-hero-title'));
        expect(hero).toBeDefined();
        const size = /font-size\s*:\s*([\d.]+)rem/.exec((hero as Rule).body);
        const lh = /line-height\s*:\s*([\d.]+)\s*;/.exec((hero as Rule).body);
        expect(size).not.toBeNull();
        expect(lh).not.toBeNull();
        const px = parseFloat((size as RegExpExecArray)[1]) * 16;
        const box = px * parseFloat((lh as RegExpExecArray)[1]);
        expect(box).toBeGreaterThanOrEqual(INK_PX);
    });
});
