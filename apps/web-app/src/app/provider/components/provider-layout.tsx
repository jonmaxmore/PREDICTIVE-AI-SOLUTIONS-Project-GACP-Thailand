'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { visibleProviderNavItems } from '@/lib/constants';
import { ClipboardCheck } from 'lucide-react';
import { normalizeRole } from '@/lib/role-utils';
import { apiClient } from '@/lib/api/api-client';
import { cn } from '@/lib/utils';
import { moduleTabsFor } from './provider-module-tabs';

interface ProviderLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  /**
   * Opt-in: render `title`/`subtitle` as the page `<h1>` at the top of the
   * content area. Off by default because most provider pages render their own
   * heading inside `children` (receipts, work/[id], audits inspect); enabling
   * it there would produce a second h1. The newer contract-module pages
   * (standards/surveys/herbs/image-assessment) have NO in-content heading, so
   * they opt in to get a valid document heading order (WCAG 1.3.1 / 2.4.6).
   */
  heading?: boolean;
}

// X4-FIX-A NAV-1: nav visibility rules previously lived inline here as a
// private `NAV_ROLE_RULES` constant. They have been moved to
// `lib/constants.ts` (alongside `providerNavigation`) so they are
// (a) co-located with the items they gate and (b) trivially unit-testable
// without rendering. The filtering helper `visibleProviderNavItems`
// preserves the original admin-sees-all + unrestricted-by-default
// semantics — see constants.ts for the canonical rule table.

function normalizeProviderRole(role: string | undefined): string {
  return normalizeRole(role) || String(role || '').trim().toLowerCase();
}

export default function ProviderLayout({ children, title, subtitle, heading = false }: ProviderLayoutProps) {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const res = await apiClient.get<{ role?: string; canonicalRole?: string }>('/auth/provider/me');
        if (res.success && res.data) {
          setUserRole(normalizeProviderRole(res.data.canonicalRole || res.data.role));
        }
      } catch {
        // Silently fail — navbar shows all items
      }
    };
    fetchRole();
  }, []);

  const navItems = useMemo(() => {
    return visibleProviderNavItems(userRole).map(item => ({
      href: item.href,
      label: item.label,
      Icon: item.icon,
    }));
  }, [userRole]);

  // Module sub-navigation (accounting, settings). Derived from the pathname
  // here rather than drawn by a route-level `layout.tsx`, because a route
  // layout nests ABOVE the page — and this portal's chrome lives inside the
  // page, so a sub-layout put the module tabs above the global header. See
  // provider-module-tabs.ts for the full reasoning.
  const moduleTabs = useMemo(() => moduleTabsFor(pathname), [pathname]);

  // W5-C: `role` is DashboardLayoutProps domain prop, NOT ARIA role.
  // See apps/web-app/src/app/health/layout.tsx for full reasoning.
  return (
    <DashboardLayout
      // eslint-disable-next-line jsx-a11y/aria-role -- custom prop, not ARIA role
      role="provider"
      brandName="GACP Provider"
      brandIcon={ClipboardCheck}
      navItems={navItems}
      // Task 3 (W10) — DashboardLayout's officer bottom nav is
      // nav-config-driven and needs the actual canonical role (auditor /
      // document_reviewer / scheduler / account* / admin / platform_admin),
      // not just the coarse 'provider' domain flag. Reuses the role this
      // component already resolved above instead of a second
      // /auth/provider/me fetch.
      canonicalRole={userRole}
    >
      {moduleTabs ? (
        <nav aria-label={moduleTabs.ariaLabel} className="border-b bg-card">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap gap-2 px-4 py-3 md:px-6 lg:px-8">
            {moduleTabs.tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={tab.isActive ? 'page' : undefined}
                className={cn(
                  'min-h-[40px] rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  tab.isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
      {heading && title ? (
        // Same width wrapper as the contract pages' content so the h1 aligns
        // with the cards below it (DashboardLayout <main> already supplies the
        // outer gutter + max-w-7xl cap).
        <header className="mx-auto mb-2 w-full max-w-7xl px-4 pt-6 md:px-6 lg:px-8">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </header>
      ) : null}
      {children}
    </DashboardLayout>
  );
}
