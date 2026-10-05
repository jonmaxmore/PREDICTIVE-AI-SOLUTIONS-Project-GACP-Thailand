/**
 * X2-FIX-B / H-9 — /provider/receipts wrap in ProviderLayout.
 *
 * The audit (X2-B §5.1) flagged that `provider/receipts/page.tsx`
 * rendered in a bare `<div className="mx-auto w-full max-w-sm px-4">`
 * shell with NO sidebar, header, role-aware nav, mobile bottom tabs,
 * or footer. Accountants navigating from `/provider/receipts` lost
 * all global navigation chrome — an unintentional shell escape.
 *
 * X2-FIX-B wraps the page in `<ProviderLayout>` so the global shell
 * is inherited. This file is a source-regex regression guard pinning:
 *   (a) the ProviderLayout import exists
 *   (b) the page returns a `<ProviderLayout>` root (not a bare div)
 *   (c) the old `max-w-sm` wrapper is gone (the table was crushed at
 *       384 px)
 *
 * Source-regex pattern over render: the page wires `useAuth()` and
 * `apiClient` which are heavy to mock end-to-end (`receipts-side-
 * filter.test.tsx` next to this file uses the same trick).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('[X2-FIX-B / H-9] /provider/receipts wraps in ProviderLayout', () => {
  const pageSrc = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8');

  it('imports ProviderLayout from the provider components folder', () => {
    expect(pageSrc).toMatch(
      /import\s+ProviderLayout\s+from\s+['"]\.\.\/components\/provider-layout['"]/,
    );
  });

  it('returns a <ProviderLayout> as the root JSX element (not a bare <div>)', () => {
    // The returned JSX must open with <ProviderLayout — if it opens
    // with `<div`, the shell escape has regressed.
    expect(pageSrc).toMatch(/return\s*\(\s*(?:\/\/[^\n]*\s*)*\s*<ProviderLayout/);
  });

  it('drops the old bare `max-w-sm` wrapper (crushed the data table)', () => {
    expect(pageSrc).not.toMatch(/mx-auto\s+w-full\s+max-w-sm\s+px-4/);
  });

  it('closes the <ProviderLayout> tag (well-formed JSX)', () => {
    // Hard guard — if a future edit accidentally drops the closing
    // tag, the build would actually fail; this just confirms the
    // current shape so future refactors keep the wrap intact.
    expect(pageSrc).toContain('</ProviderLayout>');
  });
});
