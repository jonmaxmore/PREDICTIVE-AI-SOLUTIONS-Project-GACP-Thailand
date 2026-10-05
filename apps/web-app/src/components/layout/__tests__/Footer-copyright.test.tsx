/**
 * Operator ruling 2026-10-05: the copyright holder is Suan Sunandha Rajabhat
 * University, not the ministry. The ministry stays where it means the
 * certificate issuer; only the © line changes.
 */

import { describe, expect, it, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Footer } from '../Footer';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { bangkokDateParts } from '@/lib/format/thai-date';

jest.unmock('@/lib/i18n/language-context');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const yearAD = bangkokDateParts(new Date())!.year;

describe('Footer copyright line', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    localStorage.clear();
  });

  it('Thai: names the University with the BE year first and the AD year glossed', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <Footer />
      </LanguageProvider>,
    );
    const text = html.replace(/<!-- -->/g, '');
    expect(text).toContain(
      `© ${yearAD + 543} (${yearAD}) มหาวิทยาลัยราชภัฏสวนสุนันทา สงวนลิขสิทธิ์`,
    );
    expect(text).not.toMatch(/©[^<]*กรมการแพทย์แผนไทย/);
  });

  it('English: names the University with the AD year only', () => {
    localStorage.setItem('language', 'en');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <LanguageProvider>
          <Footer />
        </LanguageProvider>,
      );
    });
    const text = host.textContent ?? '';
    expect(text).toContain(
      `© ${yearAD} Suan Sunandha Rajabhat University. All rights reserved.`,
    );
    expect(text).not.toMatch(/©[^·]*Department of Thai Traditional/);
  });
});
