'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Sprout, FileCheck, BarChart3, RefreshCw,
  Award, Shield, ChevronRight,
} from 'lucide-react';

import { AuthService, AuthUser } from '@/lib/services/auth-service';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/primitives/badge';
import { SummaryHeader } from '@/components/feature';
/* ── Types ── */
interface ServiceCard {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  iconBg: string;
  /** เส้นทางเมื่อคลิก */
  href: string;
  /** ต้องมี certificate ก่อนหรือไม่ */
  requiresCertificate?: boolean;
  /** badge */
  badge?: string;
}

/* ── Service Catalog — intent-based ── */
const SERVICE_CARDS: ServiceCard[] = [
  {
    id: 'gacp',
    title: 'ขอรับรองมาตรฐาน GACP',
    description: 'ยื่นคำขอรับรองมาตรฐานการเพาะปลูกและเก็บเกี่ยวสมุนไพร ตามข้อกำหนดของ GACP Thaiฯ',
    icon: Shield,
    color: 'text-leaf-700',
    iconBg: 'bg-leaf-soft',
    href: '/health/applications/new',
    badge: 'เปิดให้บริการ',
  },
  {
    id: 'planting',
    title: 'เริ่มปลูกสมุนไพร',
    description: 'บันทึกรอบการปลูก ข้อมูลแปลง พืชที่ปลูก และกิจกรรมดูแลรักษา',
    icon: Sprout,
    color: 'text-green-700',
    iconBg: 'bg-green-50',
    href: '/health/planting',
  },
  {
    id: 'tracking',
    title: 'ตรวจสอบ Track & Trace',
    description: 'ตรวจสอบ QR Code สินค้าสมุนไพร ดูข้อมูลย้อนกลับจากแหล่งผลิต',
    icon: BarChart3,
    color: 'text-blue-700',
    iconBg: 'bg-blue-50',
    href: '/health/tracking',
  },
  {
    id: 'report',
    title: 'ส่งรายงาน',
    description: 'ส่งรายงานรายเดือนตามเงื่อนไขใบรับรอง (ภ.ท.27, ภ.ท.28)',
    icon: BarChart3,
    color: 'text-violet-700',
    iconBg: 'bg-violet-50',
    href: '/health/reports',
    requiresCertificate: true,
    badge: 'เร็ว ๆ นี้',
  },
  {
    id: 'renewal',
    title: 'ต่ออายุใบรับรอง',
    description: 'ต่ออายุใบรับรอง GACP ก่อนหมดอายุ ใช้ข้อมูลจากคำขอเดิม',
    icon: RefreshCw,
    color: 'text-amber-700',
    iconBg: 'bg-amber-50',
    href: '/health/applications/renewal',
    requiresCertificate: true,
  },
];

export default function TaskRouterPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = AuthService.getUser();
    if (!u) {
      router.replace('/auth/health/login');
      return;
    }
    setUser(u as AuthUser);
    setLoading(false);
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    // Wave E.2-B: SummaryHeader replaces inline greeting header.
    // animate-fade-in + pb-20 already from DashboardLayout main.
    <div className="space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · เริ่มต้น"
        title={`สวัสดี, คุณ${user?.firstName || 'เกษตรกร'}`}
        description="คุณต้องการทำอะไรวันนี้?"
      />

      {/* Service Cards */}
      <div className="space-y-3">
        {SERVICE_CARDS.map((card, idx) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.06 }}
          >
            <Link href={card.href}>
              <div className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/20 hover:shadow-md active:scale-[0.99]">
                {/* Icon */}
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${card.iconBg} ${card.color} transition-transform group-hover:scale-110`}>
                  <card.icon className="h-6 w-6" />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground group-hover:text-primary md:text-base">
                      {card.title}
                    </h3>
                    {card.badge && (
                      <Badge className={`shrink-0 rounded-full border-none px-2 py-0 text-[10px] font-bold ${card.badge === 'เปิดให้บริการ'
                          ? 'bg-leaf-soft text-leaf-onSoft'
                          : 'bg-zinc-100 text-zinc-500'
                        }`}>
                        {card.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {card.description}
                  </p>
                </div>

                {/* Arrow */}
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Quick links */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold text-muted-foreground">
          ลิงก์ด่วน
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { label: 'คำขอของฉัน', href: '/health/applications', icon: FileCheck },
            { label: 'ใบรับรอง', href: '/health/certificates', icon: Award },
            { label: 'แบบฟอร์ม SOP', href: '/health/sop-templates', icon: FileCheck },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
