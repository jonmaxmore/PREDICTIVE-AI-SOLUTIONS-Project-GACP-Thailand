'use client';

/**
 * DashboardSidebar — Wave E.2-C, Step 1.
 *
 * Persistent left navigation rail. 56px collapsed / 240px expanded,
 * with role-aware nav items. This component is the visual chrome
 * only — it is NOT yet integrated into any portal layout. Step 2
 * will wire it through a sibling `SidebarLayout` behind a feature
 * flag, so the rollout can happen one portal at a time without
 * disturbing the existing top-nav `DashboardLayout`.
 *
 * Props mirror `DashboardLayout` so a future migration is a
 * one-line change:
 *
 *   <DashboardLayout navItems={items} role="health" ... />
 *   →
 *   <SidebarLayout navItems={items} role="health" ... />     // Step 2
 *
 * Design points (matching the verified plan in the Wave E memo):
 *
 * - Collapsed width 56px = the `lg` breakpoint comfortable click
 *   target (≥ 44×44 per WCAG AAA) plus 6px breathing room each side.
 *   Expanded 240px = standard sidebar width across Stripe / GitHub /
 *   Linear / Notion (240–256px is the converged range).
 *
 * - Brand block at top: 56px tall to match topbar height in the
 *   existing layout, so visiting users get a continuous-edge feel
 *   if both chrome variants ever co-exist during rollout.
 *
 * - Active row: filled brand background. Hover row: subtle
 *   white/8% overlay. Both states cover the FULL row, not just the
 *   icon, so the click target stays consistent in collapsed mode.
 *
 * - Collapse toggle pinned to the bottom — out of the way of the
 *   primary actions. Keyboard-accessible (button, focus ring).
 *
 * - Tooltip in collapsed mode: shows the full label as a `title`
 *   attribute. We deliberately do NOT add a custom Radix Tooltip
 *   here to keep the component self-contained; native browser
 *   tooltips are sufficient for the 56px-collapsed nav.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SidebarNavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string | undefined }>;
}

export interface DashboardSidebarProps {
  /** Same shape as DashboardLayout's `navItems` — direct interop. */
  navItems: SidebarNavItem[];
  /**
   * Header brand label. Stays hidden in collapsed mode. The brand
   * icon is always shown.
   */
  brandName: string;
  brandIcon: React.ComponentType<{ className?: string | undefined }>;
  /** Brand link target — usually the role's dashboard URL. */
  brandHref: string;
  /**
   * Whether the sidebar starts expanded. Default true. The user can
   * toggle via the bottom-pinned button; toggle state persists in
   * localStorage under `sidebar.expanded`.
   */
  defaultExpanded?: boolean;
  /** Optional rendered above the nav list — entity switcher slot. */
  topSlot?: React.ReactNode;
  /** Optional rendered below the nav list — user menu slot. */
  bottomSlot?: React.ReactNode;
  /** Outer className passthrough. */
  className?: string;
}

/* Same active-detection rule used by DashboardLayout — keeps both
   chromes in sync during a parallel rollout. */
function isActiveRoute(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const dashPaths = ['/health/dashboard', '/provider/dashboard', '/admin/dashboard'];
  if (dashPaths.includes(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const STORAGE_KEY = 'sidebar.expanded';

export function DashboardSidebar({
  navItems,
  brandName,
  brandIcon: BrandIcon,
  brandHref,
  defaultExpanded = true,
  topSlot,
  bottomSlot,
  className,
}: DashboardSidebarProps) {
  const pathname = usePathname();

  // Lazy init to read localStorage only once on mount. SSR-safe via
  // typeof check.
  const [expanded, setExpanded] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultExpanded;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return defaultExpanded;
  });

  // Persist user preference across sessions.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  return (
    <aside
      className={cn(
        // Sticky rail. The width transition gives a smooth fold-in;
        // overflow-hidden during the transition prevents text from
        // wrapping awkwardly while the column shrinks.
        'sticky top-0 z-40 flex h-screen flex-col overflow-hidden border-r border-border bg-[linear-gradient(180deg,hsl(153_100%_20%)_0%,hsl(153_60%_28%)_100%)] text-white shadow-lg shadow-primary/20 transition-[width] duration-200 ease-out',
        expanded ? 'w-60' : 'w-14',
        className,
      )}
      aria-label="เมนูหลัก"
    >
      {/* Brand row — 56px tall to align with the existing topbar height. */}
      <Link
        href={brandHref}
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-3 transition-colors hover:bg-white/10"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <BrandIcon className="h-5 w-5 text-white" />
        </div>
        {expanded && (
          <div className="min-w-0 flex-col">
            <span className="block truncate text-sm font-bold leading-tight tracking-tight text-white">
              {brandName}
            </span>
            <span className="block truncate text-[10px] leading-tight text-white/60">
              ระบบรับรองมาตรฐาน GACP
            </span>
          </div>
        )}
      </Link>

      {/* Optional top slot (e.g. entity switcher). Only rendered when
          provided AND expanded — collapsed mode keeps the rail tight. */}
      {expanded && topSlot ? (
        <div className="border-b border-white/10 px-3 py-2">{topSlot}</div>
      ) : null}

      {/* Nav list — stretches to fill, scrollable if items overflow. */}
      <nav className="flex-1 overflow-y-auto py-2" aria-label="ลิงก์ส่วนงาน">
        <ul className="flex flex-col gap-0.5 px-2">
          {navItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                    // 44px min height even when label is hidden,
                    // satisfies the WCAG touch-target rule.
                    'min-h-[44px]',
                    active
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-white/75 hover:bg-white/10 hover:text-white',
                  )}
                  // Native title is the accessible-and-zero-cost
                  // tooltip for the collapsed mode. B4-06 (audit 2026-06-10):
                  // also set aria-label when collapsed — `title` is a tooltip,
                  // not a guaranteed accessible name; the icon-only link needs a
                  // programmatic name when the visible label span is hidden.
                  title={!expanded ? item.label : undefined}
                  aria-label={!expanded ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <item.Icon className="h-5 w-5 shrink-0" />
                  {expanded && <span className="min-w-0 truncate">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Optional bottom slot (user menu / logout). */}
      {bottomSlot ? (
        <div className="border-t border-white/10 px-2 py-2">{bottomSlot}</div>
      ) : null}

      {/* Collapse toggle — always visible at the very bottom. */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-white/10 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
        aria-label={expanded ? 'ย่อเมนูข้าง' : 'ขยายเมนูข้าง'}
        aria-expanded={expanded}
      >
        {expanded ? (
          <>
            <ChevronLeft className="h-4 w-4" />
            <span>ย่อเมนู</span>
          </>
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
    </aside>
  );
}
