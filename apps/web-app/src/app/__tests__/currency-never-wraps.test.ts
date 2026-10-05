import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * A baht amount must never be split across lines.
 *
 * `src/styles/globals.css` sets `word-break: break-word` on <body> under a
 * "Thai Text Optimization" heading. Thai has no word spaces, so letting long
 * Thai run-ons break is right — but `word-break: break-word` is the deprecated
 * alias that Blink treats like `overflow-wrap: anywhere`. That does two things
 * the standard `overflow-wrap: break-word` on the next line does not: it breaks
 * *inside* a token, and it drops the element's min-content width to a single
 * character, so a table column can be squeezed below the width of the number
 * it holds.
 *
 * Both landed on the public fee table. Measured at 390px before the fix, the
 * amount column was 62px wide and rendered:
 *   ฿5,535  as  "฿5,5" / "35"
 *   ฿27,675 as  "฿27," / "675"
 * Money that reads as a different number is worse than money that overflows.
 *
 * Thai copy still needs the wrap, so the global rule keeps
 * `overflow-wrap: break-word` and drops only the aggressive alias. This spec
 * guards the money itself: any element rendering a `฿`-prefixed value must
 * pin `whitespace-nowrap`, whatever the surrounding CSS later does.
 */

const SRC = resolve(__dirname, '../..');

// `>฿{` is the JSX shape for a rendered amount: <td className="…">฿{value}</td>
const CURRENCY_CELL = />฿\{/;

function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) tsxFiles(full, out);
        else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(full);
    }
    return out;
}

/** Lines that render a ฿ amount, paired with the opening tag that holds it. */
function currencyLines(source: string): { line: number; text: string }[] {
    return source
        .split('\n')
        .map((text, i) => ({ line: i + 1, text }))
        .filter(({ text }) => CURRENCY_CELL.test(text));
}

describe('baht amounts never break across lines', () => {
    const files = tsxFiles(SRC);

    it('finds the currency-rendering sites it is meant to guard', () => {
        // A rename of the render shape would silently empty this spec.
        // Floor lowered 10 → 9 in Wave 0: one guarded site lived in a
        // zero-importer dead component that was deleted
        // (docs/payment-refactor/legacy-payment-audit.md).
        // Floor lowered 9 → 8 on 2026-08-14: the marketing root became
        // `redirect('/auth')` (login front door, spec §3.3), taking its fee
        // table — and its single `>฿{` cell — with it. The eight remaining
        // sites are the live money surfaces (admin dashboard ×2, plant
        // selection ×3, renewal payment, application detail ×2); the canary
        // still fires if the render shape is renamed.
        // Floor lowered 8 → 5 on 2026-09-06: the bank-slip payment subsystem was
        // removed (Stripe-only), taking three money surfaces with it — the slip
        // upload modal, the accounting daily-cash page and the reconciliation page.
        // The five that remain are the live ones; the canary still fires on a rename.
        const total = files.reduce((n, f) => n + currencyLines(readFileSync(f, 'utf8')).length, 0);
        expect(total).toBeGreaterThanOrEqual(5);
    });

    it('every element rendering a ฿ amount pins whitespace-nowrap', () => {
        const offenders: string[] = [];

        for (const file of files) {
            for (const { line, text } of currencyLines(readFileSync(file, 'utf8'))) {
                // The className lives on the same opening tag as the `>฿{`.
                const openingTag = text.slice(0, text.indexOf('>฿{'));
                if (/whitespace-nowrap/.test(openingTag)) continue;
                offenders.push(`${relative(SRC, file)}:${line}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('the global Thai wrap rule keeps overflow-wrap and drops the break-inside-token alias', () => {
        // Comments are stripped first: the rule's own docstring names the
        // declaration it removed, and matching that would pass or fail on
        // prose rather than on CSS.
        const css = readFileSync(join(SRC, 'styles/globals.css'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        // Thai run-ons still need to be breakable when they would overflow.
        expect(css).toMatch(/overflow-wrap:\s*break-word/);
        // `word-break: break-word` also shrinks min-content to one character,
        // which is what let the fee column collapse to 62px.
        expect(css).not.toMatch(/word-break:\s*break-word/);
    });
});
