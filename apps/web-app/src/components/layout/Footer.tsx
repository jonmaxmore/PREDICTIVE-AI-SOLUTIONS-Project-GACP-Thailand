'use client';

/**
 * GovLayout Footer — Phase A5 §4.2 persistent footer primitive.
 *
 * Three-column desktop / single-column mobile, government style:
 *   [ministry attribution]   [about / a11y / legal links]   [version stamp]
 *
 * Contact facts (phone, email, website) come from `lib/ministry-contact.ts`.
 * The ministry NAME and postal ADDRESS come from the dictionary instead: the
 * constant holds Thai only, and this footer renders on every public route, so
 * interpolating it put Thai glyphs on every English page. That is what kept
 * the "EN mode contains zero Thai" mandate out of reach page by page — the
 * footer alone accounted for ~31 Thai codepoints on all seven public routes.
 *
 * Now a client component so it can read `useLanguage()`. It has no server-only
 * dependency; GovLayout may stay a server component and render it as a child.
 *
 * BUILD IDENTITY (design-reproducibility/01-build-identity, 2026-08-21):
 * used to default `buildDate`/`version` from `NEXT_PUBLIC_BUILD_DATE` /
 * `NEXT_PUBLIC_APP_VERSION` — but nothing in the repo ever set those env
 * vars (the Dockerfile only bakes GIT_SHA/BUILT_AT, non-public, on purpose;
 * see build-info.ts), so every real deploy fell through to the dict's
 * `buildDateFallback`, the word "current"/"ปัจจุบัน" — a placeholder that
 * reads as a fact. An operator moving servers had no way to tell a stale
 * image from a fresh one by looking at the page.
 *
 * Fixed by wiring the EXISTING mechanism through instead of inventing a new
 * one: on mount this fetches `GET /api/webapp-version` (build-info.ts),
 * which reads GIT_SHA/BUILT_AT from the server process's environment per
 * request. That has to happen client-side — NEXT_PUBLIC_* values are frozen
 * into the bundle at build time, which is exactly the bug being fixed here.
 * Until the fetch resolves (or if it fails, or if the build genuinely was
 * never stamped), the dict fallback is an HONEST "unknown build" label, never
 * "current". `buildDate`/`version` props still take priority when given
 * (existing override, used by GovLayout callers and these tests) and skip
 * the fetch entirely once both are present.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';
import {
  MINISTRY_CONTACT,
  ministryMailtoHref,
  ministryTelHref,
} from '@/lib/ministry-contact';
import { useLanguage } from '@/lib/i18n/language-context';
import { copyrightLine } from '@/lib/i18n/copyright';

/** Chars of a commit SHA worth showing in a footer line — long enough to be
 * unambiguous, short enough to read. Matches
 * scripts/probes/deploy-drift.sh's own MIN_REVISION_LENGTH. */
const SHORT_SHA_LENGTH = 7;

interface FetchedBuild {
  revision: string | null;
  builtAt: string | null;
}

/** Link targets are language-independent; only the label is translated. */
const NAV_LINKS = [
  { href: '/about', key: 'about' },
  { href: '/accessibility', key: 'accessibility' },
  { href: '/privacy', key: 'privacy' },
  { href: '/terms', key: 'terms' },
  { href: '/sitemap.xml', key: 'sitemap' },
  { href: '/help', key: 'help' },
] as const;

export interface FooterProps {
  buildDate?: string;
  version?: string;
}

export function Footer({ buildDate, version }: FooterProps) {
  const { dict, language } = useLanguage();
  const c = dict.footer;

  const [fetched, setFetched] = useState<FetchedBuild | null>(null);

  useEffect(() => {
    // Both overrides already given (tests, or a future server-fed caller) —
    // nothing to fetch.
    if (buildDate !== undefined && version !== undefined) return undefined;
    if (typeof fetch !== 'function') return undefined;

    let cancelled = false;
    fetch('/api/webapp-version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled || data === null || typeof data !== 'object') return;
        const { revision, builtAt } = data as Record<string, unknown>;
        setFetched({
          revision: typeof revision === 'string' ? revision : null,
          builtAt: typeof builtAt === 'string' ? builtAt : null,
        });
      })
      .catch(() => {
        // `fetched` stays null. The honest "unknown build" fallback below
        // already covers this — a network failure is not a build this
        // footer can name, and it must not guess one.
      });
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only: re-fetching on every prop change would fight
    // an explicit override rather than just skip past it (see guard above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedDate = buildDate ?? fetched?.builtAt ?? null;
  const resolvedCommit =
    version ?? (fetched?.revision ? fetched.revision.slice(0, SHORT_SHA_LENGTH) : null);

  const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), template);

  return (
    <footer
      className="mt-12 bg-gov-navy text-white"
      role="contentinfo"
      aria-label={c.landmarkLabel}
    >
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-3">
        {/* Column 1 — Ministry identity + contact */}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-white font-bold text-gov-blue-800"
              aria-hidden="true"
            >
              GACP
            </div>
            <div className="leading-tight">
              <p className="font-semibold">{dict.common.ministryName}</p>
              {/* On a Thai page the English name is a useful second line. On an
                  English page it would just repeat the line above it. */}
              {language === 'th' && (
                <p className="text-[11px] text-blue-200" lang="en">
                  {MINISTRY_CONTACT.ministryEn}
                </p>
              )}
            </div>
          </div>
          <address className="text-sm not-italic leading-relaxed text-blue-100">
            <span className="sr-only">{c.addressLabel} </span>
            {dict.common.ministryAddress}
          </address>
          <p className="mt-2 text-sm text-blue-100">
            <Phone className="mr-1.5 inline-block h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
            {c.phonePrefix}{' '}
            <a
              href={ministryTelHref()}
              aria-label={fill(c.phoneAria, { phone: MINISTRY_CONTACT.phone })}
              className="inline-block min-h-[24px] py-0.5 underline hover:text-white focus-visible:rounded focus-visible:bg-white focus-visible:px-1 focus-visible:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {MINISTRY_CONTACT.phone}
            </a>
          </p>
          <p className="text-sm text-blue-100">
            <Mail className="mr-1.5 inline-block h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />{' '}
            <a
              href={ministryMailtoHref()}
              aria-label={fill(c.emailAria, { email: MINISTRY_CONTACT.email })}
              className="inline-block min-h-[24px] py-0.5 underline hover:text-white focus-visible:rounded focus-visible:bg-white focus-visible:px-1 focus-visible:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {MINISTRY_CONTACT.email}
            </a>
          </p>
        </div>

        {/* Column 2 — Quick links */}
        <nav aria-label={c.linksLandmarkLabel}>
          <h2 className="mb-3 text-sm font-semibold text-white">{c.linksHeading}</h2>
          <ul className="space-y-1 text-sm">
            {NAV_LINKS.map(({ href, key }) => {
              const linkClass = 'block min-h-[24px] py-1 text-blue-100 hover:text-white hover:underline focus-visible:rounded focus-visible:bg-white focus-visible:px-1 focus-visible:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
              // File/document targets (e.g. /sitemap.xml — a metadata route, not an
              // app page) must NOT go through next/link: the App Router RSC-prefetches
              // them (?_rsc=...) and the request hangs forever server-side, leaving a
              // permanently-pending connection on EVERY page that renders the footer
              // (found by the e2e carpet sweep — networkidle never settles).
              const isDocument = /\.[a-z]+$/i.test(href);
              const label = c.links[key];
              return (
                <li key={href}>
                  {isDocument ? (
                    <a href={href} className={linkClass}>{label}</a>
                  ) : (
                    <Link href={href} className={linkClass}>{label}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Column 3 — Version stamp + ministry website link */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-white">{c.systemHeading}</h2>
          <dl className="space-y-1.5 text-sm text-blue-100">
            <div className="flex justify-between gap-4">
              <dt>{c.lastUpdated}</dt>
              <dd className="font-mono text-white">{resolvedDate ?? c.buildDateFallback}</dd>
            </div>
            {resolvedCommit && (
              <div className="flex justify-between gap-4">
                <dt>{c.version}</dt>
                <dd className="font-mono text-white">{resolvedCommit}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt>{c.ministrySite}</dt>
              <dd>
                <a
                  href={MINISTRY_CONTACT.website}
                  className="inline-block min-h-[24px] py-0.5 text-blue-100 hover:text-white hover:underline focus-visible:rounded focus-visible:bg-white focus-visible:px-1 focus-visible:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  target="_blank"
                  rel="noreferrer"
                  aria-label={c.ministrySiteAria}
                >
                  dtam.moph.go.th
                </a>
              </dd>
            </div>
          </dl>
          {/* What the service is and that it is paid (audit UXUI-02): the
              lines here used to call the site a free government website
              certified by the department. See th-footer.ts operatedBy. */}
          <p className="mt-4 text-[11px] leading-relaxed text-blue-300">
            {fill(c.operatedBy, { ministry: dict.common.ministryName })}
            <br />
            {c.feesNotice}{' '}
            <Link
              href="/pricing"
              className="inline-block min-h-[24px] py-0.5 underline hover:text-white focus-visible:rounded focus-visible:bg-white focus-visible:px-1 focus-visible:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {c.feesLink}
            </Link>
          </p>
        </div>
      </div>

      <div className="border-t border-blue-900/50">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-3 text-[11px] text-blue-300">
          <span>
            {copyrightLine(c.copyright, language)}
          </span>
          <span>
            {c.accessibilityProblem}{' '}
            <a
              href={ministryMailtoHref()}
              aria-label={fill(c.accessibilityProblemAria, { email: MINISTRY_CONTACT.email })}
              className="inline-block min-h-[24px] py-0.5 underline hover:text-white focus-visible:rounded focus-visible:bg-white focus-visible:px-1 focus-visible:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {MINISTRY_CONTACT.email}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
