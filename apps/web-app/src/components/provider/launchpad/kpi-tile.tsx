import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * KpiTile — quiet dashboard metric tile.
 *
 * A calm, legible metric card: a small muted label, a large
 * `tabular-nums` value, an optional `hint` subtext, and an optional
 * leading icon. Readability-first (minimal redesign, owner directive):
 * the shell is a plain hairline-bordered white card with NO coloured
 * left accent bar and NO status dot — those read as "over-designed" when
 * every tile carries one. Urgency still lands where it matters: the
 * `warning` and `danger` tones tint the leading ICON only (amber / rose),
 * so an at-risk SLA tile is scannable without turning the whole grid into
 * a wall of coloured stripes. All other tones stay fully neutral.
 *
 * When `href` is supplied the whole tile is a Next.js `Link` with a
 * subtle hover lift + a keyboard focus ring (a11y). The visual shell is
 * shared between the static and link variants so they stay identical.
 *
 * PRESENTATIONAL ONLY — no data fetching. Token-only colors (the
 * `gacp/no-raw-color` rule forbids raw hex).
 */

export type KpiTileTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

// tone → leading-icon color. Only the two urgency tones tint; everything
// else stays muted so the grid reads as one calm surface. The icon is
// decorative (aria-hidden), so tinting carries no contrast obligation.
const TONE_ICON_CLASS: Record<KpiTileTone, string> = {
  warning: 'text-warning',
  danger: 'text-destructive',
  success: 'text-muted-foreground',
  info: 'text-muted-foreground',
  primary: 'text-muted-foreground',
  neutral: 'text-muted-foreground',
};

export interface KpiTileProps {
  /** Small UPPERCASE muted label. */
  label: string;
  /** The headline value — rendered large with `tabular-nums`. */
  value: React.ReactNode;
  /** Optional semantic tone accent. */
  tone?: KpiTileTone;
  /** Optional subtext under the value. */
  hint?: string;
  /** When set, the whole tile becomes a Link with a hover lift. */
  href?: string;
  /** Optional leading icon (lucide). */
  icon?: LucideIcon;
  /** Optional extra className on the tile shell. */
  className?: string;
}

export function KpiTile({ label, value, tone, hint, href, icon: Icon, className }: KpiTileProps) {
  const iconToneClass = tone ? TONE_ICON_CLASS[tone] : 'text-muted-foreground';

  const shell = cn(
    'group flex min-h-[6.5rem] flex-col justify-between rounded-xl border border-border bg-card p-4',
    href
      ? 'transition hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
      : null,
    className,
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        {Icon ? (
          <Icon className={cn('h-4 w-4 shrink-0', iconToneClass)} aria-hidden="true" focusable="false" />
        ) : null}
      </div>
      <div className="mt-2">
        <p className="text-3xl font-bold tabular-nums leading-none text-foreground">
          {value}
        </p>
        {hint ? <p className="mt-1.5 text-[11px] font-medium leading-tight text-muted-foreground">{hint}</p> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {content}
      </Link>
    );
  }

  return <div className={shell}>{content}</div>;
}
