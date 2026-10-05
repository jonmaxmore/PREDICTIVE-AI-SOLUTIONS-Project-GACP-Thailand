'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Globe, FileText, Shield, AlertCircle, ExternalLink,
  Plane, ClipboardCheck, Beaker, Package, Info,
} from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { FeatureGate } from '@/components/feature/feature-gate';
import { SummaryHeader } from '@/components/feature';

/* ── Types ── */
interface ExportDocInfo {
  id: string;
  title: string;
  titleEN: string;
  description: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  issuedBy: string;
  howToGet: string;
  status: 'available' | 'coming_soon' | 'manual';
  link?: string;
}

const EXPORT_DOCUMENTS: ExportDocInfo[] = [
  {
    id: 'coa',
    title: 'ใบรับรองผลการวิเคราะห์ (CoA)',
    titleEN: 'Certificate of Analysis',
    description:
      'เอกสารแสดงผลการตรวจวิเคราะห์คุณภาพสมุนไพร ทั้งทางกายภาพ เคมี และจุลชีววิทยา ออกโดยห้องปฏิบัติการที่ได้รับการรับรอง',
    icon: Beaker,
    issuedBy: 'ห้องปฏิบัติการที่ได้รับการรับรอง ISO 17025',
    howToGet: 'ส่งตัวอย่างสมุนไพรไปตรวจที่ห้องปฏิบัติการ ระบบจะเชื่อมผล Lab อัตโนมัติ',
    status: 'available',
  },
  {
    id: 'phyto',
    title: 'ใบรับรองสุขอนามัยพืช',
    titleEN: 'Phytosanitary Certificate',
    description:
      'เอกสารยืนยันว่าสินค้าเกษตรปราศจากศัตรูพืชและโรคพืช ใช้ประกอบการส่งออกสมุนไพร จำเป็นสำหรับการส่งออกทุกชนิด',
    icon: Shield,
    issuedBy: 'ระบบรับรองมาตรฐาน GACP สมุนไพร (DOA)',
    howToGet:
      'ยื่นคำขอที่สำนักงานตรวจพืช ด่านศุลกากร หรือผ่านระบบ NSW (National Single Window)',
    status: 'manual',
    link: 'https://www.doa.go.th',
  },
  {
    id: 'export_license',
    title: 'ใบอนุญาตส่งออกสมุนไพรควบคุม (ภ.ท.10)',
    titleEN: 'Controlled Herb Export License',
    description:
      'ใบอนุญาตสำหรับส่งออกสมุนไพรควบคุมตาม พ.ร.บ.สมุนไพร พ.ศ.2562 ต้องมีก่อนส่งออก',
    icon: FileText,
    issuedBy: 'ระบบรับรองมาตรฐาน GACP สมุนไพร (DTAM)',
    howToGet:
      'ยื่นคำขอ ภ.ท.10 ผ่านระบบ herbctrl.dtam.moph.go.th หรือระบบนี้ (เร็ว ๆ นี้)',
    status: 'coming_soon',
  },
  {
    id: 'origin',
    title: 'ใบรับรองแหล่งกำเนิดสินค้า',
    titleEN: 'Certificate of Origin',
    description:
      'เอกสารยืนยันแหล่งกำเนิดสินค้าสำหรับใช้สิทธิ์ลดหย่อนภาษีศุลกากรตามความตกลงทางการค้า (FTA)',
    icon: Globe,
    issuedBy: 'กรมการค้าต่างประเทศ / หอการค้าไทย',
    howToGet: 'ยื่นคำขอผ่านระบบ e-CO ของกรมการค้าต่างประเทศ',
    status: 'manual',
    link: 'https://www.dft.go.th',
  },
  {
    id: 'packing',
    title: 'รายการบรรจุหีบห่อ (Packing List)',
    titleEN: 'Packing List',
    description:
      'เอกสารแสดงรายละเอียดการบรรจุหีบห่อสินค้า ระบุจำนวน น้ำหนัก ขนาด ของแต่ละหีบห่อ',
    icon: Package,
    issuedBy: 'ผู้ส่งออก (จัดทำเอง)',
    howToGet: 'ระบบจะสร้าง Packing List อัตโนมัติจาก Lot/Batch ที่เลือกส่งออก',
    status: 'coming_soon',
  },
  {
    id: 'commercial_invoice',
    title: 'ใบกำกับสินค้า (Commercial Invoice)',
    titleEN: 'Commercial Invoice',
    description:
      'เอกสารแสดงรายการสินค้า ราคา และเงื่อนไขการค้าระหว่างผู้ซื้อและผู้ขาย',
    icon: ClipboardCheck,
    issuedBy: 'ผู้ส่งออก (จัดทำเอง)',
    howToGet: 'จัดทำตามแบบฟอร์มมาตรฐานสากล template จะเปิดให้ดาวน์โหลดเร็ว ๆ นี้',
    status: 'coming_soon',
  },
];

function ExportDocumentsContent() {
  return (
    // Wave E.2-B: SummaryHeader replaces inline header (gutter from DashboardLayout).
    // Full-width (2026-06-10): owner directive — fill the screen on PC. The empty-state
    // card below keeps its own narrow width.
    <div className="w-full space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ส่งออก"
        title="เอกสารส่งออกสมุนไพร"
        description="รวมเอกสารที่จำเป็นสำหรับการส่งออกสมุนไพรไปต่างประเทศ"
      />

      {/* Important notice */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="text-xs text-amber-700">
          <p className="font-bold">ข้อมูลสำคัญ</p>
          <p className="mt-1">
            เอกสารส่งออกบางรายการต้องขอจากหน่วยงานภายนอก
            ระบบนี้รวบรวมข้อมูลและลิงก์เพื่อช่วยให้ท่านเตรียมเอกสารได้สะดวกขึ้น
          </p>
          <p className="mt-1">
            สมุนไพรควบคุมต้องขอใบอนุญาต ภ.ท.10 ก่อนส่งออกทุกครั้ง
          </p>
        </div>
      </div>

      {/* Export flow steps */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">ขั้นตอนการส่งออก</h2>
        <div className="mt-3 flex items-start gap-3">
          {[
            { step: 1, label: 'ขอ CoA' },
            { step: 2, label: 'ขอ ภ.ท.10' },
            { step: 3, label: 'ขอ Phyto' },
            { step: 4, label: 'เตรียมเอกสาร' },
            { step: 5, label: 'ส่งออก' },
          ].map((s, idx) => (
            <div key={s.step} className="flex flex-1 flex-col items-center text-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {s.step}
              </div>
              <p className="mt-1 text-[10px] font-medium text-muted-foreground">{s.label}</p>
              {idx < 4 && (
                <div className="absolute ml-[100%] mt-4 h-px w-4 bg-border" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Document Cards */}
      <div className="space-y-3">
        {EXPORT_DOCUMENTS.map((doc, idx) => {
          const Icon = doc.icon;
          return (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">{doc.title}</h3>
                    {doc.status === 'available' ? (
                      <Badge className="rounded-full border-none bg-leaf-soft px-2 py-0 text-[10px] font-bold text-leaf-onSoft">
                        พร้อมใช้
                      </Badge>
                    ) : doc.status === 'coming_soon' ? (
                      <Badge className="rounded-full border-none bg-zinc-100 px-2 py-0 text-[10px] font-bold text-zinc-500">
                        เร็ว ๆ นี้
                      </Badge>
                    ) : (
                      <Badge className="rounded-full border-none bg-blue-100 px-2 py-0 text-[10px] font-bold text-blue-700">
                        ขอจากหน่วยงาน
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] font-medium text-primary">{doc.titleEN}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{doc.description}</p>

                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] text-muted-foreground">
                      <strong>ออกโดย:</strong> {doc.issuedBy}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      <strong>วิธีขอ:</strong> {doc.howToGet}
                    </p>
                  </div>

                  {doc.link && (
                    <a
                      href={doc.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                    >
                      เว็บไซต์หน่วยงาน
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Useful links */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div className="text-xs text-blue-700">
          <p className="font-bold">ลิงก์ที่เป็นประโยชน์</p>
          <ul className="mt-1 space-y-1">
            <li>
              <a href="https://www.customs.go.th" target="_blank" rel="noopener noreferrer" className="underline">
                กรมศุลกากร
              </a>{' '}
               พิธีการศุลกากรส่งออก
            </li>
            <li>
              <a href="https://www.nsw.go.th" target="_blank" rel="noopener noreferrer" className="underline">
                National Single Window (NSW)
              </a>{' '}
               ระบบเชื่อมโยงข้อมูลส่งออก
            </li>
            <li>
              <a href="https://www.doa.go.th" target="_blank" rel="noopener noreferrer" className="underline">
                ระบบรับรองมาตรฐาน GACP สมุนไพร
              </a>{' '}
               ใบรับรองสุขอนามัยพืช
            </li>
          </ul>
        </div>
      </div>

      {/* Back link */}
      <div className="flex gap-2">
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/health/start">กลับหน้าหลัก</Link>
        </Button>
      </div>
    </div>
  );
}

export default function ExportDocumentsPage() {
  return (
    <FeatureGate
      flag="feature.export_documents"
      fallback={
        <div className="animate-fade-in mx-auto max-w-lg space-y-6 py-16 text-center">
          <Plane className="mx-auto h-12 w-12 text-muted-foreground/30" />
          <div>
            <h1 className="text-lg font-bold text-foreground">เอกสารส่งออกสมุนไพร</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              ฟีเจอร์นี้กำลังพัฒนา จะเปิดให้ใช้งานเร็ว ๆ นี้
            </p>
          </div>
        </div>
      }
    >
      <ExportDocumentsContent />
    </FeatureGate>
  );
}
