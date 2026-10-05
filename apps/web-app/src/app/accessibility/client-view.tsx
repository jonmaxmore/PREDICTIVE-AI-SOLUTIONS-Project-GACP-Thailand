'use client';

/**
 * Accessibility statement — body.
 *
 * Split out of page.tsx because the page owns `export const metadata`, which
 * only a server component may declare, while the copy needs `useLanguage()`.
 * Same page/ClientView split the System Integrity Check enforces across the
 * HEALTH routes.
 *
 * The statement used to promise, in its own §3, that the site "supports
 * switching between Thai and English via the header menu" while this very page
 * ignored the toggle and rendered hardcoded Thai. Mounting LanguageToggle here
 * makes the claim true on the page that makes it.
 *
 * Renders inside `GovLayout chrome="minimal"` — public marketing-style page,
 * no app-shell sidebar, persistent footer at bottom.
 */

import Link from 'next/link';
import { GovLayout } from '@/components/layout/GovLayout';
import { LanguageToggle } from '@/components/feature/LanguageToggle';
import { useLanguage } from '@/lib/i18n/language-context';
import { MINISTRY_CONTACT, ministryMailtoHref } from '@/lib/ministry-contact';

const SITE_URL = 'https://gacpth.com';

export default function AccessibilityClientView() {
  const { dict } = useLanguage();
  const c = dict.accessibilityStatement;

  // MINISTRY_CONTACT.ministry is the Thai name only, so interpolating it would
  // drop Thai glyphs into the English page. The agency has an official English
  // name (already used in en-core's hero subtitle), so the name is dictionary
  // copy; the email, phone and address stay in the constant because they are
  // facts rather than copy and must not diverge between languages. The postal
  // address is the exception: a Thai-script address is unusable to the overseas
  // reader the English page exists for, so it carries its standard romanised form.
  const fill = (template: string) =>
    template.replace('{ministry}', dict.common.ministryName).replace('{site}', SITE_URL);

  return (
    <GovLayout chrome="minimal">
      {/* No `max-w-none`: that removed the typography plugin's 65ch measure and
          let body copy run 864px wide at 1440px, well past the ~75-character
          line the WCAG-adjacent readability guidance this page is about calls
          for. */}
      <article className="prose prose-slate">
        <header className="not-prose mb-8">
          <div className="flex items-start justify-between gap-3">
            <p className="mb-2 text-xs text-slate-500">{c.draftTag}</p>
            {/* LanguageToggle's default `topbar` variant is styled for the dark
                gov-topbar (text-white/80). On this light page it measured 1.05:1
                — invisible, on the page that declares this platform accessible
                (evidence/apple-qa-audit-2026-09-07). Overridden here rather than
                in the component so the real topbar is untouched; the component
                still owes an on-light variant. */}
            <LanguageToggle className="text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:ring-slate-900" />
          </div>
          <h1 className="text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
            {c.title}
          </h1>
          <p className="mt-2 text-lg text-slate-600">{c.subtitle}</p>
        </header>

        <Banner>
          {c.draftNoticeLead} <strong>{c.draftNoticeEmphasis}</strong> {fill(c.draftNoticeRest)}
        </Banner>

        <h2>{c.scope.heading}</h2>
        <p>{fill(c.scope.body)}</p>

        <h2>{c.standard.heading}</h2>
        <p>
          {c.standard.leadIn} <strong>{c.standard.standardName}</strong> {c.standard.asSetOutIn}{' '}
          <a href="https://www.w3.org/TR/WCAG22/" target="_blank" rel="noreferrer">
            {c.standard.w3cLinkText}
          </a>
          {/* Terminator sits OUTSIDE the anchor so the full stop is not part of
              the link text or its click target. */}
          {c.standard.linkSuffix}{' '}
          {c.standard.trailing}
        </p>

        <h2>{c.support.heading}</h2>
        <ul>
          {c.support.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <h2>{c.limitations.heading}</h2>
        <p className="italic text-slate-600">{c.limitations.body}</p>

        <h2>{c.report.heading}</h2>
        <p>{c.report.intro}</p>
        <ul>
          <li>
            {c.report.emailLabel}:{' '}
            <a href={ministryMailtoHref()}>{MINISTRY_CONTACT.email}</a>
          </li>
          <li>
            {c.report.phoneLabel}: {MINISTRY_CONTACT.phone}
          </li>
          <li>
            {c.report.addressLabel}: {dict.common.ministryAddress}
          </li>
        </ul>
        <p>{c.report.sla}</p>

        <h2>{c.escalation.heading}</h2>
        <p>{c.escalation.body}</p>

        <h2>{c.provenance.heading}</h2>
        <p>{fill(c.provenance.body)}</p>

        <p className="not-prose mt-12 text-sm text-slate-500">
          {c.backTo}{' '}
          <Link href="/" className="text-blue-700 hover:underline">
            {c.home}
          </Link>{' '}
          ·{' '}
          {/* plain <a>: /sitemap.xml is a metadata route — next/link RSC-prefetch hangs (see Footer.tsx) */}
          <a href="/sitemap.xml" className="text-blue-700 hover:underline">
            {c.sitemap}
          </a>
        </p>
      </article>
    </GovLayout>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="note"
      className="not-prose my-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
