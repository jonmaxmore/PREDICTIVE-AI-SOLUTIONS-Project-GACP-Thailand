'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin/dashboard', label: 'รายงาน' },
  { href: '/admin/organizations', label: 'องค์กร (Tenants)' },
  { href: '/admin/users', label: 'ผู้ใช้งาน' },
  { href: '/admin/audit-log', label: 'บันทึกการใช้งาน (Audit Log)' },
  { href: '/admin/planting', label: 'การปลูกและล็อต' },
  { href: '/admin/communication', label: 'ศูนย์สื่อสาร' },
  { href: '/admin/settings', label: 'ตั้งค่าระบบ' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Single width standard (2026-06-11): owner directive — all three portals share ONE
  // container width (max-w-7xl, 1280px, centered) so switching pages never makes the
  // layout jump. Supersedes the 2026-06-10 full-width pass (which left pages with their
  // own caps looking inconsistent). Sidebar 260px + content within the centered cap.
  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-[260px_minmax(0,1fr)] gap-5 px-4 py-5 max-md:grid-cols-1 md:px-6 lg:px-8">
      {/* Mobile horizontal nav (md and below) */}
      <nav className="flex gap-2 overflow-x-auto pb-2 md:hidden">
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop sidebar */}
      <aside className="max-md:hidden">
        <div className="shell-surface sticky top-[92px] p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold text-muted-foreground">คอนโซลผู้ดูแลระบบ</p>
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = pathname?.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={cn('shell-nav-item', isActive && 'shell-nav-item-active')}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <p className="mt-4 rounded-2xl bg-muted/55 px-3 py-3 text-xs text-muted-foreground">
            ศูนย์จัดการผู้ใช้ สิทธิ์ และการกำกับงานภายในระบบสำนักงาน
          </p>
        </div>
      </aside>

      <section className="space-y-4">
        {/* X5-FIX-D H-10: section banner — DEMOTED from <h1> to a
            banner-role <div> + <p> so per-page <PageToolbar><h1>
            wins. Previously ADMIN pages emitted 2 <h1>s (this label +
            PageToolbar's title) failing WCAG 2.4.6 / axe-core's
            page-has-heading-one with multiple-h1. */}
        <div
          className="shell-surface px-5 py-4 sm:px-6"
          role="banner"
          aria-label="ระบบบริหารจัดการ"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-muted-foreground">พื้นที่งานผู้ดูแลระบบ</p>
              <p className="truncate text-lg font-semibold text-foreground">ระบบบริหารจัดการ</p>
              <p className="mt-1 text-sm text-muted-foreground">จัดการโครงสร้างผู้ใช้ สิทธิ์ และการตั้งค่าระบบกลาง</p>
            </div>
            <div className="hidden items-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground md:flex">เจ้าหน้าที่ผู้ดูแลระบบ</div>
          </div>
        </div>
        <main>{children}</main>
      </section>
    </div>
  );
}
