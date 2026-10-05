import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return <div className={cn('ds-container ds-page', className)}>{children}</div>;
}

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (!items.length) return null;

  return (
    <ol className={cn('ds-breadcrumb', className)} aria-label="เส้นทางหน้าปัจจุบัน">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`} className="inline-flex items-center gap-2">
          {index > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" /> : null}
          {item.href ? (
            <a href={item.href} className="font-medium text-muted-foreground no-underline transition hover:text-foreground">
              {item.label}
            </a>
          ) : (
            <span className="font-semibold text-foreground">{item.label}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('ds-page-header', className)}>
      <div className="min-w-0 flex-1">
        {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} className="mb-2" /> : null}
        <h1 className="ds-page-header-title">{title}</h1>
        {subtitle ? <p className="ds-page-header-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

interface SectionHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn('ds-section-header', className)}>
      <div className="min-w-0 flex-1">
        <h2 className="ds-section-title">{title}</h2>
        {description ? <p className="ds-section-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

interface ActionBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export function ActionBar({ left, right, className }: ActionBarProps) {
  return (
    <div className={cn('ds-action-bar', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{left}</div>
      <div className="flex flex-wrap items-center gap-2">{right}</div>
    </div>
  );
}

interface SectionGridProps {
  columns?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}

export function SectionGrid({ columns = 2, children, className }: SectionGridProps) {
  return <div className={cn(columns === 3 ? 'ds-grid-3' : 'ds-grid-2', className)}>{children}</div>;
}
