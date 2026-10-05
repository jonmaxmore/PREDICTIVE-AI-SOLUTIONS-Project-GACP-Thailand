/**
 * B4-01 (audit 2026-06-10) — DataTable clickable-row keyboard a11y guard.
 *
 * DataTable is a shared finance/DTAM component. When a consumer passes
 * `onRowClick`, the row gets onClick — but pre-fix it had no keyboard path
 * (no tabIndex / onKeyDown), failing WCAG 2.1.1 (Keyboard, Level A) for
 * keyboard + screen-reader users. This source-regex guard pins the
 * keyboard-operability props so a refactor can't silently drop them.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('[audit-2026-06-10] DataTable rows are keyboard-operable when clickable', () => {
  const src = readFileSync(resolve(__dirname, '../DataTable.tsx'), 'utf8');

  it('gives a clickable row a keyboard activation handler (Enter/Space)', () => {
    expect(src).toMatch(/onKeyDown/);
    expect(src).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
  });

  it('makes a clickable row focusable + announced (tabIndex + role) only when onRowClick is set', () => {
    expect(src).toMatch(/tabIndex:\s*0/);
    expect(src).toMatch(/role:\s*'button'/);
    expect(src).toMatch(/const interactiveProps = onRowClick/);
  });

  it('gives a clickable row a visible keyboard focus ring (WCAG 2.4.7)', () => {
    expect(src).toMatch(/focus-visible:ring-2/);
  });
});
