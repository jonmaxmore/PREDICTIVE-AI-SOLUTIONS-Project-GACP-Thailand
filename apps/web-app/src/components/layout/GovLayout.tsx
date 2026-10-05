/**
 * GovLayout — Phase A5 §4.1 layout primitive.
 *
 * Wraps a page in:
 *   1. A skip-to-content link (first focusable element on the page)
 *   2. The persistent <Footer/> from Phase A5 §4.2
 *
 * Existing app navigation (sidebar / dashboard chrome) is *unchanged* —
 * GovLayout deliberately does NOT replace `app-shell.tsx` or
 * `dashboard-layout.tsx`. It's the outermost wrapper that adds a11y
 * primitives + ministry-attributed footer to every page that opts in.
 *
 * Migration plan (Phase A5 §5, steps 2-4): wrap existing /health/(*),
 * /provider/(*), and marketing routes' layout.tsx files with this
 * primitive, one route group per PR. Step 1 (this PR) only delivers
 * the primitive itself plus the /accessibility route as the first
 * consumer.
 *
 * Marketing pages can opt out of authenticated chrome via
 * `chrome="minimal"` — header/footer still render but page-internal
 * application chrome is suppressed.
 */


import * as React from 'react';
import { Footer } from './Footer';
import { GovMain } from './GovMain';

export interface GovLayoutProps {
  children: React.ReactNode;
  /**
   * `chrome="full"` (default): page provides its own header / sidebar via
   *   existing app-shell, GovLayout only adds skip-link + Footer.
   * `chrome="minimal"`: pure marketing-style page — wrap children in a
   *   plain `<main>` with the persistent footer. No app-shell expected.
   */
  chrome?: 'full' | 'minimal';
  /** Override footer build date if needed for static pages. */
  buildDate?: string;
  /** Override footer version if needed. */
  version?: string;
  /**
   * Aria-label for the `<main>` landmark. Defaults to the localised landmark
   * name from the dictionary — it must NOT be a literal here, or every English
   * page inherits a Thai landmark announcement (see GovMain).
   */
  mainLabel?: string;
}

export function GovLayout({
  children,
  chrome = 'full',
  buildDate,
  version,
  mainLabel,
}: GovLayoutProps) {
  // No <SkipToContent /> here: the root layout (src/app/layout.tsx) renders one
  // for every page, and in the App Router the root layout always wraps this
  // component. Rendering a second put two identical "ข้ามไปยังเนื้อหาหลัก" links
  // in the tab order on every GovLayout page — measured on /accessibility,
  // which is itself the page promising one skip link per page.
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <GovMain
        {...(mainLabel !== undefined ? { label: mainLabel } : {})}
        className={
          chrome === 'minimal'
            ? 'mx-auto w-full max-w-4xl flex-1 px-4 py-8'
            : 'flex-1'
        }
      >
        {children}
      </GovMain>
      <Footer
        {...(buildDate !== undefined ? { buildDate } : {})}
        {...(version !== undefined ? { version } : {})}
      />
    </div>
  );
}
