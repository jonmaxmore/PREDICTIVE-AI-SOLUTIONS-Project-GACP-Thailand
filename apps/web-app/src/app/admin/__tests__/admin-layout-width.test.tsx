/**
 * Admin shell width guard (2026-06-11).
 *
 * Single width standard: all three portals render at the SAME width. Owner directive
 * — every in-shell page shares ONE container (max-w-7xl, 1280px, centered) so switching
 * pages never makes the layout jump. This supersedes BOTH the ad-hoc max-w-[1700px] and
 * the 2026-06-10 full-width pass (which left pages with their own caps inconsistent).
 * This guard pins the admin grid shell to the max-w-7xl centered standard.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('[2026-06-11] admin shell uses the single max-w-7xl width standard', () => {
  const src = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf8');

  it('caps the grid shell at max-w-7xl, centered (mx-auto), same as health/provider', () => {
    expect(src).toMatch(/mx-auto grid w-full max-w-7xl grid-cols-\[260px_minmax\(0,1fr\)\]/);
  });

  it('keeps the 260px sidebar + responsive single-column fallback', () => {
    expect(src).toMatch(/max-md:grid-cols-1/);
  });

  it('drops the old ad-hoc max-w-\[1700px\] and the interim max-w-6xl cap', () => {
    expect(src).not.toMatch(/max-w-\[1700px\]/);
    expect(src).not.toMatch(/max-w-6xl/);
  });
});
