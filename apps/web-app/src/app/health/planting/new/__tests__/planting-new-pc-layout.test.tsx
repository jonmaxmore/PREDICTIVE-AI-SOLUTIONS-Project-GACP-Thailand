/**
 * PC-first layout guard — /health/planting/new (2026-06-10 audit, Wave 0).
 *
 * The page wrapped its whole form in `mx-auto w-full max-w-sm px-4` (384px),
 * so on a PC monitor it was a tiny column in a sea of empty space, and it
 * carried a stray `bg-white/50` overlay that permanently dimmed the card.
 * The fix adopts the standard PageContainer (fills the DashboardLayout
 * max-w-6xl shell) and removes the overlay.
 *
 * Source-regex guard (the page wires heavy hooks; same trick as
 * receipts-layout-wrap.test.tsx) pinning: PageContainer adopted, no max-w-sm
 * straw, no dead overlay, fixed grid-cols-2 made responsive.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('[audit-2026-06-10] /health/planting/new is PC-first', () => {
  const src = readFileSync(resolve(__dirname, '../client-view.tsx'), 'utf8');

  it('adopts the standard PageContainer (fills the max-w-6xl shell)', () => {
    expect(src).toMatch(/import\s*\{[^}]*PageContainer[^}]*\}\s*from\s*['"]@\/components\/layout\/page-system['"]/);
    expect(src).toMatch(/<PageContainer>/);
    expect(src).toContain('</PageContainer>');
  });

  it('drops the old max-w-sm (384px) straw that crushed the form on desktop', () => {
    expect(src).not.toMatch(/mx-auto\s+w-full\s+max-w-sm\s+px-4/);
  });

  it('removes the dead bg-white/50 overlay that dimmed the card', () => {
    expect(src).not.toMatch(/absolute\s+inset-0[^"]*bg-white\/50/);
  });

  it('makes field grids responsive (no fixed grid-cols-2 that squeezes columns)', () => {
    expect(src).not.toMatch(/className="grid grid-cols-2 gap-4"/);
  });
});
