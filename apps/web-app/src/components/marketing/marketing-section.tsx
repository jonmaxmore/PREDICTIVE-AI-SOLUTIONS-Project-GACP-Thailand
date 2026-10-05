/**
 * Marketing section primitives — Iter 28.
 *
 * Lightweight, presentational building blocks shared across the public
 * marketing pages (landing, about, pricing, ToS, privacy). All Thai
 * copy lives in the page files; these primitives only hold layout +
 * accessibility scaffolding.
 */

import type { ReactNode } from 'react';

export interface MarketingSectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'center';
}

export function MarketingSection({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  align = 'left',
}: MarketingSectionProps) {
  return (
    <section
      id={id}
      className={`mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20 ${className ?? ''}`}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <header className={`mb-10 ${align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}`}>
        {/* Eyebrow: no positive letter-spacing on Thai (it detaches leading /
            horizontal vowels); the label feel comes from weight + leaf + size.
            leaf-800, not leaf-700: sections sit on bg-mint-bg (#eef4ef) where
            leaf-700 is 4.48:1 — a hair under AA for this 12px text. */}
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold text-leaf-800 dark:text-primary-300">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={id ? `${id}-title` : undefined}
          className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl md:text-4xl"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-3 text-base text-zinc-600 dark:text-zinc-300 sm:text-lg">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export interface MarketingCardProps {
  title: string;
  description: string;
  badge?: string;
  icon?: ReactNode;
  footer?: ReactNode;
}

export function MarketingCard({ title, description, badge, icon, footer }: MarketingCardProps) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-leaf-soft/80 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-primary-900/40 dark:bg-zinc-900">
      {icon ? (
        <div
          className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft dark:bg-primary-900/30 dark:text-primary-300"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      {badge ? (
        <span className="mb-2 inline-flex w-fit items-center rounded-full bg-leaf-soft px-2 py-0.5 text-xs font-semibold text-leaf-onSoft dark:bg-primary-900/40 dark:text-primary-200">
          {badge}
        </span>
      ) : null}
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{description}</p>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </article>
  );
}
