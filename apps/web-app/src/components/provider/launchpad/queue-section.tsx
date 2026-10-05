import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * QueueSection — titled launchpad section wrapping a dense queue
 * list/table (B1).
 *
 * A hairline `bg-card` panel with a compact section header: a plain
 * sentence-case label (never uppercase/tracked — the titles are Thai),
 * an optional count chip, and an optional right-aligned action (e.g. a
 * "ดูทั้งหมด" link). The body renders whatever queue content the caller
 * passes (a `DataTable`, a list, etc.).
 *
 * PRESENTATIONAL ONLY. Token-only colors. Reusable across the role
 * queues (the canonical launchpad the other role dashboards copy).
 */
export interface QueueSectionProps {
  /** Section title. */
  title: string;
  /** Optional count chip shown next to the title. */
  count?: number;
  /** Optional right-aligned action (e.g. a "view all" link or filter controls). */
  action?: React.ReactNode;
  /** Optional leading icon for the title. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Optional className on the body wrapper. */
  bodyClassName?: string;
}

export function QueueSection({
  title,
  count,
  action,
  icon,
  children,
  className,
  bodyClassName,
}: QueueSectionProps) {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="text-muted-foreground" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {typeof count === 'number' ? (
            <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}
