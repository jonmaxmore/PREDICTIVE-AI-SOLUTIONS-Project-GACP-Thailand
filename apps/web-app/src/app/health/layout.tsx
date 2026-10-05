'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { healthNavigation } from '@/lib/constants';
import { Leaf } from 'lucide-react';

export default function HealthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWizardFlow = pathname?.startsWith('/health/applications/new');

  const navItems = useMemo(() => {
    return healthNavigation.map(item => ({
      href: item.href,
      label: item.label,
      Icon: item.icon
    }));
  }, []);

  if (isWizardFlow) {
    return (
      <div data-role="health" className="min-h-screen bg-[hsl(var(--background))]">
        {children}
      </div>
    );
  }

  // W5-C: `role` here is the DashboardLayoutProps domain prop (typed
  // union 'health' | 'provider'), NOT the WAI-ARIA `role` attribute.
  // jsx-a11y/aria-role cannot distinguish a custom-component prop from
  // a DOM role attribute. Renaming the prop has 21-file blast radius
  // beyond W5-C scope; documented for post-cutover refactor.
  // Task 1 (D1/D2, W10) — /health/more already renders its own "ย้อนกลับ"
  // back button in the exact slot the shell's BackHomeCrumb would occupy
  // (see health/more/page.tsx's SummaryHeader `actions`); opting it out
  // here avoids stacking two back controls on that one page. Inventory of
  // every OTHER page carrying some kind of "back" control was checked
  // during this task (workspaces/new, workspaces/[slug]/members,
  // establishments/[id], sop-builder, etc.) — those all go "back to a
  // list/related page", a different destination than "back home", so
  // they keep both (hierarchical, not duplicate) and are not listed here.
  const hideBackHomeCrumb = pathname === '/health/more';

  return (
    <DashboardLayout
      // eslint-disable-next-line jsx-a11y/aria-role -- custom prop, not ARIA role
      role="health"
      brandName="GACP Platform"
      brandIcon={Leaf}
      navItems={navItems}
      hideBackHomeCrumb={hideBackHomeCrumb}
    >
      {children}
    </DashboardLayout>
  );
}
