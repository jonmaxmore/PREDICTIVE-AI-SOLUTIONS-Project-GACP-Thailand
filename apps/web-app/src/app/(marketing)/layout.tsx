/**
 * (marketing) route group layout — Iter 28 public marketing site.
 *
 * Wraps the landing page, about, pricing, terms, and privacy pages with
 * the MarketingHeader and the shared GovLayout Footer. This is the
 * unauthenticated, SEO-indexed public surface — distinct from the
 * authenticated GovLayout shell used on /health, /provider, /admin.
 *
 * The route group `(marketing)` does NOT add a URL segment, so
 * (marketing)/page.tsx maps to `/`, (marketing)/about/page.tsx maps to
 * `/about`, etc.
 */

import type { Metadata } from 'next';
import { MarketingHeader } from '@/components/marketing/marketing-header';
import { Footer } from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: {
    template: '%s | GACP Thailand',
    default: 'GACP Thailand ระบบรับรองมาตรฐานสมุนไพรไทย',
  },
  description:
    'แพลตฟอร์มออนไลน์เพื่อยื่นขอรับรองมาตรฐาน GACP สำหรับเกษตรกรไทย ภายใต้กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
  alternates: {
    canonical: 'https://gacpth.com',
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <MarketingHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
