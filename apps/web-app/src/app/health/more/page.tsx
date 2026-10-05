'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Leaf,
  Library,
  Map as MapIcon,
  Receipt,
  Sprout,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { SummaryHeader } from '@/components/feature';
import { PageContainer } from '@/components/layout/page-system';

export const dynamic = 'force-dynamic';

interface ToolLink {
  href: string;
  title: string;
  description: string;
  Icon: typeof ClipboardList;
  /** "ก่อนยื่นคำขอ" | "หลังได้ใบรับรอง" | "อื่นๆ" */
  group: 'pre' | 'post' | 'other';
}

/**
 * Hub page for HEALTH-side features that aren't on the main 6-item nav.
 *
 * The 2026-04-30 HEALTH portal audit identified these as "orphan routes" —
 * working backend + DB but no nav surface. Rather than delete them
 * (which would lose real product capability) or surface every one in
 * the main nav (which would clutter), we group them by lifecycle stage
 * so applicants can find what they need at the right moment.
 */
const TOOLS: ToolLink[] = [
  // ── Pre-application: things the applicant prepares BEFORE submitting ──
  {
    href: '/health/site-analysis',
    title: 'การวิเคราะห์พื้นที่',
    description: 'บันทึกผลการวิเคราะห์ดิน น้ำ และสภาพแวดล้อมของแปลงปลูก',
    Icon: MapIcon,
    group: 'pre',
  },
  {
    href: '/health/training',
    title: 'บันทึกการอบรม',
    description: 'บันทึกการอบรม GACP ของผู้ปฏิบัติงาน ใช้ประกอบคำขอรับรอง',
    Icon: GraduationCap,
    group: 'pre',
  },
  {
    href: '/health/sop-templates',
    title: 'แม่แบบ SOP',
    description: 'เลือกแม่แบบ SOP มาตรฐาน เช่น การปลูก การเก็บเกี่ยว การตรวจสอบคุณภาพ',
    Icon: Library,
    group: 'pre',
  },
  {
    href: '/health/sop-builder',
    title: 'สร้าง SOP',
    description: 'กรอกฟอร์ม SOP รายแปลง บันทึกเป็น PDF เพื่อแนบใบสมัคร',
    Icon: ClipboardList,
    group: 'pre',
  },
  // ── Post-certification: regulatory compliance after the cert is issued ──
  {
    href: '/health/reports',
    title: 'รายงานรายเดือน (ภ.ท.27/28)',
    description: 'ส่งรายงานรายเดือนตามเงื่อนไขใบรับรอง ภ.ท.27, ภ.ท.28, ภ.ท.29-32',
    Icon: FileSpreadsheet,
    group: 'post',
  },
  {
    href: '/health/planting',
    title: 'รอบการปลูก',
    description: 'ติดตามรอบการปลูก เก็บเกี่ยว และผลผลิตของแต่ละแปลง',
    Icon: Sprout,
    group: 'post',
  },
  // ── Other: reference + resources ──
  {
    href: '/health/billing',
    title: 'สรุปยอดลูกค้า',
    description: 'สรุปยอดใบแจ้งหนี้ การชำระเงิน และยอดค้างชำระตามคำขอ พิมพ์เป็น A4 ได้',
    Icon: Receipt,
    group: 'other',
  },
  {
    href: '/health/establishments',
    title: 'ข้อมูลสถานประกอบการ',
    description: 'จัดการรายการแปลง/สถานประกอบการที่ลงทะเบียน',
    Icon: Leaf,
    group: 'other',
  },
  {
    href: '/health/documents',
    title: 'เอกสารแนบในระบบ',
    description: 'ค้นหาและดาวน์โหลดเอกสารที่อัปโหลดเข้าระบบ',
    Icon: FileText,
    group: 'other',
  },
];

const GROUP_LABEL: Record<ToolLink['group'], string> = {
  pre: 'ก่อนยื่นคำขอ',
  post: 'หลังได้ใบรับรอง',
  other: 'อื่น ๆ',
};

const GROUP_HINT: Record<ToolLink['group'], string> = {
  pre: 'เครื่องมือเตรียมเอกสารและข้อมูลก่อนยื่นคำขอ GACP',
  post: 'เครื่องมือสำหรับผู้ที่ได้ใบรับรองแล้ว รายงาน, รอบการปลูก',
  other: 'ข้อมูลอ้างอิงและลิงก์ที่เกี่ยวข้อง',
};

export default function HealthMorePage() {
  const router = useRouter();
  const groups: ToolLink['group'][] = ['pre', 'post', 'other'];

  return (
    // Wave E.2-B (batch 9): SummaryHeader replaces the bespoke rounded-2xl header
    // card; back button in the actions slot.
    // B1 (audit 2026-06-10): was a nested <main> at ad-hoc max-w-4xl → adopt the
    // standard PageContainer (single <main> from DashboardLayout, max-w-6xl shell).
    <PageContainer>
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · เครื่องมือ"
        title="เครื่องมือเพิ่มเติม"
        description="เครื่องมือสำหรับเตรียมความพร้อมและดูแลใบรับรอง แยกตามช่วงเวลาที่ใช้งาน"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            ย้อนกลับ
          </Button>
        }
      />

      {groups.map((group) => {
        const tools = TOOLS.filter((t) => t.group === group);
        if (tools.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <div>
              <h2 className="text-sm font-bold text-muted-foreground">
                {GROUP_LABEL[group]}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{GROUP_HINT[group]}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {tools.map((tool) => {
                const { Icon } = tool;
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="rounded-lg bg-primary/10 p-2.5 text-primary group-hover:bg-primary/15">
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground">{tool.title}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-center text-[11px] italic text-muted-foreground">
        ไม่พบเครื่องมือที่ต้องการ? ติดต่อเจ้าหน้าที่ผ่านหน้าแชทในระบบ
      </p>
    </PageContainer>
  );
}
