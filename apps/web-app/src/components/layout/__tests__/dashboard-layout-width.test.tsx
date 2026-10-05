/**
 * DashboardLayout width guard (2026-06-11).
 *
 * Single width standard: every in-shell page (health + provider) renders inside ONE
 * container — max-w-7xl (1280px) centered — so switching pages never makes the layout
 * jump. The cap lives at the <main> inner wrapper so EVERY page inherits it automatically
 * (no per-page max-w). This guard pins that single source and forbids a regression back
 * to the unbounded full-width (w-full with no cap) or the old max-w-6xl.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('[2026-06-11] DashboardLayout caps content at the single max-w-7xl standard', () => {
  const src = readFileSync(resolve(__dirname, '../dashboard-layout.tsx'), 'utf8');

  it('wraps <main> children in a centered max-w-7xl container', () => {
    expect(src).toMatch(/<div className="mx-auto w-full max-w-7xl">/);
  });

  it('does not regress to an uncapped full-width or the old max-w-6xl shell', () => {
    // the bare `w-full` content wrapper (no cap) and the legacy max-w-6xl are both gone
    expect(src).not.toMatch(/<div className="w-full">\s*\{children\}/);
    expect(src).not.toMatch(/max-w-6xl/);
  });
});

describe('[2026-06-11] wizard layout (own chrome, not DashboardLayout) carries the same cap', () => {
  // Found in live staging verify: the application wizard runs its own layout, so
  // it rendered full-bleed (2496px) while every other page was 1280 centered.
  const wizard = readFileSync(
    resolve(__dirname, '../../../app/health/applications/new/_steps/layout.tsx'),
    'utf8',
  );

  it('header, banner section and <main> all use mx-auto max-w-7xl', () => {
    const capped = wizard.match(/mx-auto (?:mt-6 )?w-full max-w-7xl/g) || [];
    expect(capped.length).toBeGreaterThanOrEqual(3);
  });

  it('no uncapped w-full px-4 wrappers remain at the wizard chrome level', () => {
    expect(wizard).not.toMatch(/className="w-full px-4 (?:py-\d+ )?sm:px-6 lg:px-8"/);
  });
});
