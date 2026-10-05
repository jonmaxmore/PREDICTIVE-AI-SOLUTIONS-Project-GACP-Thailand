/**
 * Marketing site header — Iter 28 public site shell.
 *
 * Persistent top navigation across (marketing) route group: landing,
 * about, pricing, terms, privacy. Distinct from the in-app GovLayout
 * header that ships on /health, /provider, /admin authenticated routes.
 *
 * Renders ministry brand mark + horizontal nav links + login/register
 * CTAs. Mobile collapses nav into a simple wrapped row (no JS menu —
 * the link set is short enough to fit on a single phone-width line).
 */

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/', label: 'หน้าแรก' },
  { href: '/about', label: 'เกี่ยวกับเรา' },
  { href: '/pricing', label: 'ค่าบริการ' },
];

export function MarketingHeader() {
  const pathname = usePathname();
  // Home matches exactly; section links match their subtree so nested routes
  // (e.g. /pricing/*) still light up the parent nav item.
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <header
      className="sticky top-0 z-40 border-b border-leaf-soft/60 bg-white dark:border-primary-900/40 dark:bg-zinc-950"
      role="banner"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-600"
          aria-label="GACP Thailand หน้าแรก"
        >
          <span className="relative inline-flex h-10 w-10 items-center justify-center">
            <Image
              src="/images/gacpthai-logo.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
              priority
            />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-leaf-800 dark:text-primary-300 sm:text-base">
              GACP Thailand
            </span>
            <span className="block text-[11px] text-zinc-600 dark:text-zinc-400">
              ระบบรับรองมาตรฐานสมุนไพรไทย
            </span>
          </span>
        </Link>

        <nav aria-label="เมนูหลัก" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(href) ? 'page' : undefined}
                  className={`inline-block rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-600 ${
                    isActive(href)
                      ? 'bg-leaf-soft font-semibold text-leaf-onSoft dark:bg-primary-900/30 dark:text-primary-300'
                      // Ink from the theme token (flips under .dark) instead of a zinc
                      // pair (gacp-design-tokens: no zinc-* in code that is touched).
                      // Measured 2026-10-03 on /pricing: 10.4:1 light / 15.7:1 dark
                      // before this change (evidence/fees-from-server/round-2).
                      : 'font-medium text-foreground hover:bg-leaf-soft hover:text-leaf-onSoft dark:hover:bg-primary-900/30 dark:hover:text-primary-300'
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/auth"
            className="inline-flex items-center justify-center rounded-md border border-leaf-300 bg-white px-3 py-2 text-sm font-semibold text-leaf-onSoft transition-colors hover:bg-leaf-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700 dark:border-primary-700 dark:bg-zinc-900 dark:text-primary-200 dark:hover:bg-primary-900/30 sm:px-4"
          >
            เข้าสู่ระบบ
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center justify-center rounded-md bg-leaf-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-leaf-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700 sm:px-4"
          >
            เริ่มสมัคร
          </Link>
        </div>
      </div>

      <nav aria-label="เมนูสำรอง" className="border-t border-leaf-soft/60 bg-leaf-soft/40 dark:border-primary-900/40 dark:bg-primary-900/10 md:hidden">
        <ul className="mx-auto flex max-w-7xl flex-wrap gap-x-3 gap-y-1 px-4 py-2 text-sm">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={`inline-block rounded px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-600 ${
                  isActive(href)
                    ? 'bg-white font-bold text-primary-900 dark:bg-zinc-900 dark:text-primary-200'
                    : 'font-medium text-primary-900 hover:bg-white dark:text-primary-200 dark:hover:bg-zinc-900'
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
