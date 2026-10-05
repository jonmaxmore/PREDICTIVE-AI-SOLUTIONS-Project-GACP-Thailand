/**
 * PC-first layout guard — /health/establishments/new (2026-06-10 audit, Wave 0).
 * Same max-w-sm (384px) shell-escape as planting/new; fixed by adopting
 * PageContainer + responsive field grids. See planting-new-pc-layout.test.tsx.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('[audit-2026-06-10] /health/establishments/new is PC-first', () => {
  const src = readFileSync(resolve(__dirname, '../client-view.tsx'), 'utf8');

  it('adopts the standard PageContainer', () => {
    expect(src).toMatch(/import\s*\{[^}]*PageContainer[^}]*\}\s*from\s*['"]@\/components\/layout\/page-system['"]/);
    expect(src).toMatch(/<PageContainer>/);
    expect(src).toContain('</PageContainer>');
  });

  it('drops the old max-w-sm (384px) straw', () => {
    expect(src).not.toMatch(/mx-auto\s+w-full\s+max-w-sm\s+px-4/);
  });

  it('makes field grids responsive', () => {
    expect(src).not.toMatch(/className="grid grid-cols-2 gap-4"/);
  });
});
