'use client';

import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Table } from '@/components/ui/primitives/table';
import { NotebookTabsContent } from '@/components/feature/notebook-tabs';
import { Icons } from '@/components/ui/icons';
import { formatCultivationMethod, formatCultivationMethods } from '@/lib/planting-labels';

type CyclePlot = {
  cyclePlotId: string;
  name?: string;
  solarSystem?: string;
  allocatedAreaSqm?: number | string;
};

type CycleData = {
  cultivationMethods?: string[];
  certificate?: { certificateNumber?: string | null };
  startDate?: string;
  expectedHarvestDate?: string | null;
  seedSource?: string | null;
  notes?: string | null;
  plots?: CyclePlot[];
};

// R8 (design note 2026-08-20-planting-tnt-design) retired
// per-plant tracking permanently. A plot row therefore carries the plant
// count that was PLANNED for it and nothing else: with no PlantUnit rows
// there is nothing counting plants in the field, and a "current" figure
// would be a measurement nobody took.
type PlotProgress = {
  cyclePlotId: string;
  plotName: string;
  plannedPlantCount: number;
};

/**
 * The plot-QR row as `GET /planting-cycles/:id/plot-qrs` returns it, plus the three
 * permanent-code fields Layer 1 added to Plot (plotCode, qrIssuedAt, qrRevokedAt).
 *
 * `qrCode` is the per-CYCLE QR — unique per (cycle, plot), reborn every season — so it must
 * never be printed on a sign meant to stay in the field. `plotCode` is the permanent one.
 *
 * T8 (2026-09-05): the endpoint DOES return the permanent three now — all three plot-QR
 * doors build their rows from services/plot-qr-row.js. Until then this tab said "ยังไม่มีรหัส"
 * for every plot in the country and its print link fell back to the whole-cycle sheet, even
 * though the code, the resolver and the printable sign had all shipped on 2026-08-24. They
 * stay optional in the type because a plot minted before the column existed and missed the
 * backfill still has none, and "no code yet" is the honest thing to say about that plot.
 */
type PlotQr = {
  qrCode?: string | null;
  trackingUrl?: string | null;
  plotCode?: string | null;
  qrIssuedAt?: string | null;
  qrRevokedAt?: string | null;
};

/**
 * Where the printable sign lives. With no code it is the whole-cycle sheet; with one it is
 * that plot's page. A revoked plot links to its OWN code on purpose: a reprint replaces a
 * piece of paper, and minting a new code would orphan every lot already recorded under the
 * old one.
 */
function buildSignHref(cycleId: string, plotCode?: string | null) {
  const base = `/health/planting/${cycleId}/plot-signs`;
  return plotCode ? `${base}?code=${plotCode}` : base;
}

/** The code as it is meant to be read: Latin-only, so uppercase is allowed here. */
function PlotCodeText({ plotCode, className = '' }: { plotCode: string; className?: string }) {
  return (
    <span
      data-plot-code={plotCode}
      className={`font-mono font-semibold uppercase text-foreground ${className}`}
    >
      {plotCode}
    </span>
  );
}

type OverviewProps = {
  cycleId: string;
  cycle: CycleData;
  hasActiveCertificate: boolean;
  harvestBlockers: string[];
  submittingPlotQr: boolean;
  handleGeneratePlotQrs: () => void;
  perPlotProgress: PlotProgress[];
  plotQrByCyclePlotId: Map<string, PlotQr>;
  openQrPreview: (title: string, trackingUrl?: string | null) => void;
  [key: string]: unknown;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="group-item">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value || '-'}</p>
    </div>
  );
}

export function PlantingCycleDetailTabsSectionAOverviewPlots(props: Record<string, unknown>) {
  const {
    cycleId,
    cycle,
    hasActiveCertificate,
    harvestBlockers,
    submittingPlotQr,
    handleGeneratePlotQrs,
    perPlotProgress,
    plotQrByCyclePlotId,
    openQrPreview,
  } = props as OverviewProps;

  return (
    <>
      <NotebookTabsContent value="overview">
        <div className="grid gap-4 xl:grid-cols-2">
          <article className="surface-panel p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">ข้อมูลรอบปลูก</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="วิธีปลูก" value={formatCultivationMethods(cycle.cultivationMethods || []) || '-'} />
              <Field
                label="ใบรับรอง"
                value={
                  cycle.certificate?.certificateNumber
                    ? `${cycle.certificate.certificateNumber} (${hasActiveCertificate ? 'ใช้งานได้' : 'ยังไม่พร้อม'})`
                    : 'ยังไม่ผูกใบรับรอง'
                }
              />
              <Field
                label="วันเริ่ม"
                value={cycle.startDate ? new Date(cycle.startDate).toLocaleDateString('th-TH') : '-'}
              />
              <Field
                label="วันคาดเก็บ"
                value={cycle.expectedHarvestDate ? new Date(cycle.expectedHarvestDate).toLocaleDateString('th-TH') : '-'}
              />
              <Field label="แหล่งพันธุ์" value={cycle.seedSource || '-'} />
              <Field label="หมายเหตุ" value={cycle.notes || '-'} />
            </div>
          </article>

          <article className="surface-panel p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">เช็คลิสต์ความพร้อม</h3>
            <div className="space-y-3">
              <div className="group-item">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">พร้อมเก็บเกี่ยว</p>
                  <Badge tone={harvestBlockers.length === 0 ? 'success' : 'warning'}>
                    {harvestBlockers.length === 0 ? 'พร้อม' : 'ต้องแก้ไข'}
                  </Badge>
                </div>
                {harvestBlockers.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {harvestBlockers.map((item) => (
                      <p key={item} className="text-xs text-muted-foreground">• {item}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      </NotebookTabsContent>

      <NotebookTabsContent value="plots">
        <article className="surface-panel p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">แปลงในรอบและรหัสแปลง</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                รหัสแปลงติดอยู่กับที่ดินถาวร ใช้ได้ทุกรอบปลูก พิมพ์ป้ายไปติดที่แปลงแล้วสแกนบันทึกงานได้เลย
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                href={buildSignHref(cycleId)}
                size="sm"
                variant="secondary"
                leftSection={<Icons.Printer size={14} />}
              >
                พิมพ์ป้ายทุกแปลง
              </Button>
              <Button size="sm" variant="outline" loading={submittingPlotQr} onClick={handleGeneratePlotQrs} leftSection={<Icons.QrCode size={14} />}>
                สร้าง/รีเฟรช QR
              </Button>
            </div>
          </div>

          {/* Tablet+ table view: show below sm (≥ 640px) instead of lg, with horizontal scroll
              fallback so the 6-column table never clips on 600–800px tablets. Mobile (<640px)
              still falls back to the .cluster-list rendering below. */}
          <div className="hidden sm:block">
            <div className="overflow-x-auto rounded-2xl border border-border">
              <Table className="min-w-[640px]">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>แปลง</Table.Th>
                    <Table.Th>วิธีปลูก</Table.Th>
                    <Table.Th>พื้นที่ที่ใช้ (ตร.ม.)</Table.Th>
                    <Table.Th>จำนวนต้นตามแผน</Table.Th>
                    <Table.Th>รหัสแปลง</Table.Th>
                    <Table.Th>การดำเนินการ</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {perPlotProgress.map((plotProgress) => {
                    const plot = (cycle.plots || []).find((item) => item.cyclePlotId === plotProgress.cyclePlotId);
                    const qr = plotQrByCyclePlotId.get(plotProgress.cyclePlotId);

                    return (
                      <Table.Tr key={plotProgress.cyclePlotId}>
                        <Table.Td>{plot?.name || plotProgress.plotName}</Table.Td>
                        <Table.Td>
                          <Badge tone="info">{formatCultivationMethod(plot?.solarSystem || '')}</Badge>
                        </Table.Td>
                        <Table.Td>{Math.round(Number(plot?.allocatedAreaSqm || 0)).toLocaleString('th-TH')}</Table.Td>
                        <Table.Td>{plotProgress.plannedPlantCount.toLocaleString('th-TH')}</Table.Td>
                        <Table.Td>
                          {qr?.plotCode ? (
                            <div className="space-y-1">
                              <PlotCodeText plotCode={qr.plotCode} className="text-sm" />
                              {qr.qrRevokedAt ? (
                                <Badge tone="warning">ป้ายถูกยกเลิก</Badge>
                              ) : null}
                            </div>
                          ) : (
                            <Badge tone="neutral">ยังไม่มีรหัสแปลง</Badge>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <div className="flex flex-wrap gap-1.5">
                            {qr?.plotCode ? (
                              <Button
                                href={buildSignHref(cycleId, qr.plotCode)}
                                size="compact-xs"
                                variant="outline"
                                leftSection={<Icons.Printer size={12} />}
                              >
                                {qr.qrRevokedAt ? 'พิมพ์ป้ายใหม่' : 'พิมพ์ป้าย'}
                              </Button>
                            ) : null}
                            {qr?.qrCode ? (
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                onClick={() => openQrPreview(`QR รอบปลูกนี้ — แปลง: ${plot?.name || plotProgress.plotName}`, qr.trackingUrl)}
                              >
                                แสดง QR
                              </Button>
                            ) : null}
                            {qr?.trackingUrl ? (
                              <Button href={qr.trackingUrl} target="_blank" rel="noreferrer" size="compact-xs" variant="subtle">
                                เปิด Trace
                              </Button>
                            ) : null}
                          </div>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>
          </div>

          <div className="cluster-list sm:hidden">
            {perPlotProgress.map((plotProgress) => {
              const plot = (cycle.plots || []).find((item) => item.cyclePlotId === plotProgress.cyclePlotId);
              const qr = plotQrByCyclePlotId.get(plotProgress.cyclePlotId);

              return (
                <div key={`mobile-${plotProgress.cyclePlotId}`} className="group-item">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{plot?.name || plotProgress.plotName}</p>
                      <p className="text-xs text-muted-foreground">
                        พื้นที่ {Math.round(Number(plot?.allocatedAreaSqm || 0)).toLocaleString('th-TH')} ตร.ม.
                      </p>
                    </div>
                    <Badge tone="info">{formatCultivationMethod(plot?.solarSystem || '')}</Badge>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">
                    จำนวนต้นตามแผน {plotProgress.plannedPlantCount.toLocaleString('th-TH')} ต้น
                  </p>

                  {/* The code sits above the actions and at body size, not in a caption:
                      this is the line the farmer reads down a phone when the printed QR
                      has stopped scanning, one-handed, outdoors. */}
                  <div className="mt-3 rounded-lg bg-muted p-3">
                    <p className="text-xs text-muted-foreground">รหัสแปลง</p>
                    {qr?.plotCode ? (
                      <>
                        <PlotCodeText plotCode={qr.plotCode} className="mt-0.5 block text-base tracking-wider" />
                        {qr.qrRevokedAt ? (
                          <p className="mt-1 text-xs text-foreground">
                            ป้ายถูกยกเลิก พิมพ์ป้ายใหม่ได้ รหัสแปลงยังเป็นรหัสเดิม
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-0.5 text-sm text-foreground">ยังไม่มีรหัสแปลง</p>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {qr?.plotCode ? (
                      <Button
                        href={buildSignHref(cycleId, qr.plotCode)}
                        size="sm"
                        variant="secondary"
                        leftSection={<Icons.Printer size={16} />}
                      >
                        {qr.qrRevokedAt ? 'พิมพ์ป้ายใหม่' : 'พิมพ์ป้าย'}
                      </Button>
                    ) : null}
                    {qr?.qrCode ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openQrPreview(`QR รอบปลูกนี้ — แปลง: ${plot?.name || plotProgress.plotName}`, qr.trackingUrl)}
                      >
                        แสดง QR
                      </Button>
                    ) : null}
                    {qr?.trackingUrl ? (
                      <Button href={qr.trackingUrl} target="_blank" rel="noreferrer" size="sm" variant="subtle">
                        เปิด Trace
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </NotebookTabsContent>
    </>
  );
}
