export const dynamic = 'force-dynamic';

import { ArrowRight, Package, PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { SummaryHeader } from '@/components/feature';

const trackingModes = [
  {
    key: 'batch',
    title: 'ติดตามระดับ Batch',
    description: 'ติดตามรอบปลูกและรายการเก็บเกี่ยว (Batch) ก่อนแตกเป็นล็อตบรรจุภัณฑ์',
    href: '/health/planting',
    cta: 'ไปหน้ารอบปลูก',
    icon: PackageSearch,
  },
  {
    key: 'lots',
    title: 'ติดตามระดับ Lots',
    description: 'ติดตามล็อตบรรจุภัณฑ์, พิมพ์ QR และเปิดหน้า Trace ของแต่ละล็อต',
    href: '/health/tracking/lots',
    cta: 'ไปหน้าล็อตบรรจุภัณฑ์',
    icon: Package,
  },
];

export default function TrackingLandingPage() {
  return (
    // Wave E.2-B (batch 7): SummaryHeader replaces the bespoke
    // inline header card. Outer max-w-5xl bumped to default
    // DashboardLayout container — no per-page width override.
    <div className="space-y-6" role="main">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ติดตามผลผลิต"
        title="ระบบติดตาม · Track & Trace"
        description="ระบบรองรับการติดตามทั้งแบบ Batch (รอบปลูก) และ Lots (ล็อตบรรจุภัณฑ์)"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {trackingModes.map((mode) => (
          <section key={mode.key} className="group rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-lg sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground group-hover:text-primary sm:text-lg">{mode.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{mode.description}</p>
              </div>
              <div className="rounded-xl bg-muted p-2 text-muted-foreground transition-colors duration-200" aria-hidden="true">
                <mode.icon className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <Button href={mode.href} color="green" variant="secondary" aria-label={mode.cta} className="transition-transform duration-150 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-primary">
                {mode.cta}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
