import Link from 'next/link';
import { SummaryHeader } from '@/components/feature/summary-header';

/**
 * Admin portal 404 — renders inside admin/layout.tsx so the admin
 * sidebar stays visible. Mirrors health/not-found.tsx but with
 * admin-specific quick links.
 */
export default function AdminNotFound() {
  return (
    <div className="space-y-6">
      <SummaryHeader
        eyebrow="ผู้ดูแลระบบ · ไม่พบหน้า"
        title="ไม่พบหน้าที่ค้นหา"
        description="หน้านี้อาจถูกย้าย ลบ หรือ URL พิมพ์ผิด ใช้เมนูด้านข้างหรือเลือกปลายทางที่ใช้บ่อย"
      />

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-bold text-muted-foreground">ไปต่อ</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          <QuickLink href="/admin/dashboard" title="รายงาน" hint="KPI, คิวงาน, รายได้" />
          <QuickLink href="/admin/organizations" title="องค์กร (Tenants)" hint="จัดการ tenant ในระบบ" />
          <QuickLink href="/admin/communication" title="ศูนย์การสื่อสาร" hint="ส่งประกาศและการแจ้งเตือน" />
          <QuickLink href="/admin/settings" title="ตั้งค่าระบบ" hint="Feature flags + การจัดการสถานะ" />
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
