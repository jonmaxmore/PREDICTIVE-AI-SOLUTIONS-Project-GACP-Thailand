'use client';

import {
  NotebookTabs,
  NotebookTabsList,
  NotebookTabsTrigger,
} from '@/components/feature/notebook-tabs';
import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { useDisclosure } from '@/hooks/use-disclosure';
import { toPlantingUserMessage } from '@/lib/planting-labels';
import { notifications } from '@/lib/notifications';
import {
  NO_PERMISSION_TOOLTIP_TH,
  useEntityPermissions,
} from '@/lib/services/use-entity-permissions';
import { computeCanHarvest } from './planting-cycle-detail-gates';
import {
  type PlantingActivity,
  type PlantingCycleDetail,
  type PlotCycleTraceDetail,
  type PlotCycleQr,
} from '@/lib/services/planting-service';
import {
  PROCESS_STATUS_META,
  TABS,
  createDefaultPackagingRow,
  getStatusMeta,
  isCertificateActive,
  sumPackagingWeight,
  type PlotHarvestForm,
} from './planting-cycle-detail-page-config';
import { PlantingCycleDetailHeaderBlock } from './planting-cycle-detail-header-block';
import { PlantingCycleDetailTabsSectionAOverviewPlots } from './planting-cycle-detail-tabs-section-a-overview-plots';
import { PlantingCycleDetailTabsSectionB } from './planting-cycle-detail-tabs-section-b';
import { PlantingCycleDetailModals } from './planting-cycle-detail-modals';
import { getPlantingCycleDetailStateView } from './planting-cycle-detail-state-view';
import { usePlantingCycleDetailActions } from './use-planting-cycle-detail-actions';
import { usePlantingCycleDetailDataLoader } from './use-planting-cycle-detail-data-loader';
import { usePlantingCycleDetailDerived } from './use-planting-cycle-detail-derived';
import { usePlantingCycleTraceRows } from './use-planting-cycle-trace-rows';

/**
 * Planting-cycle detail screen.
 *
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so this page holds NO per-plant state:
 * no unit list, no unit pagination, no unit quota, no unit status filter,
 * no selected-plot unit drill-down, and no integrity report reconciling
 * plant rows against the plan. The resolution it works at is the plot
 * inside its cycle, and the chain it shows is
 * แปลง → รอบปลูก → รุ่นเก็บเกี่ยว → ลอต. UNIT_MANAGE is no longer read
 * here either — nothing on this screen manages units any more.
 */
export default function PlantingCycleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const cycleId = String(params?.id || '');
  const runtimeNotice = String(searchParams?.get('notice') || '').trim();
  const queryTab = String(searchParams?.get('tab') || '').trim().toLowerCase();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<PlantingCycleDetail | null>(null);
  const [activities, setActivities] = useState<PlantingActivity[]>([]);
  const [plotQrs, setPlotQrs] = useState<PlotCycleQr[]>([]);
  const [plotTraceByCyclePlotId, setPlotTraceByCyclePlotId] = useState<Record<string, PlotCycleTraceDetail>>({});
  const [loadingPlotTrace, setLoadingPlotTrace] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(TABS.includes(queryTab as typeof TABS[number]) ? queryTab : 'overview');

  const [harvestModalOpened, { open: openHarvestModal, close: closeHarvestModal }] = useDisclosure(false);
  const [qrPreviewOpened, { open: openQrPreviewModal, close: closeQrPreviewModal }] = useDisclosure(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingPlotQr, setSubmittingPlotQr] = useState(false);

  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState<string>('');
  const [qrPreviewTargetUrl, setQrPreviewTargetUrl] = useState<string>('');
  const [qrPreviewTitle, setQrPreviewTitle] = useState<string>('QR');
  const [harvestDate, setHarvestDate] = useState<Date | null>(new Date());
  const [harvestForms, setHarvestForms] = useState<Record<string, PlotHarvestForm>>({});

  const hasActiveCertificate = useMemo(() => isCertificateActive(cycle), [cycle]);
  const isCycleClosed = useMemo(() => {
    const status = String(cycle?.status || '').toUpperCase();
    return status === 'HARVESTED' || status === 'COMPLETED';
  }, [cycle?.status]);
  // Farm-worker Wave C chunk 3 — workspace effective-permission gating
  // (UX only; every gated endpoint re-checks and answers 403
  // ENTITY_PERMISSION_DENIED). Personal context / fetch errors fail OPEN;
  // a 404 "not a member" hides. reportPermissionDenial (F1(b)) evicts the
  // snapshot when a live 403 denial proves it stale. See
  // use-entity-permissions.ts.
  const { has: hasWorkspacePermission, reportPermissionDenial } = useEntityPermissions();
  const mayHarvest = hasWorkspacePermission('HARVEST_RECORD');
  const mayGenerateQr = hasWorkspacePermission('QR_GENERATE');
  // F5 — the gated derivation is an EXTRACTED pure function
  // (planting-cycle-detail-gates.ts) so the permission×domain truth table
  // is behavior-tested; this call site is full-expression pinned in
  // entity-permission-gating.test.ts.
  const canHarvest = useMemo(() => computeCanHarvest({
    isCycleClosed,
    hasActiveCertificate,
    mayHarvest,
  }), [isCycleClosed, hasActiveCertificate, mayHarvest]);
  const plotQrReadyCount = plotQrs.filter((item) => Boolean(item.qrCode)).length;

  const {
    harvestBlockers,
    processSteps,
    perPlotProgress,
  } = usePlantingCycleDetailDerived({
    isCycleClosed,
    hasActiveCertificate,
    cycle,
    activities,
    plotQrReadyCount,
    canHarvest,
  });

  const { loadAll } = usePlantingCycleDetailDataLoader({
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
    onPermissionDenied: reportPermissionDenial,
  });

  const {
    handleGeneratePlotQrs,
    openQrPreview,
    updateHarvestField,
    updatePackagingRow,
    addPackagingRow,
    removePackagingRow,
    handleHarvest,
  } = usePlantingCycleDetailActions({
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
    onPermissionDenied: reportPermissionDenial,
  });
  const { plotQrByCyclePlotId, traceDrillDownRows } = usePlantingCycleTraceRows({
    cycle,
    perPlotProgress,
    plotQrs,
    plotTraceByCyclePlotId,
  });

  // Wave C chunk 3 — permission-gated variants of the operation surfaces.
  // Buttons with a disabled predicate get the gated boolean; the plot-QR
  // generate button calls its handler directly, so it gets a guarded
  // handler that surfaces the standard no-permission copy instead of
  // firing a request the BE would 403.
  const harvestBlockersGated = mayHarvest
    ? harvestBlockers
    : [...harvestBlockers, NO_PERMISSION_TOOLTIP_TH];
  const guardedGeneratePlotQrs = () => {
    if (!mayGenerateQr) {
      notifications.show({
        color: 'yellow',
        title: NO_PERMISSION_TOOLTIP_TH,
        message: 'ต้องมีสิทธิ์ "สร้าง QR แปลงปลูก" (QR_GENERATE)',
      });
      return;
    }
    handleGeneratePlotQrs();
  };

  const stateView = getPlantingCycleDetailStateView({ loading, error, cycle });
  if (stateView) {
    return stateView;
  }
  if (!cycle) {
    return null;
  }

  const commonTabProps = {
    // The plots tab links to the printable plot signs, which live under this cycle's route.
    cycleId,
    cycle,
    hasActiveCertificate,
    harvestBlockers: harvestBlockersGated,
    submittingPlotQr,
    handleGeneratePlotQrs: guardedGeneratePlotQrs,
    perPlotProgress,
    plotQrByCyclePlotId,
    openQrPreview,
  };

  const statusMeta = getStatusMeta(cycle.status);

  return (
    <div className="flow-stack-lg w-full px-4">
      <div className="flow-stack-lg">
        <PlantingCycleDetailHeaderBlock
          router={router}
          statusMeta={statusMeta}
          cycle={cycle}
          submittingPlotQr={submittingPlotQr}
          handleGeneratePlotQrs={guardedGeneratePlotQrs}
          canHarvest={canHarvest}
          openHarvestModal={openHarvestModal}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          runtimeNotice={runtimeNotice}
          toPlantingUserMessage={toPlantingUserMessage}
          hasActiveCertificate={hasActiveCertificate}
          processSteps={processSteps}
          PROCESS_STATUS_META={PROCESS_STATUS_META}
          activities={activities}
          plotQrReadyCount={plotQrReadyCount}
        />

        {/* Wave E.2-E follow-up: notebook-style tabs across the planting
            cycle detail. Sub-components (overview-plots / b) render their
            own NotebookTabsContent inside this parent's NotebookTabs
            context. Same Mantine→Radix conversion as PR #248's
            audits/[id] migration. */}
        <NotebookTabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(String(value || 'overview'))}
        >
          <div className="surface-panel overflow-x-auto p-2">
            <NotebookTabsList className="w-max min-w-full sm:min-w-0">
              <NotebookTabsTrigger value="overview">ภาพรวมรอบ</NotebookTabsTrigger>
              <NotebookTabsTrigger value="plots">แปลงและ QR</NotebookTabsTrigger>
              <NotebookTabsTrigger value="activities">กิจกรรมภาคสนาม</NotebookTabsTrigger>
              <NotebookTabsTrigger value="trace">เก็บเกี่ยวและ Trace</NotebookTabsTrigger>
              <NotebookTabsTrigger value="history">บันทึกระบบ</NotebookTabsTrigger>
            </NotebookTabsList>
          </div>

          <PlantingCycleDetailTabsSectionAOverviewPlots {...commonTabProps} />

          <PlantingCycleDetailTabsSectionB
            activities={activities}
            cycle={cycle}
            harvestBlockers={harvestBlockersGated}
            canHarvest={canHarvest}
            openHarvestModal={openHarvestModal}
            submittingPlotQr={submittingPlotQr}
            handleGeneratePlotQrs={guardedGeneratePlotQrs}
            loadingPlotTrace={loadingPlotTrace}
            traceDrillDownRows={traceDrillDownRows}
            openQrPreview={openQrPreview}
          />
        </NotebookTabs>
      </div>

      <PlantingCycleDetailModals
        cycle={cycle}
        submitting={submitting}
        harvestModalOpened={harvestModalOpened}
        closeHarvestModal={closeHarvestModal}
        harvestDate={harvestDate}
        setHarvestDate={setHarvestDate}
        harvestForms={harvestForms}
        createDefaultPackagingRow={createDefaultPackagingRow}
        sumPackagingWeight={sumPackagingWeight}
        updateHarvestField={updateHarvestField}
        updatePackagingRow={updatePackagingRow}
        removePackagingRow={removePackagingRow}
        addPackagingRow={addPackagingRow}
        handleHarvest={handleHarvest}
        qrPreviewOpened={qrPreviewOpened}
        closeQrPreviewModal={closeQrPreviewModal}
        qrPreviewTitle={qrPreviewTitle}
        qrPreviewDataUrl={qrPreviewDataUrl}
        qrPreviewTargetUrl={qrPreviewTargetUrl}
      />
    </div>
  );
}
