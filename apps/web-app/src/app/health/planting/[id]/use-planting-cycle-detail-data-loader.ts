import { useEffect, useRef } from 'react';
import { notifications } from '@/lib/notifications';
import { plantingService } from '@/lib/services/planting-service';
import { toPlantingUserMessage } from '@/lib/planting-labels';
import { TABS, createDefaultPackagingRow } from './planting-cycle-detail-page-config';
import { isWorkspacePermissionDenied } from './plot-qr-permission';

/**
 * Loader for the planting-cycle detail screen.
 *
 * loadUnitsData is GONE — R8 (design notes
 * 2026-08-20-planting-tnt-design.md) retired per-plant tracking
 * permanently, so this screen no longer fetches PlantUnit pages, a
 * per-plant quota, or the integrity report that reconciled plant rows
 * against the plan. What it loads is the cycle, its activities and its
 * per-plot QR codes: the whole chain the product still tracks.
 */

type CyclePlot = {
  cyclePlotId: string;
  plannedPlantCount?: number;
};

type CycleDetail = {
  plots?: CyclePlot[];
  plannedPlantCount?: number;
};

type PlotQrRow = {
  cyclePlotId: string;
  qrCode?: string | null;
  trackingUrl?: string | null;
};

type PlotTraceMap = Record<string, unknown>;

type HarvestFormState = {
  freshWeightKg: number;
  qualityGrade: string;
  notes: string;
  packagingRows: Array<ReturnType<typeof createDefaultPackagingRow>>;
};

type UsePlantingCycleDetailDataLoaderParams = {
  setHarvestForms: (value: Record<string, HarvestFormState>) => void;
  cycleId: string;
  setPlotTraceByCyclePlotId: (value: PlotTraceMap | ((prev: PlotTraceMap) => PlotTraceMap)) => void;
  queryTab: string;
  setActiveTab: (value: string) => void;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setCycle: (value: CycleDetail) => void;
  setActivities: (value: unknown[]) => void;
  setPlotQrs: (value: PlotQrRow[]) => void;
  activeTab: string;
  plotQrs: PlotQrRow[];
  plotTraceByCyclePlotId: PlotTraceMap;
  setLoadingPlotTrace: (value: boolean) => void;
  /**
   * Wave-C F1(b) — receives the failed auto-QR result; the caller
   * (useEntityPermissions().reportPermissionDenial) evicts the permission
   * snapshot on a live 403 ENTITY_PERMISSION_DENIED and no-ops otherwise.
   */
  onPermissionDenied?: (result: { status?: number | undefined; code?: string | undefined }) => void;
};

export type PlantingCycleDetailReloadOptions = {
  forceCore?: boolean;
  showLoading?: boolean;
};

export function usePlantingCycleDetailDataLoader(params: Record<string, unknown>) {
  const {
    setHarvestForms,
    cycleId,
    setPlotTraceByCyclePlotId,
    queryTab,
    setActiveTab,
    setLoading,
    setError,
    setCycle,
    setActivities,
    setPlotQrs,
    activeTab,
    plotQrs,
    plotTraceByCyclePlotId,
    setLoadingPlotTrace,
    onPermissionDenied,
  } = params as UsePlantingCycleDetailDataLoaderParams;

  const lastLoadedCoreCycleIdRef = useRef('');

  const initializeHarvestForms = (detail: CycleDetail) => {
    const next: Record<string, HarvestFormState> = {};
    for (const plot of detail.plots || []) {
      const estimate = Math.max(1, Math.round((plot.plannedPlantCount || 0) * 0.15));
      next[plot.cyclePlotId] = {
        freshWeightKg: estimate,
        qualityGrade: 'A',
        notes: '',
        packagingRows: [createDefaultPackagingRow()],
      };
    }
    setHarvestForms(next);
  };

  useEffect(() => {
    setPlotTraceByCyclePlotId({});
  }, [cycleId, setPlotTraceByCyclePlotId]);

  useEffect(() => {
    if (TABS.includes(queryTab as typeof TABS[number])) {
      setActiveTab(queryTab);
    }
  }, [queryTab, setActiveTab]);

  const loadCoreData = async (): Promise<CycleDetail | null> => {
    const [cycleResult, activityResult, plotQrResult] = await Promise.all([
      plantingService.getCycleById(cycleId),
      plantingService.listActivities(cycleId, { page: 1, limit: 20 }),
      plantingService.listPlotCycleQrs(cycleId),
    ]);

    if (!cycleResult.success || !cycleResult.data) {
      setError(toPlantingUserMessage(cycleResult.error || 'Unable to load planting cycle details'));
      return null;
    }

    const detail = cycleResult.data;
    setCycle(detail);
    setActivities(activityResult.success ? activityResult.data : []);

    const nextPlotQrs = plotQrResult.success ? plotQrResult.data : [];
    setPlotQrs(nextPlotQrs);
    initializeHarvestForms(detail);

    const missingPlotQr = (detail.plots || []).some((plot) => {
      const row = nextPlotQrs.find((item) => String(item.cyclePlotId) === String(plot.cyclePlotId));
      return !row || !row.qrCode || !row.trackingUrl;
    });

    if ((detail.plots?.length || 0) > 0 && missingPlotQr) {
      const autoQrResult = await plantingService.generatePlotCycleQrs(cycleId);
      if (!autoQrResult.success) {
        // F1(b) — a denied auto-fire proves any 'allowed' QR_GENERATE
        // snapshot stale; evict (strict detector inside — no-op otherwise).
        onPermissionDenied?.(autoQrResult);
      }
      if (autoQrResult.success) {
        setPlotQrs(autoQrResult.data);
      } else if (!isWorkspacePermissionDenied(autoQrResult)) {
        // S11 — a 403 ENTITY_PERMISSION_DENIED on this background auto-fire
        // is EXPECTED for QR-denied workspace members (VIEWER / REVOKE'd):
        // swallow it silently — the page still renders; only actionable
        // failures surface the warning toast.
        notifications.show({
          color: 'yellow',
          title: 'สร้าง QR แปลงอัตโนมัติไม่สำเร็จ',
          message: toPlantingUserMessage(autoQrResult.error || 'สร้างชุด QR แปลงได้ไม่ครบ กรุณาลองอีกครั้ง'),
        });
      }
    }

    return detail;
  };

  const loadAll = async (options: PlantingCycleDetailReloadOptions = {}) => {
    if (!cycleId) {
      return;
    }

    const {
      forceCore = false,
      showLoading = true,
    } = options;

    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    const shouldLoadCore = forceCore || lastLoadedCoreCycleIdRef.current !== cycleId;

    if (shouldLoadCore) {
      const detail = await loadCoreData();
      if (!detail) {
        if (showLoading) {
          setLoading(false);
        }
        return;
      }
      lastLoadedCoreCycleIdRef.current = cycleId;
    }

    if (showLoading) {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cycleId) {
      return;
    }

    void loadAll({ forceCore: true, showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlotTraceDetails() {
      if (activeTab !== 'trace') {
        return;
      }

      const candidates = plotQrs.filter((item) => Boolean(item.qrCode));
      const missing = candidates.filter((item) => !plotTraceByCyclePlotId[item.cyclePlotId]);
      if (missing.length === 0) {
        return;
      }

      setLoadingPlotTrace(true);
      const results = await Promise.all(
        missing.map(async (item) => {
          const result = await plantingService.getPlotCycleTrace(String(item.qrCode || ''));
          return {
            cyclePlotId: item.cyclePlotId,
            success: result.success,
            data: result.data || null,
          };
        }),
      );

      if (cancelled) {
        return;
      }

      setPlotTraceByCyclePlotId((prev) => {
        const next = { ...prev };
        for (const row of results) {
          if (row.success && row.data) {
            next[row.cyclePlotId] = row.data;
          }
        }
        return next;
      });
      setLoadingPlotTrace(false);
    }

    loadPlotTraceDetails().catch(() => {
      if (!cancelled) {
        setLoadingPlotTrace(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, plotQrs, plotTraceByCyclePlotId, setLoadingPlotTrace, setPlotTraceByCyclePlotId]);

  return {
    loadAll,
  };
}
