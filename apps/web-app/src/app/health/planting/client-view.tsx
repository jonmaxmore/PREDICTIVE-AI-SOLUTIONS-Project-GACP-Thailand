'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Plus,
  ChevronRight,
  History,
  AlertCircle,
  Leaf,
  UserPlus,
} from 'lucide-react';

import { EmptyState, SummaryHeader } from '@/components/feature';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';

import { plantingService, type PlantingCycleSummary } from '@/lib/services/planting-service';

import { PageSkeleton } from '@/components/ui/page-skeleton';

const statusLabelMap: Record<string, string> = {
  PLANNING: 'วางแผน',
  PLANTED: 'ปลูกแล้ว',
  GROWING: 'กำลังเติบโต',
  READY_HARVEST: 'พร้อมเก็บเกี่ยว',
  HARVESTED: 'เก็บเกี่ยวแล้ว',
  COMPLETED: 'ปิดรอบแล้ว',
};

// ui_kit reskin (Wave 3, 2026-06-09): status chips become pills with a small
// leading colored dot (dot + word), matching the ref + the verified
// applications/dashboard reskins. Tones map to the friendly tokens
// (slate / sky / emerald / amber / indigo).
const statusChipMap: Record<string, { bg: string; text: string; dot: string }> = {
  PLANNING: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  PLANTED: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  GROWING: { bg: 'bg-leaf-soft', text: 'text-leaf-700', dot: 'bg-leaf' },
  READY_HARVEST: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  HARVESTED: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  COMPLETED: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
};

function getProgress(status: string): number {
  const order = ['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST', 'HARVESTED', 'COMPLETED'];
  const index = order.indexOf(String(status || '').toUpperCase());
  return Math.max(10, ((index + 1) / order.length) * 100);
}

export default function HealthPlantingDashboardPage() {
  const router = useRouter();
  const [cycles, setCycles] = useState<PlantingCycleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    // Load cycles directly — no farmId gate
    plantingService.getMyCycles()
      .then(res => {
        if (res.success && res.data) {
          setCycles(res.data);
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const filteredCycles = useMemo(() => {
    if (filter === 'ALL') return cycles;
    return cycles.filter(c => c.status === filter);
  }, [cycles, filter]);

  if (loading) return <PageSkeleton type="list" />;

  return (
    // ui_kit reskin (Wave 3, 2026-06-09): SummaryHeader canonical card +
    // leaf-active filter pills + cycle cards restyled to the friendly
    // ui_kit (leaf-icon avatar row, dot+word status chips, leaf progress
    // bar on a mint track). Data/i18n/logic unchanged — presentation only.
    <div className="space-y-8">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · การปลูก"
        title="การปลูกของฉัน"
        description="ติดตามและบันทึกกิจกรรมในฟาร์มของคุณให้ได้มาตรฐาน GACP"
        metrics={[
          { label: 'รอบทั้งหมด', value: cycles.length.toLocaleString('th-TH') },
        ]}
        actions={
          <Button asChild variant="primary" size="lg">
            <Link href="/health/planting/new" className="flex items-center gap-2 no-underline">
              <Plus className="h-5 w-5" />
              เริ่มรอบการปลูกใหม่
            </Link>
          </Button>
        }
      />

      {/* W8 personal-workspace-team (item 1) — a person standing in the
          planting flow thinking "let my worker record this instead of me"
          should not have to go browsing nav tiles to find team management.
          Secondary-tier affordance (not a primary tile — N7 stays at 6),
          worded for the operator's case: hiring help to record planting /
          harvest without sharing a login. */}
      <Link
        href="/health/workspaces"
        className="flex items-center justify-between gap-3 rounded-xl border border-primary-100 bg-mint-soft/60 px-4 py-3 text-sm no-underline transition-colors hover:bg-mint-soft"
      >
        <span className="flex items-center gap-2 text-foreground">
          <UserPlus className="h-4 w-4 shrink-0 text-leaf-700" />
          มีคนช่วยดูแลแปลง? เชิญให้บันทึกการปลูก/เก็บเกี่ยวแทนคุณได้ที่นี่
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-leaf-700" />
      </Link>

      {/* Filter Tabs — leaf-active pills (ui_kit reskin). */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-2">
        {['ALL', 'GROWING', 'READY_HARVEST', 'COMPLETED'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`min-h-[44px] whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${filter === f
                ? 'bg-leaf text-white shadow-leaf-btn'
                : 'border border-primary-100 bg-card text-muted-foreground hover:bg-mint-soft'
              }`}
          >
            {f === 'ALL' ? 'ทั้งหมด' : statusLabelMap[f] || f}
          </button>
        ))}
      </div>

      {cycles.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <EmptyState
            icon={Leaf}
            title="ยังไม่มีรอบการปลูก"
            hint="เริ่มต้นบันทึกก้าวแรกของการปลูกสมุนไพรคุณภาพ เพื่อขอรับใบรับรองมาตรฐาน GACP"
            action={<Button asChild variant="primary"><Link href="/health/planting/new" className="no-underline">สร้างรอบการปลูกครั้งแรก</Link></Button>}
          />
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2">
          {filteredCycles.map((cycle, idx) => (
            <motion.div
              key={cycle.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/health/planting/${cycle.id}`} className="group block h-full no-underline">
                <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-leaf-card-hover group-hover:-translate-y-1">
                  <CardContent className="p-6 sm:p-7">
                    <div className="mb-6 flex items-start justify-between gap-3">
                      {/* Leaf-icon avatar row (verified ui_kit list pattern). */}
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                          <Leaf className="h-[18px] w-[18px]" />
                        </span>
                        <div className="min-w-0 space-y-1.5">
                          {(() => {
                            const chip = statusChipMap[cycle.status] || statusChipMap.PLANNING || { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
                            return (
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${chip.bg} ${chip.text}`}>
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${chip.dot}`} />
                                {statusLabelMap[cycle.status] || cycle.status}
                              </span>
                            );
                          })()}
                          <h3 className="truncate text-lg font-bold text-foreground">
                            {cycle.plantSpecies?.nameTH || 'ไม่ระบุสายพันธุ์'}
                          </h3>
                          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <History className="h-3.5 w-3.5" />
                            {cycle.plotCount} แปลง • {cycle.plannedPlantCount} ต้น
                          </p>
                        </div>
                      </div>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mint-soft text-leaf-700">
                        <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>

                    <div className="space-y-4">
                      {/* Progress Bar — friendly leaf fill on a mint track. */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                          <span>ความคืบหน้า</span>
                          <span className="tabular-nums">{Math.round(getProgress(cycle.status))}%</span>
                        </div>
                        <div className="h-[7px] w-full overflow-hidden rounded-full bg-mint-bg">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${getProgress(cycle.status)}%` }}
                            className={`h-full rounded-full ${cycle.status === 'READY_HARVEST' ? 'bg-amber-400' : 'bg-leaf'
                              }`}
                          />
                        </div>
                      </div>

                      {/* Footer Info */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-semibold text-muted-foreground">เริ่มปลูก</span>
                            <span className="text-sm font-medium tabular-nums text-foreground">{new Date(cycle.startDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                          </div>
                          <div className="h-8 w-px bg-mint-bg" />
                          <div className="flex flex-col">
                            <span className="text-[11px] font-semibold text-muted-foreground">คาดว่าเก็บเกี่ยว</span>
                            <span className="text-sm font-medium tabular-nums text-leaf-700">
                              {cycle.expectedHarvestDate ? new Date(cycle.expectedHarvestDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : 'ยังไม่กำหนด'}
                            </span>
                          </div>
                        </div>

                        {cycle.status === 'READY_HARVEST' && (
                          <div className="flex animate-pulse items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                            <AlertCircle className="h-3 w-3" />
                            ถึงเวลาเก็บเกี่ยว
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
