'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  CheckCircle, XCircle, ArrowRight,
  Shield, AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { SummaryHeader } from '@/components/feature';
import { apiClient as api } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import { Spinner } from '@/components/ui/spinner';

/* ── Types ── */
interface ReadinessItem {
  id: string;
  label: string;
  description: string;
  ready: boolean;
  /** link ถ้ายังไม่พร้อม */
  actionHref?: string;
  actionLabel?: string;
}

interface ReadinessResult {
  ready: boolean;
  items: ReadinessItem[];
  readyCount: number;
  totalCount: number;
}

export default function ReadinessCheckPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [_error, _setError] = useState<string | null>(null);

  useEffect(() => {
    const checkReadiness = async () => {
      const user = AuthService.getUser();
      if (!user) {
        router.replace('/auth/health/login');
        return;
      }

      try {
        const res = await api.get<ReadinessResult>('/api/applications/readiness');
        if (res.data) {
          setResult(res.data);
        } else {
          // Fallback: ถ้า API ยังไม่มี ใช้ client-side check
          setResult(buildClientSideReadiness());
        }
      } catch {
        // API อาจยังไม่ได้สร้าง — ใช้ client-side fallback
        setResult(buildClientSideReadiness());
      } finally {
        setLoading(false);
      }
    };

    void checkReadiness();
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">ไม่สามารถตรวจสอบความพร้อมได้</p>
        <Button asChild variant="outline">
          <Link href="/health/start">กลับ</Link>
        </Button>
      </div>
    );
  }

  return (
    // Wave E.2-B: SummaryHeader. Full-width (PC carpet-sweep 2026-06-10);
    // animate-fade-in + pb-20 from DashboardLayout main.
    <div className="w-full space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ตรวจสอบความพร้อม"
        title="ตรวจสอบความพร้อม"
        description="ตรวจสอบว่าคุณมีข้อมูลและเอกสารครบก่อนยื่นคำขอรับรอง GACP"
      />

      {/* Progress */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">
            ความพร้อม
          </span>
          <span className={`text-sm font-bold ${result.ready ? 'text-leaf-700' : 'text-amber-600'}`}>
            {result.readyCount}/{result.totalCount} ข้อ
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <motion.div
            className={`h-full rounded-full ${result.ready ? 'bg-leaf-600' : 'bg-amber-500'}`}
            initial={{ width: 0 }}
            animate={{ width: `${(result.readyCount / result.totalCount) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        {result.items.map((item, idx) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.06 }}
            className={`rounded-xl border p-4 ${
              item.ready
                ? 'border-leaf-300 bg-leaf-soft/30'
                : 'border-amber-200 bg-amber-50/30'
            }`}
          >
            <div className="flex items-start gap-3">
              {item.ready ? (
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-leaf-700" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                {!item.ready && item.actionHref && (
                  <Link
                    href={item.actionHref}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    {item.actionLabel || 'ดำเนินการ'}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {result.ready ? (
          <Button asChild className="flex-1 gap-2 rounded-full">
            <Link href="/health/applications/new">
              <Shield className="h-4 w-4" />
              เริ่มยื่นคำขอ GACP
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="flex-1 gap-2 rounded-full">
            <Link href="/health/applications/new">
              ยื่นคำขอเลย (ข้ามรายการที่ยังไม่พร้อม)
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/health/start">กลับ</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Client-side fallback readiness check
 * ใช้เมื่อ backend API ยังไม่พร้อม — เช็กจากข้อมูลพื้นฐาน
 */
function buildClientSideReadiness(): ReadinessResult {
  // ตอนนี้ใช้ static items ก่อน — เมื่อ API พร้อมจะเรียกจาก server
  const items: ReadinessItem[] = [
    {
      id: 'profile',
      label: 'ข้อมูลโปรไฟล์ครบถ้วน',
      description: 'ชื่อ-นามสกุล, เลขบัตรประชาชน, ที่อยู่',
      ready: true, // user ลงทะเบียนแล้ว
    },
    {
      id: 'establishment',
      label: 'ลงทะเบียนสถานประกอบการ',
      description: 'มีข้อมูลสถานประกอบการและพิกัดที่ตั้ง',
      ready: false,
      actionHref: '/health/establishments/new',
      actionLabel: 'ลงทะเบียนสถานประกอบการ',
    },
    {
      id: 'farm',
      label: 'ลงทะเบียนฟาร์ม/แปลงปลูก',
      description: 'มีข้อมูลฟาร์มและแปลงปลูกสมุนไพร',
      ready: false,
      actionHref: '/health/planting',
      actionLabel: 'ลงทะเบียนแปลงปลูก',
    },
    {
      id: 'sop',
      label: 'เตรียม SOP (มาตรฐานการปฏิบัติงาน)',
      description: 'จัดทำ SOP การปลูก, เก็บเกี่ยว, ตากแห้ง, สุขลักษณะ',
      ready: false,
      actionHref: '/health/sop-templates',
      actionLabel: 'ดาวน์โหลดแบบฟอร์ม SOP',
    },
    {
      id: 'documents',
      label: 'เอกสารประกอบ',
      description: 'สำเนาบัตรประชาชน, ทะเบียนบ้าน, แผนที่สถานที่ปลูก',
      ready: false,
      actionHref: '/health/documents',
      actionLabel: 'จัดการเอกสาร',
    },
    {
      id: 'water_test',
      label: 'ผลตรวจคุณภาพน้ำ',
      description: 'รายงานผลตรวจน้ำจากห้องปฏิบัติการที่ได้รับการรับรอง',
      ready: false,
      actionHref: '/health/documents',
      actionLabel: 'อัปโหลดผลตรวจ',
    },
  ];

  const readyCount = items.filter(i => i.ready).length;

  return {
    ready: readyCount === items.length,
    items,
    readyCount,
    totalCount: items.length,
  };
}
