import { useMemo } from 'react';
import { formatCultivationMethod } from '@/lib/planting-labels';

/**
 * Builds one traceability row per PLOT in the cycle.
 *
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so a row no longer carries a plant
 * count: the chain it feeds is แปลง -> รอบปลูก -> รุ่นเก็บเกี่ยว -> ลอต,
 * and each link is a real record with its own QR, not a plant.
 */

interface CyclePlot {
  cyclePlotId: string;
  name?: string;
  solarSystem?: string;
}

interface PlotProgressRow {
  cyclePlotId: string;
  plotName?: string;
  cultivationMethod?: string;
}

interface PlotQrRow {
  cyclePlotId: string;
  qrCode?: string | null;
  trackingUrl?: string | null;
}

interface TraceSummaryRow {
  lotCount?: number;
  latestBatch?: {
    batchNumber?: string | null;
    trackingUrl?: string | null;
  } | null;
  latestLots?: unknown[];
}

interface PlotTraceRow {
  traceSummary?: TraceSummaryRow;
  links?: {
    latestBatchUrl?: string | null;
  };
}

interface TraceLotLink {
  id: string;
  lotNumber: string;
  trackingUrl?: string | null;
}

export function usePlantingCycleTraceRows({
  cycle,
  perPlotProgress,
  plotQrs,
  plotTraceByCyclePlotId,
}: {
  cycle?: { plots?: CyclePlot[] } | null;
  perPlotProgress: PlotProgressRow[];
  plotQrs: PlotQrRow[];
  plotTraceByCyclePlotId: Record<string, PlotTraceRow>;
}) {
  const plotQrByCyclePlotId = useMemo(
    () => new Map(plotQrs.map((qr) => [qr.cyclePlotId, qr])),
    [plotQrs],
  );

  const traceDrillDownRows = useMemo(() => {
    return perPlotProgress.map((plotProgress) => {
      const plot = cycle?.plots?.find((item) => item.cyclePlotId === plotProgress.cyclePlotId);
      const qr = plotQrByCyclePlotId.get(plotProgress.cyclePlotId);
      const trace = plotTraceByCyclePlotId[plotProgress.cyclePlotId];
      const rawLatestLots = Array.isArray(trace?.traceSummary?.latestLots) ? trace.traceSummary.latestLots : [];
      const latestLots = rawLatestLots
        .map((lot) => {
          if (!lot || typeof lot !== 'object') return null;
          const raw = lot as Record<string, unknown>;
          const rawId = raw.id ?? raw.id;
          const rawLotNumber = raw.lotNumber ?? raw.code;
          const id = typeof rawId === 'string' ? rawId : '';
          const lotNumber = typeof rawLotNumber === 'string' ? rawLotNumber : '';
          if (!id && !lotNumber) return null;
          return {
            id: id || lotNumber,
            lotNumber: lotNumber || id,
            trackingUrl: typeof raw.trackingUrl === 'string' ? raw.trackingUrl : null,
          } as TraceLotLink;
        })
        .filter((lot): lot is TraceLotLink => lot !== null);
      return {
        cyclePlotId: plotProgress.cyclePlotId,
        plotName: plot?.name || plotProgress.plotName || 'แปลง',
        cultivationMethod: formatCultivationMethod(plot?.solarSystem || plotProgress.cultivationMethod || ''),
        qrCode: qr?.qrCode || null,
        qrTrackingUrl: qr?.trackingUrl || null,
        lotCount: Number(trace?.traceSummary?.lotCount || 0),
        latestBatchNumber: trace?.traceSummary?.latestBatch?.batchNumber || null,
        latestBatchUrl: trace?.traceSummary?.latestBatch?.trackingUrl || trace?.links?.latestBatchUrl || null,
        latestLots: latestLots.slice(0, 3),
      };
    });
  }, [cycle?.plots, perPlotProgress, plotQrByCyclePlotId, plotTraceByCyclePlotId]);

  return {
    plotQrByCyclePlotId,
    traceDrillDownRows,
  };
}
