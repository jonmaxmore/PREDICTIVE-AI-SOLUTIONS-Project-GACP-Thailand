import { useMemo } from 'react';
import { type ProcessStatus } from './planting-cycle-detail-page-config';

/**
 * Derived state for the planting-cycle detail screen.
 *
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently: nothing here reads, counts, groups or
 * filters PlantUnit rows any more. The chain this screen shows is
 * แปลง → รอบปลูก → รุ่นเก็บเกี่ยว → ลอต, and "จำนวนต้น" survives only as
 * plannedPlantCount — a number the farmer typed on the cycle, never a set
 * of tracked units. That is why perPlotProgress has no "current" count:
 * there is no longer anything that counts plants in the field, and a 0
 * would read as "measured and empty".
 */

interface CyclePlot {
  cyclePlotId: string;
  name: string;
  solarSystem?: string;
  plannedPlantCount?: number;
}

interface CycleSummary {
  total?: number;
}

interface TraceSummary {
  lotCount?: number;
}

interface PlantingCycleDetail {
  traceSummary?: TraceSummary;
  plotCount?: number;
  activitySummary?: CycleSummary;
  plots?: CyclePlot[];
}

interface ActivityRecord {
  id: string;
}

interface UsePlantingCycleDetailDerivedParams {
  isCycleClosed: boolean;
  hasActiveCertificate: boolean;
  cycle?: PlantingCycleDetail | null;
  activities: ActivityRecord[];
  plotQrReadyCount: number;
  canHarvest: boolean;
}

export function usePlantingCycleDetailDerived({
  isCycleClosed,
  hasActiveCertificate,
  cycle,
  activities,
  plotQrReadyCount,
  canHarvest,
}: UsePlantingCycleDetailDerivedParams) {
  const harvestBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (isCycleClosed) {
      blockers.push('รอบปลูกนี้เก็บเกี่ยวแล้ว');
    }
    if (!hasActiveCertificate) {
      blockers.push('ไม่มีใบรับรองที่ใช้งานได้');
    }
    return blockers;
  }, [hasActiveCertificate, isCycleClosed]);

  const processSteps = useMemo(() => {
    const lotCount = Number(cycle?.traceSummary?.lotCount || 0);
    const plotCount = Number(cycle?.plotCount || 0);
    const hasActivities = (cycle?.activitySummary?.total || activities.length) > 0;
    const allPlotQrReady = plotCount > 0 && plotQrReadyCount >= plotCount;

    const step1Status: ProcessStatus = hasActivities ? 'done' : 'action';
    const step2Status: ProcessStatus = allPlotQrReady ? 'done' : 'action';
    const step3Status: ProcessStatus = lotCount > 0 ? 'done' : (canHarvest ? 'action' : 'blocked');
    const step4Status: ProcessStatus = lotCount > 0 ? 'done' : 'pending';

    return [
      {
        key: 'activities',
        title: '1) บันทึกกิจกรรม',
        detail: hasActivities
          ? `บันทึกแล้ว ${(cycle?.activitySummary?.total || activities.length).toLocaleString('th-TH')} รายการ`
          : 'บันทึกกิจกรรมรายวันเพื่อใช้ตรวจย้อนหลัง',
        status: step1Status,
      },
      {
        key: 'plotQr',
        title: '2) สร้าง QR รายแปลง',
        detail: `พร้อมใช้งาน ${plotQrReadyCount.toLocaleString('th-TH')} / ${plotCount.toLocaleString('th-TH')} แปลง`,
        status: step2Status,
      },
      {
        key: 'harvest',
        title: '3) เก็บเกี่ยว/สร้างลอต',
        detail: lotCount > 0
          ? `สร้างลอตแล้ว ${lotCount.toLocaleString('th-TH')} ลอต`
          : 'ต้องผ่านเงื่อนไขก่อนเริ่มเก็บเกี่ยว',
        status: step3Status,
      },
      {
        key: 'trace',
        title: '4) ตรวจสอบ Trace',
        detail: lotCount > 0
          ? 'คุณเปิด Trace สาธารณะเพื่อตรวจย้อนกลับได้แล้ว'
          : 'ระบบ Trace จะพร้อมหลังสร้าง Batch/Lot',
        status: step4Status,
      },
    ];
  }, [
    activities.length,
    canHarvest,
    cycle?.activitySummary?.total,
    cycle?.plotCount,
    cycle?.traceSummary?.lotCount,
    plotQrReadyCount,
  ]);

  const perPlotProgress = useMemo(() => (cycle?.plots || []).map((plot) => ({
    cyclePlotId: plot.cyclePlotId,
    plotName: plot.name,
    cultivationMethod: String(plot.solarSystem || ''),
    plannedPlantCount: Number(plot.plannedPlantCount || 0),
  })), [cycle?.plots]);

  return {
    harvestBlockers,
    processSteps,
    perPlotProgress,
  };
}
