'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { SimpleGrid } from '@/components/ui/layout-utils';
import { Icons } from '@/components/ui/icons';

/**
 * Hero + process header of the planting-cycle detail screen.
 *
 * The 'สร้างรายต้น' and 'ยืนยันปลูกแบบกลุ่ม' buttons are GONE, and so are
 * the 'รายต้นทั้งหมด' / 'โควตาคงเหลือ' tiles: R8
 * (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so there is no unit count to show and
 * no unit quota to spend. The tiles now report the cycle's own numbers —
 * the planned plant count the farmer typed, activities logged, plot QRs
 * ready, lots produced.
 *
 * The PlantingStatusOverview panel is GONE too. Four of its five notices
 * (legacy unit data, over-plan units, unassigned units, unit-vs-plan
 * integrity) reported per-plant reconciliation that no longer happens;
 * the fifth said the cycle has no usable certificate, which the hero
 * badge and the readiness checklist already say. A collapsible
 * severity-grouped panel that can only ever hold one duplicated row is
 * scaffolding, so the certificate warning is now a plain alert.
 */

interface ProcessStep {
  key: string;
  title: string;
  detail: string;
  status: string;
}

interface ProcessStatusMeta {
  [key: string]: {
    color: string;
    label: string;
  };
}

interface CycleDetailHeaderData {
  id: string;
  cycleName: string;
  farm?: {
    farmName?: string;
  };
  plotCount: number;
  totalAreaSqm: number;
  plannedPlantCount: number;
  status?: string;
  activitySummary?: {
    total?: number;
  };
  traceSummary?: {
    batchCount?: number;
    lotCount?: number;
  };
}

interface PlantingCycleDetailHeaderBlockProps {
  router: { push: (href: string) => void };
  statusMeta: { color: string; label: string };
  cycle: CycleDetailHeaderData;
  submittingPlotQr: boolean;
  handleGeneratePlotQrs: () => void;
  canHarvest: boolean;
  openHarvestModal: () => void;
  /** @deprecated v3.5.2 — Quick Tabs duplicate bar removed; tab control now lives only in client-view.tsx Tabs.List. */
  activeTab?: string;
  /** @deprecated v3.5.2 — see activeTab. */
  setActiveTab?: (tab: string) => void;
  runtimeNotice: string | null | undefined;
  toPlantingUserMessage: (notice: string | null | undefined) => string;
  hasActiveCertificate: boolean;
  processSteps: ProcessStep[];
  PROCESS_STATUS_META: ProcessStatusMeta;
  activities: unknown[];
  plotQrReadyCount: number;
}

export function PlantingCycleDetailHeaderBlock({
  router,
  statusMeta,
  cycle,
  submittingPlotQr,
  handleGeneratePlotQrs,
  canHarvest,
  openHarvestModal,
  activeTab: _activeTab,
  setActiveTab: _setActiveTab,
  runtimeNotice,
  toPlantingUserMessage,
  hasActiveCertificate,
  processSteps,
  PROCESS_STATUS_META,
  activities,
  plotQrReadyCount,
}: PlantingCycleDetailHeaderBlockProps) {
  return (
    <>
      <div className="hero-panel relative overflow-hidden px-5 py-6 sm:px-6 sm:py-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          aria-hidden
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />

        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flow-stack-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="white"
                size="compact-sm"
                onClick={() => router.push('/health/planting')}
                leftSection={<Icons.ArrowLeft size={14} />}
              >
                กลับ
              </Button>
              <Badge color={statusMeta.color}>{statusMeta.label}</Badge>
              {!hasActiveCertificate ? <Badge tone="warning">ยังไม่ผูกใบรับรองที่ใช้งานได้</Badge> : null}
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-primary-foreground">{cycle.cycleName}</h2>
              <p className="mt-1 text-sm text-primary-foreground/80">
                {cycle.farm?.farmName || '-'} • {cycle.plotCount.toLocaleString('th-TH')} แปลง •{' '}
                {Math.round(cycle.totalAreaSqm).toLocaleString('th-TH')} ตร.ม.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
            <Button href={`/health/planting/${cycle.id}/edit`} variant="light" size="sm" leftSection={<Icons.Edit size={14} />}>
              แก้ไขรอบปลูก
            </Button>
            <Button href={`/health/planting/${cycle.id}/activities`} variant="light" size="sm" leftSection={<Icons.Calendar size={14} />}>
              บันทึกกิจกรรม
            </Button>
            <Button variant="light" size="sm" loading={submittingPlotQr} onClick={handleGeneratePlotQrs} leftSection={<Icons.QrCode size={14} />}>
              รีเฟรช QR
            </Button>
            <Button variant="filled" size="sm" disabled={!canHarvest} onClick={openHarvestModal} leftSection={<Icons.Package size={14} />}>
              เก็บเกี่ยว/สร้างลอต
            </Button>
          </div>
        </div>

        <div className="relative z-10 mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-white/20 bg-white/15 p-3">
            <p className="text-xs text-primary-foreground/80">จำนวนต้นตามแผน</p>
            <p className="mt-1 text-2xl font-semibold text-primary-foreground">{cycle.plannedPlantCount.toLocaleString('th-TH')}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/15 p-3">
            <p className="text-xs text-primary-foreground/80">กิจกรรมที่บันทึก</p>
            <p className="mt-1 text-2xl font-semibold text-primary-foreground">{(cycle.activitySummary?.total || activities.length).toLocaleString('th-TH')}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/15 p-3">
            <p className="text-xs text-primary-foreground/80">QR พร้อมใช้</p>
            <p className="mt-1 text-2xl font-semibold text-primary-foreground">{plotQrReadyCount.toLocaleString('th-TH')} / {cycle.plotCount.toLocaleString('th-TH')}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/15 p-3">
            <p className="text-xs text-primary-foreground/80">ลอตที่สร้างแล้ว</p>
            <p className="mt-1 text-2xl font-semibold text-primary-foreground">{Number(cycle.traceSummary?.lotCount || 0).toLocaleString('th-TH')}</p>
          </div>
        </div>
      </div>

      {runtimeNotice ? (
        <Alert color="yellow" icon={<Icons.Warning size={16} />} title="แจ้งเตือนการทำงาน">
          {toPlantingUserMessage(runtimeNotice)}
        </Alert>
      ) : null}

      {!hasActiveCertificate ? (
        <Alert color="yellow" icon={<Icons.Warning size={16} />} title="ยังไม่พร้อมดำเนินการรอบปลูก">
          รอบปลูกนี้ยังไม่ผูกใบรับรองที่ใช้งานได้ คุณจึงยังบันทึกเก็บเกี่ยวและสร้างลอตไม่ได้
        </Alert>
      ) : null}

      {/*
        Phase A5 step 9 (v3.5.2 — 2026-04-29): consolidation per RFC §9.
        The previous header had a decorative "Quick Tabs" button bar that
        DUPLICATED the real Tabs.List rendered in client-view.tsx; it is
        deleted and that Tabs.List is the only navigation entry point.
        The process-status panel below keeps its content but drops the
        redundant "พร้อมเริ่มงาน / ต้องมีใบรับรอง" badge (already shown in
        the hero row + duplicated by the certificate alert above).
       */}
      <div className="surface-panel p-4 sm:p-5">
        <p className="mb-3 text-sm font-semibold text-foreground">สถานะขั้นตอนการทำงานของรอบปลูก</p>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          {processSteps.map((step) => {
            const meta = PROCESS_STATUS_META[step.status] ?? { color: 'gray', label: step.status };
            return (
              <div key={step.key} className="group-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{step.title}</p>
                  <Badge color={meta.color} size="xs">
                    {meta.label}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
              </div>
            );
          })}
        </SimpleGrid>
      </div>
    </>
  );
}
