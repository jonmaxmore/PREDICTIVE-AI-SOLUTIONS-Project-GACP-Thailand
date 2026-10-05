'use client';

/**
 * สัญญา C05F680149 ภาคผนวก 4 ข้อ 2.1.1 — landing ของ
 * "ต้นแบบระบบวิเคราะห์มาตรฐาน GACP จำนวน 3 ระบบ" (THRSP ต้นแบบที่ 1)
 *
 * หน้านี้คือ acceptance surface: กรรมการตรวจรับเปิดหน้าเดียวเห็นครบ 3 ระบบ
 * (1.1 WHO / 1.2 Thai FDA / 1.3 ASEAN) แล้วกดเข้าสาธิตแยกระบบได้ —
 * ชื่อทุกระบบล็อกตามเอกสารแนบ A3 (naming lock,
 * สัญญา C05F680149 ข้อ 0).
 */

import Link from 'next/link';
import { Globe2, ClipboardCheck, Scale, ChevronRight } from 'lucide-react';
import ProviderLayout from '../components/provider-layout';

const SYSTEMS = [
  {
    number: '1.1',
    title: 'ระบบวิเคราะห์มาตรฐาน WHO',
    subtitle: 'WHO Guidelines on GACP',
    description: 'วิเคราะห์ข้อกำหนด WHO เปรียบเทียบกับสถานะปัจจุบันของเกษตรกร พร้อมแนะนำแนวทางการปรับปรุง',
    href: '/provider/standards/who',
    icon: Globe2,
  },
  {
    number: '1.2',
    title: 'ระบบวิเคราะห์มาตรฐาน Thai FDA',
    subtitle: 'อย. ไทย / ประกาศกรมการแพทย์แผนไทยฯ',
    description: 'วิเคราะห์ข้อกำหนดของ อย. ไทย ตรวจสอบความพร้อมการขอใบรับรอง และจัดทำ checklist อัตโนมัติ',
    href: '/provider/standards/thai-fda',
    icon: ClipboardCheck,
  },
  {
    number: '1.3',
    title: 'ระบบเปรียบเทียบมาตรฐาน ASEAN',
    subtitle: 'เปรียบเทียบ 10 ประเทศอาเซียน',
    description: 'เปรียบเทียบมาตรฐาน 10 ประเทศ วิเคราะห์ช่องว่างและโอกาส พร้อมแนะนำตลาดเป้าหมาย',
    href: '/provider/standards/asean',
    icon: Scale,
  },
];

export default function StandardsIndexPage() {
  return (
    <ProviderLayout heading title="ต้นแบบระบบวิเคราะห์มาตรฐาน GACP (3 ระบบ)" subtitle="Thai Herbal Research System Prototype — THRSP">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <p className="mb-6 text-sm text-muted-foreground">
          เครื่องมือวิเคราะห์ช่องว่าง (gap analysis) เทียบคำขอรับรองกับมาตรฐาน 3 ระบบ
          ตามข้อเสนอโครงการ เลือกระบบที่ต้องการด้านล่าง
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {SYSTEMS.map((system) => {
            const Icon = system.icon;
            return (
              <Link
                key={system.number}
                href={system.href}
                className="group rounded-lg border border-border bg-card p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <div className="text-xs text-muted-foreground">ระบบที่ {system.number}</div>
                    <div className="font-semibold">{system.title}</div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{system.description}</p>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
                  เปิดระบบ
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </ProviderLayout>
  );
}
