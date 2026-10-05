/**
 * A tinted surface must have a value in BOTH themes, or the text on it disappears.
 *
 * Measured on the live demo 2026-09-07 (evidence/apple-qa-audit-2026-09-07):
 * the friendly-UI layer declares its surfaces as literal hexes in `:root` and the
 * `.dark` block overrides NONE of them, while text colour flips through
 * `--foreground`. The result is near-white text on a near-white ground:
 *
 *   /auth              .bg-leaf-soft > li > span   #f1f3f2 on #eaf9f0  = 1.02:1  (9 nodes)
 *   /login #identifier the typed national ID       #f2f2f2 on #ffffff  = 1.12:1
 *   404 page           secondary button            #f2f2f2 on #f1f5f9  = 1.02:1
 *
 * `bg-leaf-soft` alone is used in 85 files, and login-chooser.tsx — the platform's
 * first screen — contains the string `dark:` zero times. So this cannot be fixed
 * per-component; the token itself has to carry both values.
 *
 * This suite pins three things the eye cannot check on every deploy:
 *   1. every tinted surface token declared in `:root` is also declared in `.dark`
 *   2. each surface and its documented on-colour clear WCAG AA (4.5:1) in BOTH themes
 *   3. the shared field style paints from a token, not from a hardcoded `#fff`
 */

import fs from 'node:fs';
import path from 'node:path';

const STYLES = path.join(__dirname, '..');
const globals = fs.readFileSync(path.join(STYLES, 'globals.css'), 'utf8');
const layout = fs.readFileSync(path.join(STYLES, 'globals-components-layout.css'), 'utf8');

/**
 * The tinted surfaces of the friendly-UI layer, each paired with the colour the
 * design bundle documents as the text/icon colour that sits ON it. `null` means
 * the surface only ever carries default `--foreground` text.
 */
const SURFACES: ReadonlyArray<{ surface: string; on: string | null }> = [
    { surface: '--leaf-soft', on: '--leaf-on-soft' },
    { surface: '--officer-soft', on: '--officer-on-soft' },
    { surface: '--lime-soft', on: null },
    { surface: '--mint-bg', on: null },
    { surface: '--mint-soft', on: null },
    { surface: '--avatar-bg', on: null },
    { surface: '--caution-soft', on: null },
    // A border, not a text ground — but it is a themed colour token like the rest: both
    // themes, different values (a light amber-200 edge glared on the dark card).
    { surface: '--caution-edge', on: null },
];

/** Read one `{ … }` block by its selector, tolerating nesting-free Tailwind layers. */
function block(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`selector ${selector} not found`);
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
            depth -= 1;
            if (depth === 0) return css.slice(open + 1, i);
        }
    }
    throw new Error(`unterminated block for ${selector}`);
}

function declare(css: string, prop: string): string | null {
    const m = new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;]+);`).exec(css);
    return m ? m[1].trim() : null;
}

/** Accepts `234 249 240` (channel triplet) or `#eaf9f0`. */
function toRgb(value: string): [number, number, number] {
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const triplet = value.trim().split(/[\s,]+/).map(Number);
    if (triplet.length === 3 && triplet.every((c) => Number.isFinite(c) && c >= 0 && c <= 255)) {
        return triplet as [number, number, number];
    }
    throw new Error(`cannot read colour: ${value}`);
}

function luminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [l1, l2] = [luminance(toRgb(a)), luminance(toRgb(b))];
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const ROOT = block(globals, ':root');
const DARK = block(globals, '.dark');
const AA = 4.5;

describe('tinted surfaces carry a value in both themes', () => {
    it.each(SURFACES.map((s) => s.surface))('%s is declared in :root', (surface) => {
        expect(declare(ROOT, surface)).not.toBeNull();
    });

    it.each(SURFACES.map((s) => s.surface))('%s is declared in .dark', (surface) => {
        // Without this, `.dark` keeps the light hex and themed text lands on a
        // near-white ground — the 1.02:1 measured on /auth.
        expect(declare(DARK, surface)).not.toBeNull();
    });

    it('no dark surface is left identical to its light value', () => {
        const unchanged = SURFACES.filter((s) => {
            const light = declare(ROOT, s.surface);
            const dark = declare(DARK, s.surface);
            return light !== null && dark !== null && light === dark;
        }).map((s) => s.surface);
        expect(unchanged).toEqual([]);
    });
});

describe('each surface clears WCAG AA against the text that sits on it', () => {
    const pairs = SURFACES.filter((s) => s.on !== null) as ReadonlyArray<{ surface: string; on: string }>;

    it.each(pairs)('$surface / $on clears 4.5:1 in light', ({ surface, on }) => {
        const bg = declare(ROOT, surface);
        const fg = declare(ROOT, on);
        expect(bg).not.toBeNull();
        expect(fg).not.toBeNull();
        expect(contrast(fg as string, bg as string)).toBeGreaterThanOrEqual(AA);
    });

    it.each(pairs)('$surface / $on clears 4.5:1 in dark', ({ surface, on }) => {
        const bg = declare(DARK, surface);
        const fg = declare(DARK, on);
        expect(bg).not.toBeNull();
        expect(fg).not.toBeNull();
        expect(contrast(fg as string, bg as string)).toBeGreaterThanOrEqual(AA);
    });

    it('default body text is readable on every tinted surface in dark', () => {
        // `--foreground` dark is `0 0% 95%` — the colour that rendered at 1.02:1
        // over the un-flipped `#eaf9f0`. Every surface must now clear AA under it.
        const fg = '242 242 242';
        for (const { surface } of SURFACES) {
            const bg = declare(DARK, surface);
            expect(bg).not.toBeNull();
            expect({ surface, ratio: contrast(fg, bg as string) })
                .toEqual({ surface, ratio: expect.any(Number) });
            expect(contrast(fg, bg as string)).toBeGreaterThanOrEqual(AA);
        }
    });
});

describe('the on-soft inks are a no-op in light', () => {
    // 71 files had `text-leaf-700` (or -800, or text-officer-700) sitting on a
    // `bg-*-soft` ground. Once that ground carried a real dark value those inks
    // measured 1.93-3.48:1 in dark — the fix creates a NEW defect if it is applied
    // by halves. Migrating them to the on-soft tokens is safe precisely because the
    // light values are identical, so nothing a user sees today moves.
    it('--leaf-on-soft equals --leaf-700 in the light theme', () => {
        expect(declare(ROOT, '--leaf-on-soft')).not.toBeNull();
        expect(toRgb(declare(ROOT, '--leaf-on-soft') as string)).toEqual(toRgb('#18803f'));
    });

    it('--officer-on-soft equals --officer-700 in the light theme', () => {
        expect(declare(ROOT, '--officer-on-soft')).not.toBeNull();
        expect(toRgb(declare(ROOT, '--officer-on-soft') as string)).toEqual(toRgb('#0F5F6B'));
    });

    it('and differs in dark, or the migration would have been pointless', () => {
        expect(toRgb(declare(DARK, '--leaf-on-soft') as string))
            .not.toEqual(toRgb(declare(ROOT, '--leaf-on-soft') as string));
        expect(toRgb(declare(DARK, '--officer-on-soft') as string))
            .not.toEqual(toRgb(declare(ROOT, '--officer-on-soft') as string));
    });
});

describe('the shared field style paints from a token', () => {
    const field = block(layout, '.field-emphasis');

    it('background is theme-aware, not a fixed white', () => {
        // `.field-emphasis` sits on every input, select and textarea. While its
        // background was `#fff !important` the typed national ID rendered
        // rgb(242,242,242) on rgb(255,255,255) = 1.12:1 in dark mode.
        const bg = declare(field, 'background');
        expect(bg).not.toBeNull();
        expect(bg as string).toMatch(/var\(--/);
    });

    it('sets its own text colour so it cannot inherit an unreadable one', () => {
        const color = declare(field, 'color');
        expect(color).not.toBeNull();
        expect(color as string).toMatch(/var\(--/);
    });

    it('does not declare padding, so a caller can still reserve room for an icon', () => {
        // This stylesheet is imported AFTER @tailwind utilities, so a padding here
        // beats every utility without needing !important. While it declared
        // `padding: 0.625rem 1rem`, filter-bar.tsx asked for pl-10 (40px) and the
        // browser used 16px — the search icon sat on top of the placeholder text
        // (measured: text starts at x=116, icon ends at x=128).
        expect(declare(field, 'padding')).toBeNull();
        expect(declare(field, 'padding-left')).toBeNull();
    });

    it('the focus state keeps the same themed background', () => {
        const focus = block(layout, '.field-emphasis:focus,\n.field-emphasis:focus-within');
        const bg = declare(focus, 'background');
        expect(bg).not.toBeNull();
        expect(bg as string).toMatch(/var\(--/);
    });
});
