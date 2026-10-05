import QRCode from 'qrcode';
import { notifications } from '@/lib/notifications';
import { plantingService } from '@/lib/services/planting-service';
import type { PlotCycleQr } from '@/lib/services/planting-service';
import { toPlantingUserMessage } from '@/lib/planting-labels';
import { createDefaultPackagingRow, toAbsoluteUrl } from './planting-cycle-detail-page-config';
import type { PlantingCycleDetailReloadOptions } from './use-planting-cycle-detail-data-loader';

/**
 * Actions for the planting-cycle detail screen.
 *
 * handleGenerateUnits / handleBulkConfirmPlanting / handleReconcileUnits
 * are GONE. R8 (design note 2026-08-20-planting-tnt-design)
 * retired per-plant tracking permanently: no door in this app may mint,
 * confirm or reconcile PlantUnit rows again. A single press used to mint
 * 500 of them and the harvest then linked every one into its evidence
 * chain. What is left here is plot QR generation, the QR preview and the
 * per-plot harvest that creates Batch/Lot.
 */

interface PackagingRow {
  packageType: string;
  quantity: number;
  unitWeight: number;
}

interface HarvestForm {
  freshWeightKg: number;
  qualityGrade: string;
  notes: string;
  packagingRows: PackagingRow[];
}

interface CyclePlot {
  cyclePlotId: string;
  name: string;
}

interface CycleDetailForHarvest {
  plots: CyclePlot[];
}

interface UsePlantingCycleDetailActionsParams {
  cycleId: string;
  setSubmitting: (value: boolean) => void;
  loadAll: (options?: PlantingCycleDetailReloadOptions) => Promise<void>;
  setSubmittingPlotQr: (value: boolean) => void;
  setPlotQrs: (value: PlotCycleQr[]) => void;
  setQrPreviewTitle: (value: string) => void;
  setQrPreviewTargetUrl: (value: string) => void;
  setQrPreviewDataUrl: (value: string) => void;
  openQrPreviewModal: () => void;
  setHarvestForms: (updater: (prev: Record<string, HarvestForm>) => Record<string, HarvestForm>) => void;
  cycle: CycleDetailForHarvest | null;
  harvestDate: Date | null;
  harvestForms: Record<string, HarvestForm>;
  closeHarvestModal: () => void;
  /**
   * Wave-C F1(b) — called with every FAILED gated-mutation result; the
   * caller (useEntityPermissions().reportPermissionDenial) evicts the
   * permission snapshot on a live 403 ENTITY_PERMISSION_DENIED and
   * no-ops otherwise.
   */
  onPermissionDenied?: (result: { status?: number | undefined; code?: string | undefined }) => void;
}

export function usePlantingCycleDetailActions({
  cycleId,
  setSubmitting,
  loadAll,
  setSubmittingPlotQr,
  setPlotQrs,
  setQrPreviewTitle,
  setQrPreviewTargetUrl,
  setQrPreviewDataUrl,
  openQrPreviewModal,
  setHarvestForms,
  cycle,
  harvestDate,
  harvestForms,
  closeHarvestModal,
  onPermissionDenied,
}: UsePlantingCycleDetailActionsParams) {
  const handleGeneratePlotQrs = async () => {
    if (!cycleId) {
      return;
    }

    setSubmittingPlotQr(true);
    const result = await plantingService.generatePlotCycleQrs(cycleId);
    setSubmittingPlotQr(false);

    if (!result.success) {
      onPermissionDenied?.(result);
      notifications.show({
        color: 'red',
        title: 'สร้าง QR รายแปลงไม่สำเร็จ',
        message: toPlantingUserMessage(result.error || 'ไม่สามารถสร้าง QR รายแปลงได้'),
      });
      return;
    }

    notifications.show({
      color: 'green',
      title: 'สร้าง QR รายแปลงสำเร็จ',
      message: `สร้างหรืออัปเดต QR แล้ว ${result.data.length} แปลง`,
    });

    const listResult = await plantingService.listPlotCycleQrs(cycleId);
    if (listResult.success) {
      setPlotQrs(listResult.data);
    }
  };

  const openQrPreview = async (title: string, targetUrl: string | null | undefined) => {
    const normalizedUrl = String(targetUrl || '').trim();
    if (!normalizedUrl) {
      notifications.show({
        color: 'yellow',
        title: 'ไม่พบ URL สำหรับ QR',
        message: 'ยังไม่มีข้อมูล URL สำหรับสร้าง QR ในรายการนี้',
      });
      return;
    }

    try {
      const resolvedUrl = toAbsoluteUrl(normalizedUrl);
      const dataUrl = await QRCode.toDataURL(resolvedUrl, { width: 220, margin: 1 });
      setQrPreviewTitle(title);
      setQrPreviewTargetUrl(resolvedUrl);
      setQrPreviewDataUrl(dataUrl);
      openQrPreviewModal();
    } catch {
      notifications.show({
        color: 'red',
        title: 'สร้างภาพ QR ไม่สำเร็จ',
        message: 'กรุณาลองใหม่อีกครั้ง',
      });
    }
  };

  const updateHarvestField = (cyclePlotId: string, patch: Partial<HarvestForm>) => {
    setHarvestForms((prev) => ({
      ...prev,
      [cyclePlotId]: {
        ...(prev[cyclePlotId] || {
          freshWeightKg: 0,
          qualityGrade: '',
          notes: '',
          packagingRows: [createDefaultPackagingRow()],
        }),
        ...patch,
      },
    }));
  };

  const updatePackagingRow = (cyclePlotId: string, rowIndex: number, patch: Partial<PackagingRow>) => {
    setHarvestForms((prev) => {
      const current = prev[cyclePlotId];
      if (!current) {
        return prev;
      }

      const rows = current.packagingRows.map((row, idx) => {
        if (idx !== rowIndex) {
          return row;
        }
        return {
          ...row,
          ...patch,
        };
      });

      return {
        ...prev,
        [cyclePlotId]: {
          ...current,
          packagingRows: rows,
        },
      };
    });
  };

  const addPackagingRow = (cyclePlotId: string) => {
    setHarvestForms((prev) => {
      const current = prev[cyclePlotId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [cyclePlotId]: {
          ...current,
          packagingRows: [...current.packagingRows, createDefaultPackagingRow()],
        },
      };
    });
  };

  const removePackagingRow = (cyclePlotId: string, rowIndex: number) => {
    setHarvestForms((prev) => {
      const current = prev[cyclePlotId];
      if (!current || current.packagingRows.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        [cyclePlotId]: {
          ...current,
          packagingRows: current.packagingRows.filter((_, idx) => idx !== rowIndex),
        },
      };
    });
  };

  const handleHarvest = async () => {
    if (!cycle || !cycleId || !harvestDate) {
      return;
    }

    const plotHarvests = [] as Array<{
      cyclePlotId: string;
      freshWeightKg: number;
      qualityGrade?: string;
      notes?: string;
      packagingRows: Array<{
        packageType: string;
        quantity: number;
        unitWeight: number;
        totalWeight: number;
      }>;
    }>;

    for (const plot of cycle.plots) {
      const form = harvestForms[plot.cyclePlotId];
      if (!form) {
        notifications.show({ color: 'red', title: 'ข้อมูลไม่ครบ', message: `ไม่พบข้อมูลเก็บเกี่ยวของแปลง ${plot.name}` });
        return;
      }

      if (!Number.isFinite(form.freshWeightKg) || Number(form.freshWeightKg) <= 0) {
        notifications.show({ color: 'red', title: 'ข้อมูลไม่ครบ', message: `กรุณาระบุน้ำหนักสดของแปลง ${plot.name}` });
        return;
      }

      const rows = form.packagingRows
        .map((row) => ({
          packageType: String(row.packageType || '').trim(),
          quantity: Number(row.quantity || 0),
          unitWeight: Number(row.unitWeight || 0),
        }))
        .filter((row) => row.packageType && row.quantity > 0 && row.unitWeight > 0)
        .map((row) => ({
          ...row,
          totalWeight: Number((row.quantity * row.unitWeight).toFixed(4)),
        }));

      if (rows.length === 0) {
        notifications.show({ color: 'red', title: 'ข้อมูลไม่ครบ', message: `กรุณาระบุบรรจุภัณฑ์ของแปลง ${plot.name}` });
        return;
      }

      const packagingWeight = rows.reduce((sum, row) => sum + row.totalWeight, 0);
      if (packagingWeight > Number(form.freshWeightKg) + 0.0001) {
        notifications.show({
          color: 'red',
          title: 'น้ำหนักไม่ถูกต้อง',
          message: `น้ำหนักรวมในบรรจุภัณฑ์ของแปลง ${plot.name} มากกว่าน้ำหนักสด`,
        });
        return;
      }

      plotHarvests.push({
        cyclePlotId: plot.cyclePlotId,
        freshWeightKg: Number(form.freshWeightKg),
        ...(form.qualityGrade ? { qualityGrade: form.qualityGrade } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
        packagingRows: rows,
      });
    }

    setSubmitting(true);
    const result = await plantingService.harvestByPlots(cycleId, {
      harvestDate: harvestDate.toISOString(),
      plotHarvests,
    });
    setSubmitting(false);

    if (!result.success) {
      onPermissionDenied?.(result);
      notifications.show({
        color: 'red',
        title: 'บันทึกเก็บเกี่ยวไม่สำเร็จ',
        message: toPlantingUserMessage(result.error || 'ไม่สามารถสร้างชุดเก็บเกี่ยวแยกตามแปลงได้'),
      });
      return;
    }

    notifications.show({
      color: 'green',
      title: 'บันทึกเก็บเกี่ยวสำเร็จ',
      message: 'ระบบสร้าง Batch/Lot แยกตามแปลงเรียบร้อยแล้ว',
    });

    // PHI — ระยะปลอดภัยหลังพ่นสาร: เซิร์ฟเวอร์เทียบวันพ่นกับวันเก็บให้แล้ว
    // (pre-harvest-interval.js) · null = สะอาด ไม่มีอะไรให้พูด
    const phi = (result.data as { data?: { phiWarning?: { messageTh?: string } | null } } | undefined)
      ?.data?.phiWarning
      ?? (result.data as { phiWarning?: { messageTh?: string } | null } | undefined)?.phiWarning
      ?? null;
    if (phi?.messageTh) {
      notifications.show({
        color: 'yellow',
        title: 'ข้อควรระวัง: ระยะปลอดภัยหลังการใช้สาร',
        message: phi.messageTh,
        autoClose: false, // คำเตือนความปลอดภัยอาหาร — ให้ผู้ใช้ปิดเอง ไม่หายไปเอง
      });
    }

    closeHarvestModal();
    await loadAll({ forceCore: true, showLoading: true });
  };


  return {
    handleGeneratePlotQrs,
    openQrPreview,
    updateHarvestField,
    updatePackagingRow,
    addPackagingRow,
    removePackagingRow,
    handleHarvest,
  };
}
