import { cn } from '@/lib/utils';

interface SummaryMetric {
  label: string;
  value: string;
  icon?: string;
}

interface SummaryHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  metrics?: SummaryMetric[];
  actions?: React.ReactNode;
  className?: string;
}

export function SummaryHeader({ eyebrow, title, description, metrics, actions, className }: SummaryHeaderProps) {
  /* Detect a dark background (the gov-gradient hero variant used by some
     provider dashboards) to swap text colors automatically. */
  const isDark = className?.includes('gov-gradient');

  return (
    <section className={cn('rounded-xl border border-border bg-card p-6', className)}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl space-y-2">
          {/* Plain section label — not an uppercase, tracked "eyebrow kicker"
              pill, and no positive letter-spacing (the label is often Thai,
              where tracking breaks glyph clusters). Minimal-redesign pass:
              the label is muted, not accent-coloured — the colour carried no
              information that the words don't. */}
          <p className={cn('text-xs', isDark ? 'text-white/80' : 'text-muted-foreground')}>
            {eyebrow}
          </p>
          <h2 className={cn('text-2xl font-semibold', isDark ? 'text-white' : 'text-foreground')}>
            {title}
          </h2>
          <p className={cn('max-w-2xl text-sm leading-relaxed', isDark ? 'text-white/70' : 'text-muted-foreground')}>
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">{actions}</div>
        ) : null}
      </div>

      {metrics && metrics.length > 0 ? (
        /* A restrained stat strip: distinct columns separated by spacing and a
           single hairline — not a grid of identical boxed metric tiles. */
        <div className={cn('mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t pt-5', isDark ? 'border-white/20' : 'border-border')}>
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-[5rem]">
              <p className={cn('text-2xl font-semibold tabular-nums', isDark ? 'text-white' : 'text-foreground')}>
                {metric.value}
              </p>
              <p className={cn('mt-0.5 text-xs', isDark ? 'text-white/70' : 'text-muted-foreground')}>
                {metric.label}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
