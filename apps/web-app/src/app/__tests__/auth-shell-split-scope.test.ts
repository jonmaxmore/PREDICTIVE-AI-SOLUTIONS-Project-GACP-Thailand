import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * The auth shell's split-screen layout must not reach pages that have no
 * split to make.
 *
 * `.gov-auth-page` sets `flex-direction: row` at >=1024px so the branded hero
 * panel can sit beside the form. terms/ and privacy/ borrowed the same shell
 * for its full-height column and background, but they have no hero — so at
 * desktop widths their <header>, <main> and <footer> were laid out as three
 * side-by-side columns and the page collapsed to the tallest child.
 *
 * Measured at 1440px before the fix (visual-QA sweep, 2026-07-26):
 *   header 213x900 @ x=0 | main 666x900 @ x=213 | footer 560x852 @ x=880
 * The footer became a squeezed sidebar with "dtam.moph.go.th" wrapping
 * mid-token, and the back link sat flush against the viewport edge.
 *
 * This spec pins the RULE rather than the spelling: whatever selector carries
 * the desktop `row` override, every page wrapper using it must also render a
 * hero panel. A future page that borrows the shell without a hero fails here
 * instead of shipping a broken desktop layout.
 */

const APP_DIR = resolve(__dirname, '..');
const AUTH_CSS = resolve(__dirname, '../../styles/globals-components-auth.css');

const SPLIT_MARKERS = ['gov-auth-hero', 'gov-auth-form-panel'];

/** Selectors given `flex-direction: row` inside a min-width media query. */
function selectorsWithDesktopRow(css: string): string[] {
    const found = new Set<string>();
    // Walk top-level blocks; only look inside `@media (min-width: ...)`.
    const mediaRe = /@media[^{]*min-width[^{]*\{/g;
    while (mediaRe.exec(css) !== null) {
        // Balance braces from the media block's opening brace.
        let depth = 1;
        let i = mediaRe.lastIndex;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
        }
        const body = css.slice(mediaRe.lastIndex, i - 1);
        const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
        let r: RegExpExecArray | null;
        while ((r = ruleRe.exec(body)) !== null) {
            if (!/flex-direction\s*:\s*row/.test(r[2])) continue;
            for (const sel of r[1].split(',')) {
                const cls = sel.trim().match(/^\.([A-Za-z0-9_-]+)$/);
                if (cls) found.add(cls[1]);
            }
        }
    }
    return [...found];
}

function pageFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) pageFiles(full, out);
        else if (/\.tsx$/.test(entry)) out.push(full);
    }
    return out;
}

describe('auth shell — desktop split layout is scoped to pages that have a split', () => {
    const css = readFileSync(AUTH_CSS, 'utf8');
    const splitSelectors = selectorsWithDesktopRow(css);

    it('exactly one selector carries the desktop row override', () => {
        // If this ever grows, the check below still holds — but the growth
        // itself deserves a look, since `row` on a shared shell is what broke
        // terms/ and privacy/ in the first place.
        expect(splitSelectors).toEqual(['gov-auth-page']);
    });

    it('every page using the split shell also renders a hero panel', () => {
        const offenders: string[] = [];

        for (const file of pageFiles(APP_DIR)) {
            const src = readFileSync(file, 'utf8');
            const usesSplitShell = splitSelectors.some((sel) =>
                new RegExp(`className="[^"]*\\b${sel}\\b`).test(src),
            );
            if (!usesSplitShell) continue;
            if (SPLIT_MARKERS.some((marker) => src.includes(marker))) continue;
            offenders.push(relative(APP_DIR, file));
        }

        expect(offenders).toEqual([]);
    });

    it('the document pages keep a stacked shell', () => {
        for (const page of ['privacy/page.tsx', 'terms/page.tsx']) {
            const src = readFileSync(join(APP_DIR, page), 'utf8');
            expect(src).toMatch(/className="[^"]*\bgov-doc-page\b/);
            expect(src).not.toMatch(/className="[^"]*\bgov-auth-page\b/);
        }
    });

    it('the stacked shell shares the auth shell base rules', () => {
        // Same background and full-height column — the only thing the document
        // pages must not inherit is the desktop `row` override.
        expect(css).toMatch(/\.gov-doc-page[\s,{]/);
        const baseRule = css.match(/([^{}]*\.gov-doc-page[^{}]*)\{([^{}]*)\}/);
        expect(baseRule).not.toBeNull();
        expect(baseRule![2]).toMatch(/flex-direction\s*:\s*column/);
        expect(baseRule![2]).toMatch(/min-height\s*:\s*100vh/);
    });
});
