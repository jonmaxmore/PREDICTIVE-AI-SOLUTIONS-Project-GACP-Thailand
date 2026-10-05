import Link from 'next/link';
import { ArrowUpRight, FilePlus2, CreditCard, Search, CalendarPlus } from 'lucide-react';

const iconMap: Record<string, typeof FilePlus2> = {
  'new-application': FilePlus2,
  payment: CreditCard,
  applications: Search,
  activity: CalendarPlus,
};

const accentMap: Record<string, string> = {
  'new-application': 'border-l-leaf-600',
  payment: 'border-l-amber-500',
  applications: 'border-l-blue-500',
  activity: 'border-l-violet-500',
};

interface QuickActionItem {
  key: string;
  title: string;
  hint: string;
  href: string;
}

interface QuickActionsProps {
  items: QuickActionItem[];
}

export function QuickActions({ items }: QuickActionsProps) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = iconMap[item.key] || ArrowUpRight;
        const accent = accentMap[item.key] || 'border-l-primary';
        return (
          <Link key={item.key} href={item.href} className="group no-underline">
            <div
              className={`rounded-lg border-l-[3px] bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${accent}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="text-base font-semibold text-foreground">{item.title}</p>
                </div>
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-all group-hover:bg-primary group-hover:text-primary-foreground">
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{item.hint}</p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
