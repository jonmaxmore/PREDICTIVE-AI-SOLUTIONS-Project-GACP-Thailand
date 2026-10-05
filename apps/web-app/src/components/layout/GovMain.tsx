'use client';

import * as React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

/**
 * The `<main>` landmark, split out of GovLayout so its aria-label can follow
 * the language — the same reason SkipToContent was split out.
 *
 * That earlier split claimed the skip link "was the last Thai string left on
 * an English screen". It was not: GovLayout still defaulted the landmark label
 * to a Thai literal, so a screen reader in English mode announced the main
 * region in Thai on every route the layout wraps. An aria-label is invisible
 * both to a sighted reader and to a `textContent` scan, which is why the
 * page-level i18n suites never surfaced it.
 *
 * `children` arrive as a prop from the server component, so they are NOT
 * pulled into the client bundle — only this wrapper is.
 */
export interface GovMainProps {
  children: React.ReactNode;
  className?: string;
  /** Explicit override; falls back to the localised landmark name. */
  label?: string;
}

export function GovMain({ children, className, label }: GovMainProps) {
  const { dict } = useLanguage();
  return (
    <main id="main-content" aria-label={label ?? dict.common.mainLandmark} className={className}>
      {children}
    </main>
  );
}
