import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { notifications } from '@/lib/notifications';
import { toPlantingUserMessage } from '@/lib/planting-labels';
import { plantingService, type PlotOption } from '@/lib/services/planting-service';
import { plotAreaSqm, type PlotAssignmentForm } from './new-planting-cycle-page-config';

interface SubmitNewPlantingCycleParams {
  farmId: string;
  certificateId: string;
  plantSpeciesId: string;
  cycleName: string;
  startDate: Date | null;
  expectedHarvestDate: Date | null;
  selectedPlotIds: string[];
  plots: PlotOption[];
  assignments: Record<string, PlotAssignmentForm>;
  seedSource: string;
  notes: string;
  router: AppRouterInstance;
  setError: (value: string | null) => void;
  setSubmitting: (value: boolean) => void;
}

export async function submitNewPlantingCycle(params: SubmitNewPlantingCycleParams): Promise<void> {
  const {
    farmId,
    certificateId,
    plantSpeciesId,
    cycleName,
    startDate,
    expectedHarvestDate,
    selectedPlotIds,
    plots,
    assignments,
    seedSource,
    notes,
    router,
    setError,
    setSubmitting,
  } = params;

  if (!farmId || !plantSpeciesId || !cycleName.trim() || !startDate) {
    setError('กรุณากรอกข้อมูลรอบปลูกให้ครบ');
    return;
  }

  if (!certificateId) {
    setError('ต้องเลือกใบรับรองที่ยังใช้งานได้ก่อนสร้างรอบปลูก');
    return;
  }

  if (selectedPlotIds.length < 1) {
    setError('กรุณาเลือกแปลงอย่างน้อย 1 แปลง');
    return;
  }

  let plotAssignments: Array<{ plotId: string; allocatedAreaSqm: number; plannedPlantCount: number }> = [];

  try {
    plotAssignments = plots
      .filter((plot) => selectedPlotIds.includes(plot.id))
      .map((plot) => {
        const assignment = assignments[plot.id];
        const maxAreaSqm = plotAreaSqm(plot);

        if (!assignment) {
          throw new Error(`ไม่พบการตั้งค่าพื้นที่ของแปลง ${plot.name}`);
        }
        if (assignment.allocatedAreaSqm <= 0) {
          throw new Error(`พื้นที่ใช้งานของแปลง ${plot.name} ต้องมากกว่า 0`);
        }
        if (assignment.allocatedAreaSqm > maxAreaSqm) {
          throw new Error(`พื้นที่ใช้งานของแปลง ${plot.name} มากกว่าพื้นที่จริง`);
        }
        if (assignment.plannedPlantCount <= 0) {
          throw new Error(`จำนวนต้นเป้าหมายของแปลง ${plot.name} ต้องมากกว่า 0`);
        }

        return {
          plotId: plot.id,
          allocatedAreaSqm: Number(assignment.allocatedAreaSqm),
          plannedPlantCount: Number(assignment.plannedPlantCount),
        };
      });
  } catch (validationError) {
    const message = validationError instanceof Error ? validationError.message : 'ข้อมูลแปลงปลูกไม่ถูกต้อง';
    setError(toPlantingUserMessage(message));
    return;
  }

  setSubmitting(true);
  setError(null);

  const result = await plantingService.createCycle({
    farmId,
    certificateId: certificateId || null,
    plantSpeciesId,
    cycleName: cycleName.trim(),
    startDate: startDate.toISOString(),
    expectedHarvestDate: expectedHarvestDate ? expectedHarvestDate.toISOString() : null,
    plotAssignments,
    seedSource: seedSource.trim() || null,
    notes: notes.trim() || null,
  });

  setSubmitting(false);

  if (!result.success || !result.data?.id) {
    setError(toPlantingUserMessage(result.error || 'ไม่สามารถบันทึกรอบปลูกได้'));
    return;
  }

  const warnings = Array.isArray(result.data.warnings)
    ? result.data.warnings.filter((item): item is string => Boolean(item))
    : [];
  const plotQrAutomation = result.data?.automation?.plotQr;

  const autoMessageParts: string[] = [];
  if (plotQrAutomation?.status === 'generated') {
    autoMessageParts.push(`QR รายแปลงพร้อมใช้งาน ${Number(plotQrAutomation.generatedCount || 0).toLocaleString('th-TH')} แปลง`);
  } else if (plotQrAutomation?.status) {
    autoMessageParts.push('ระบบจะให้คุณรีเฟรช QR รายแปลงอีกครั้งในหน้ารายละเอียด');
  }
  // R8 (design note 2026-08-20-planting-tnt-design) retired
  // per-plant tracking permanently: opening a cycle mints plot QRs and
  // nothing else. There is no per-plant automation left to report.

  if (warnings.length > 0) {
    notifications.show({
      color: 'yellow',
      title: 'บันทึกรอบปลูกสำเร็จ แต่ยังมีรายการที่ต้องดำเนินการต่อ',
      message: toPlantingUserMessage(warnings[0]),
    });
  } else {
    notifications.show({
      color: 'green',
      title: 'บันทึกรอบปลูกสำเร็จ',
      message: autoMessageParts.length > 0 ? autoMessageParts.join(' · ') : 'ระบบสร้างรอบปลูกเรียบร้อยแล้ว',
    });
  }

  const notice = warnings.length > 0 ? `?notice=${encodeURIComponent(toPlantingUserMessage(warnings[0]))}` : '';
  router.push(`/health/planting/${result.data.id}${notice}`);
}
