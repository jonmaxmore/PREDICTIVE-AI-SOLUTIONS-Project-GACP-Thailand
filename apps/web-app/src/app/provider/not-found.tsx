'use client';

import Link from 'next/link';
import ProviderLayout from './components/provider-layout';
import { SummaryHeader } from '@/components/feature/summary-header';
import { useAuth } from '@/lib/services/auth-provider';
import { providerRoleCanOpen } from '@/lib/provider-role-config';

/**
 * Provider portal 404 — wraps in ProviderLayout (which extends
 * DashboardLayout) so the role-aware sidebar nav stays visible.
 *
 * Unlike /admin and /health, the /provider segment's layout.tsx is
 * just a `data-role` setter — individual pages each wrap themselves
 * in <ProviderLayout> from `./components/provider-layout`. The
 * not-found page follows the same convention.
 *
 * Marked 'use client' because ProviderLayout is a client component
 * (calls /auth/provider/me to scope the visible nav).
 */
export default function ProviderNotFound() {
  const { user } = useAuth();
  // dashboard + work are reachable by every staff role; applications + audits are
  // role-gated — only offer them to roles that can actually enter (else the QuickLink
  // bounces, the same "เด่งไปเด่งมา" class).
  const canOpenApplications = providerRoleCanOpen(user?.role, '/provider/applications');
  const canOpenAudits = providerRoleCanOpen(user?.role, '/provider/audits');
  return (
    <ProviderLayout>
      <div className="space-y-6 p-4 sm:p-6">
        <SummaryHeader
          eyebrow="ผู้ให้บริการ · ไม่พบหน้า"
          title="ไม่พบหน้าที่ค้นหา"
          description="หน้านี้อาจถูกย้าย ลบ หรือ URL พิมพ์ผิด เลือกปลายทางจากเมนูด้านข้างหรือลิงก์ด้านล่าง"
        />

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-bold text-muted-foreground">ไปต่อ</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            <QuickLink href="/provider/home" title="หน้าหลัก" hint="สถานะคิว, KPI, ปฏิทิน" />
            <QuickLink href="/provider/work" title="คิวงานของฉัน" hint="งานที่ได้รับมอบหมาย" />
            {canOpenApplications && (
              <QuickLink href="/provider/applications" title="คำขอทั้งหมด" hint="ค้นหาและตรวจคำขอ" />
            )}
            {canOpenAudits && (
              <QuickLink href="/provider/audits" title="การตรวจประเมิน" hint="งานตรวจภาคสนาม" />
            )}
          </ul>
        </div>
      </div>
    </ProviderLayout>
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
