/**
 * P0-3 systemic guard (2026-06-11) — table-header contrast contract.
 *
 * Root cause of the invisible-header class of bugs: a `color` set directly on
 * `th` (the old `table thead th { color: muted-foreground }` global) beats
 * inheritance from `thead` regardless of specificity, silently defeating the
 * primitive TableHeader's `text-primary-foreground` → dark-on-dark (~1.3:1)
 * headers on EVERY primary-bg table (data-table, scheduler/reassign,
 * admin/planting, analytics, print, plot-assignment…).
 *
 * The contract this suite pins:
 *   1. the global default color lives on `thead` (element selector — any
 *      utility class on thead wins, th inherits the winner);
 *   2. the `th` rule carries NO color of its own;
 *   3. the primitive TableHeader keeps the primary-bg + white pairing;
 *   4. light-bg TableHeader consumers declare their own text color, because
 *      cn() only swaps the bg — the primitive's white class would otherwise
 *      survive onto a light background.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(__dirname, '../../../../', rel), 'utf8');

describe('[P0-3] table header color contract', () => {
  const css = read('styles/globals-premium.css');
  const primitive = read('components/ui/primitives/table.tsx');

  it('global default color sits on thead (element selector), not on th', () => {
    const theadRule = css.match(/table thead \{([^}]*)\}/)?.[1] ?? '';
    expect(theadRule).toContain('color: hsl(var(--muted-foreground))');
  });

  it('the th rule carries no color (a direct th color would beat thead inheritance)', () => {
    const thRule = css.match(/table thead th \{([^}]*)\}/)?.[1] ?? '';
    expect(thRule).not.toContain('color:');
  });

  it('primitive TableHeader keeps the primary-bg + primary-foreground pairing', () => {
    expect(primitive).toMatch(/bg-\[hsl\(var\(--primary\)\)\] text-primary-foreground/);
  });

  it('light-bg TableHeader consumers declare an explicit text color', () => {
    const analytics = read('../src/app/provider/analytics/page.tsx');
    const trace = read('../src/app/trace/batch/[qr-code]/client-view.tsx');
    for (const src of [analytics, trace]) {
      // every bg-muted/10 TableHeader must pair an explicit text-* color
      for (const m of src.matchAll(/<TableHeader className="([^"]*bg-muted\/10[^"]*)"/g)) {
        expect(m[1]).toMatch(/text-(muted-foreground|foreground|slate-\d+)/);
      }
    }
  });
});
