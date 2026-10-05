import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export interface BackHomeCrumbProps {
  /**
   * Thai label of the page being viewed, shown after the "/" separator.
   * Optional: the shell (DashboardLayout) auto-fills this from nav-config
   * (`findNavLabelForPath`) and not every pathname matches a nav item —
   * when it doesn't, the crumb still renders the "← หน้าหลัก" link alone.
   */
  current?: string;
  /** Path the "หน้าหลัก" link returns to — the role's tile-home page. */
  homePath: string;
}

/**
 * BackHomeCrumb — boxed "← หน้าหลัก" link + "/" + current page name.
 *
 * Every inner page under the hub-and-spoke redesign renders this in place
 * of the retired top-bar menu row (Task 3, tile-home-redesign N2/N7): the
 * slim bar no longer carries menu links, so getting back to the tile grid
 * goes through this per-page breadcrumb instead.
 */
export function BackHomeCrumb({ current, homePath }: BackHomeCrumbProps) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href={homePath}
        className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-leaf-700 transition-colors hover:bg-muted/40"
      >
        <ArrowLeft className="h-[17px] w-[17px]" aria-hidden="true" focusable="false" />
        หน้าหลัก
      </Link>
      {current ? (
        <>
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="text-sm text-muted-foreground">{current}</span>
        </>
      ) : null}
    </div>
  );
}

export default BackHomeCrumb;
