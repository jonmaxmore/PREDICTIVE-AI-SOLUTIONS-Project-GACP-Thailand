'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { SimpleGrid } from '@/components/ui/layout-utils';
import { Table } from '@/components/ui/primitives/table';
import { NotebookTabsContent } from '@/components/feature/notebook-tabs';
import { Icons } from '@/components/ui/icons';
import { formatActivityScope, formatActivityType } from '@/lib/planting-labels';

interface PlantingActivity {
  id: string;
  activityType: string;
  scope: string;
  activityDate: string;
  createdAt: string;
  note?: string | null;
}

interface TraceLotLink {
  id: string;
  lotNumber: string;
  trackingUrl?: string | null;
}

// R8 (design note 2026-08-20-planting-tnt-design) retired
// per-plant tracking permanently, so a row in the traceability chain is a
// PLOT in this cycle and what it produced - never a count of plants.
interface TraceDrillDownRow {
  cyclePlotId: string;
  plotName: string;
  cultivationMethod: string;
  qrCode?: string | null;
  qrTrackingUrl?: string | null;
  latestBatchUrl?: string | null;
  latestLots: TraceLotLink[];
}

interface PlantingCycleSummary {
  id: string;
  traceSummary?: {
    batchCount?: number;
    lotCount?: number;
    latestBatch?: {
      batchNumber?: string;
      trackingUrl?: string | null;
    } | null;
  };
}

interface PlantingCycleDetailTabsSectionBProps {
  activities: PlantingActivity[];
  cycle: PlantingCycleSummary;
  harvestBlockers: string[];
  canHarvest: boolean;
  openHarvestModal: () => void;
  submittingPlotQr: boolean;
  handleGeneratePlotQrs: () => void;
  loadingPlotTrace: boolean;
  traceDrillDownRows: TraceDrillDownRow[];
  openQrPreview: (title: string, url: string) => void;
}

export function PlantingCycleDetailTabsSectionB({
  activities,
  cycle,
  harvestBlockers,
  canHarvest,
  openHarvestModal,
  submittingPlotQr,
  handleGeneratePlotQrs,
  loadingPlotTrace,
  traceDrillDownRows,
  openQrPreview,
}: PlantingCycleDetailTabsSectionBProps) {
  return (
    <>
      <NotebookTabsContent value="activities">
        <article className="surface-panel p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">กิจกรรมภาคสนามล่าสุด</h3>
            <Button href={`/health/planting/${cycle.id}/activities`} size="sm" variant="secondary">
              ไปหน้าบันทึกกิจกรรม
            </Button>
          </div>

          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีกิจกรรมในรอบนี้</p>
          ) : (
            <div className="cluster-list">
              {activities.map((activity) => (
                <div key={activity.id} className="group-item">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="success">{formatActivityType(activity.activityType)}</Badge>
                      <Badge tone="neutral">{formatActivityScope(activity.scope)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(activity.activityDate).toLocaleString('th-TH')}</p>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{activity.note || '-'}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      </NotebookTabsContent>

      <NotebookTabsContent value="trace">
        <div className="flow-stack-lg">
          <SimpleGrid cols={2} spacing="md">
            <article className="surface-panel p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">สถานะเก็บเกี่ยวและลอต</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="group-item">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icons.Package size={12} /> จำนวน Batch</p>
                  <p className="text-base font-semibold text-foreground">{(cycle.traceSummary?.batchCount || 0).toLocaleString('th-TH')}</p>
                </div>
                <div className="group-item">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icons.Layers size={12} /> จำนวน Lot</p>
                  <p className="text-base font-semibold text-foreground">{(cycle.traceSummary?.lotCount || 0).toLocaleString('th-TH')}</p>
                </div>
                <div className="group-item sm:col-span-2">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icons.Tag size={12} /> Batch ล่าสุด</p>
                  <p className="text-base font-semibold text-foreground">{cycle.traceSummary?.latestBatch?.batchNumber || '-'}</p>
                </div>
              </div>

              {cycle.traceSummary?.latestBatch?.trackingUrl ? (
                <div className="mt-3">
                  <Button href={cycle.traceSummary.latestBatch.trackingUrl} target="_blank" rel="noreferrer" variant="outline" size="sm">
                    เปิดหน้า Trace สาธารณะ
                  </Button>
                </div>
              ) : null}
            </article>

            <article className="surface-panel p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">ตรวจความพร้อมก่อนเก็บเกี่ยว</h3>
              {harvestBlockers.length === 0 ? (
                <Alert color="green" title="พร้อมเก็บเกี่ยว">
                  สามารถสร้าง Batch/Lot แยกตามแปลงได้ทันที
                </Alert>
              ) : (
                <Alert color="yellow" title="ยังไม่พร้อมเก็บเกี่ยว">
                  <div className="space-y-1">
                    {harvestBlockers.map((item) => (
                      <p key={item} className="text-xs">• {item}</p>
                    ))}
                  </div>
                </Alert>
              )}
              <div className="mt-3">
                <Button
                  variant="filled"
                  size="sm"
                  disabled={!canHarvest}
                  onClick={openHarvestModal}
                  leftSection={<Icons.Package size={14} />}
                >
                  เปิดฟอร์มเก็บเกี่ยวและสร้างลอต
                </Button>
              </div>
            </article>
          </SimpleGrid>

          <article className="surface-panel p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">โซ่ตรวจย้อนกลับ: แปลง → รอบปลูก → รุ่นเก็บเกี่ยว → ลอต</h3>
                <p className="mt-1 text-xs text-muted-foreground">ตรวจแต่ละแปลงว่ามี QR และมีลอตที่โยงกลับถึงแปลงและรอบปลูกได้ครบก่อนส่งมอบ</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={submittingPlotQr}
                  onClick={handleGeneratePlotQrs}
                  leftSection={<Icons.QrCode size={14} />}
                >
                  สร้าง/รีเฟรช QR
                </Button>
                {loadingPlotTrace ? <Badge tone="info">กำลังโหลดข้อมูลลอต...</Badge> : null}
              </div>
            </div>

            {traceDrillDownRows.length === 0 ? (
              <Alert color="yellow" title="ยังไม่พบข้อมูลแปลงในรอบนี้">
                ไม่พบข้อมูลแปลงที่ใช้สำหรับตรวจย้อนกลับ
              </Alert>
            ) : (
              <>
                <div className="hidden lg:block">
                  <div className="overflow-hidden rounded-2xl border border-border">
                    {/* Wide content scrolls inside its own box, never the page. Measured:
                        a 7-column table made document scrollWidth 444 against a 390px
                        viewport on /health/training, so the whole page slid sideways.
                        Table.ScrollContainer already existed and was simply not used
                        here (evidence/apple-qa-audit-2026-09-07). */}
                    <Table.ScrollContainer>
                        <Table>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>แปลง</Table.Th>
                              <Table.Th>QR รายแปลง</Table.Th>
                              <Table.Th>ลอตล่าสุด</Table.Th>
                              <Table.Th>การดำเนินการ</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {traceDrillDownRows.map((row) => (
                              <Table.Tr key={`trace-row-${row.cyclePlotId}`}>
                                <Table.Td>
                                  <p className="font-semibold text-foreground">{row.plotName}</p>
                                  <p className="text-xs text-muted-foreground">{row.cultivationMethod}</p>
                                </Table.Td>
                                <Table.Td>
                                  {row.qrCode && row.qrTrackingUrl ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      <Button
                                        size="compact-xs"
                                        variant="outline"
                                        onClick={() => {
                                          if (row.qrTrackingUrl) {
                                            openQrPreview(`QR รอบปลูกนี้ — แปลง: ${row.plotName}`, row.qrTrackingUrl);
                                          }
                                        }}
                                      >
                                        เปิด QR
                                      </Button>
                                      <Button href={row.qrTrackingUrl} target="_blank" rel="noreferrer" size="compact-xs" variant="subtle">
                                        Trace แปลง
                                      </Button>
                                    </div>
                                  ) : (
                                    <Badge tone="neutral">ยังไม่สร้าง QR</Badge>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  {row.latestLots.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.latestLots.map((lot) => (
                                        <Button
                                          key={lot.id}
                                          href={lot.trackingUrl || `/trace/lot/${lot.id}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          size="compact-xs"
                                          variant="light"
                                        >
                                          {lot.lotNumber}
                                        </Button>
                                      ))}
                                    </div>
                                  ) : (
                                    <Badge tone="neutral">ยังไม่มีลอต</Badge>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.latestBatchUrl ? (
                                      <Button href={row.latestBatchUrl} target="_blank" rel="noreferrer" size="compact-xs" variant="subtle">
                                        Batch ล่าสุด
                                      </Button>
                                    ) : null}
                                  </div>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                  </div>
                </div>

                <div className="cluster-list lg:hidden">
                  {traceDrillDownRows.map((row) => (
                    <div key={`trace-mobile-${row.cyclePlotId}`} className="group-item">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{row.plotName}</p>
                        <p className="text-xs text-muted-foreground">{row.cultivationMethod}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {row.qrCode && row.qrTrackingUrl ? (
                          <Button
                            size="compact-xs"
                            variant="outline"
                            onClick={() => {
                              if (row.qrTrackingUrl) {
                                openQrPreview(`QR รอบปลูกนี้ — แปลง: ${row.plotName}`, row.qrTrackingUrl);
                              }
                            }}
                          >
                            เปิด QR
                          </Button>
                        ) : (
                          <Button size="compact-xs" variant="outline" disabled>
                            ยังไม่มี QR
                          </Button>
                        )}
                      </div>

                      {row.latestLots.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {row.latestLots.map((lot) => (
                            <Button
                              key={`mobile-${lot.id}`}
                              href={lot.trackingUrl || `/trace/lot/${lot.id}`}
                              target="_blank"
                              rel="noreferrer"
                              size="compact-xs"
                              variant="subtle"
                            >
                              {lot.lotNumber}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีลอต</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>
        </div>
      </NotebookTabsContent>

      <NotebookTabsContent value="history">
        <article className="surface-panel p-4 sm:p-5">
          <p className="mb-3 text-sm text-muted-foreground">
            บันทึกเหตุการณ์ระบบสำหรับตรวจสอบย้อนหลัง (กิจกรรมภาคสนามของรอบปลูก)
          </p>

          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลประวัติ</p>
          ) : (
            <div className="space-y-2">
              {activities.map((activity) => (
                <p key={activity.id} className="text-sm text-foreground">
                  • {new Date(activity.createdAt).toLocaleString('th-TH')} บันทึกกิจกรรม {formatActivityType(activity.activityType)}
                </p>
              ))}
            </div>
          )}
        </article>
      </NotebookTabsContent>
    </>
  );
}
