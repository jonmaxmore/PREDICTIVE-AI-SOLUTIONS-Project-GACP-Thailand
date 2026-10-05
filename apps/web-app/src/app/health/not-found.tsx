import Link from 'next/link';
import { SummaryHeader } from '@/components/feature/summary-header';

/**
 * Health portal 404 — renders inside HealthLayout (DashboardLayout)
 * so the sidebar nav stays visible. Without this file, an unknown
 * /health/* URL would bubble to the root /app/not-found.tsx and the
 * user would lose all navigation context.
 *
 * Server Component (no 'use client' — SummaryHeader has no hooks so
 * it server-renders fine; imported directly to avoid pulling
 * client-only siblings via the @/components/feature barrel).
 */
export default function HealthNotFound() {
  return (
    <div className="space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ไม่พบหน้า"
        title="ไม่พบหน้าที่ค้นหา"
        description="หน้าที่คุณกำลังมองหาอาจถูกย้าย ลบ หรือไม่เคยมีอยู่ เลือกปลายทางจากเมนูด้านล่าง"
      />

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-bold text-muted-foreground">ไปต่อ</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          <QuickLink href="/health/home" title="หน้าหลัก" hint="ศูนย์กลางการดำเนินการของคุณ" />
          <QuickLink href="/health/applications" title="คำขอของฉัน" hint="ดูและจัดการคำขอ GACP" />
          <QuickLink href="/health/payments" title="การชำระเงิน" hint="การชำระเงินและใบเสร็จ" />
          <QuickLink href="/health/certificates" title="ใบรับรอง" hint="ใบรับรองที่ออกแล้ว" />
        </ul>
      </div>
    </div>
  );
}

function QuickLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:border-primary/30 hover:shadow-md"
      >
        <span className="text-2xl text-primary/70 group-hover:text-primary">→</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
        </span>
      </Link>
    </li>
  );
}
