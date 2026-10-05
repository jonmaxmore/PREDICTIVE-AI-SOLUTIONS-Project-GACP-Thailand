import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * LaunchpadHeader — compact dense object-header band for the provider
 * launchpad (B1).
 *
 * The structured, enterprise counterpart to the airy gov-gradient hero:
 * a kicker (greeting / section eyebrow), a title (role or section name),
 * an optional one-line summary, and optional right-aligned actions. Lives
 * on a plain hairline `bg-card` surface (no shadow, no coloured kicker —
 * minimal-redesign pass) with tight padding to match the object-page
 * detail + applications-list header vocabulary.
 *
 * PRESENTATIONAL ONLY. Token-only colors.
 */
export interface LaunchpadHeaderProps {
  /** Kicker line above the title (e.g. a greeting or section eyebrow). */
  greeting: string;
  /** The header title (e.g. role / section name). */
  title: string;
  /** Optional one-line summary. */
  subtitle?: string;
  /** Optional right-aligned actions (e.g. refresh / view-all buttons). */
  actions?: React.ReactNode;
  className?: string;
}

export function LaunchpadHeader({ greeting, title, subtitle, actions, className }: LaunchpadHeaderProps) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4 sm:p-5', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{greeting}</p>
          <h2 className="truncate text-xl font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
