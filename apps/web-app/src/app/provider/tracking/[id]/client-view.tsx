'use client';

/**
 * ชั้นพนักงานติดตาม — รายละเอียดรอบการปลูกหนึ่งรอบ
 *
 * มติ operator 2026-09-05 (§3.3 ของ docs/design/2026-09-05-tnt-loop-and-farmer-updates.md):
 * พนักงานเปิดดูฟาร์มไหนก็ได้ทั้งประเทศ ไม่ต้องเป็นงานที่ได้รับมอบหมาย จอนี้จึงไม่มีด่าน
 * "คุณไม่ได้รับมอบหมายฟาร์มนี้" และไม่ปิดบังฟิลด์ใดที่ประตูหลังบ้านส่งมา
 *
 * เรื่องเงินไม่อยู่ในจอนี้ตามมติเดียวกัน ("คนละหน้าที่ ไม่ได้อยู่ในคำว่าติดตาม")
 * และไม่มีลิงก์ไปหน้าการเงินด้วย เพราะลิงก์ก็คือการบอกว่ามันเป็นส่วนหนึ่งของงานนี้
 *
 * สามการอ่านของจอนี้ (รายละเอียดรอบ · บันทึกกิจกรรม · QR ประจำแปลง) แยกสถานะกัน
 * ครบสามแบบ: กำลังโหลด / อ่านไม่สำเร็จ / อ่านสำเร็จแต่ไม่มีข้อมูล · การอ่านที่ล้ม
 * ห้ามวาดเป็นตารางว่าง เพราะตารางว่างแปลว่า "ไม่มี" ซึ่งเป็นคำตอบที่ระบบยังไม่รู้
 *
 * PDPA ม.39 ข้อ 3: หลังบ้านบันทึกทุกการเปิดดู (services/farm-access-audit.js) และ
 * จอนี้บอกให้พนักงานรู้ตัวด้วย <FarmAccessNotice />
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, RefreshCcw } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { FarmAccessNotice } from '@/components/feature/farm-access-notice';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { formatThaiDate } from '@/lib/format/thai-date';
import {
  ACTIVITY_TYPE_CODES,
  LOGGABLE_ACTIVITY_SCOPE_CODES,
  formatActivityScope,
  formatActivityType,
  formatCultivationMethod,
  formatCycleStatus,
} from '@/lib/planting-labels';
import {
  providerTrackingApi,
  type TrackingActivity,
  type TrackingCycleDetail,
  type TrackingPagination,
  type TrackingPlotQr,
} from '@/lib/services/provider-api';

import ProviderLayout from '../../components/provider-layout';

const ACTIVITY_PAGE_SIZE = 20;

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-56 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-6 text-sm text-muted-foreground">{children}</p>;
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-1 py-6">
      <Spinner size="sm" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function PanelError({
  title,
  message,
  onRetry,
  testId,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  testId: string;
}) {
  return (
    <Alert color="red" title={title} data-testid={testId}>
      <div className="flex flex-col items-start gap-3">
        <p>{message} ระบบยังอ่านส่วนนี้ไม่ได้ จึงยังไม่ทราบว่ามีข้อมูลอยู่หรือไม่ กรุณาลองใหม่อีกครั้ง</p>
        <Button size="sm" variant="secondary" onClick={onRetry} leftSection={<RefreshCcw className="h-4 w-4" />}>
          ลองอีกครั้ง
        </Button>
      </div>
    </Alert>
  );
}

export default function ProviderTrackingDetailView() {
  const params = useParams();
  const cycleId = String(params?.id || '');

  const [cycle, setCycle] = useState<TrackingCycleDetail | null>(null);
  const [cycleLoading, setCycleLoading] = useState(true);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [cycleToken, setCycleToken] = useState(0);

  const [plotQrs, setPlotQrs] = useState<TrackingPlotQr[]>([]);
  const [plotQrLoading, setPlotQrLoading] = useState(true);
  const [plotQrError, setPlotQrError] = useState<string | null>(null);
  const [plotQrToken, setPlotQrToken] = useState(0);

  const [activities, setActivities] = useState<TrackingActivity[]>([]);
  const [activityPagination, setActivityPagination] = useState<TrackingPagination | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityScope, setActivityScope] = useState('');
  const [activityType, setActivityType] = useState('');
  const [activityPage, setActivityPage] = useState(1);
  const [activityToken, setActivityToken] = useState(0);

  useEffect(() => {
    if (!cycleId) {
      return;
    }
    let active = true;
    const load = async () => {
      setCycleLoading(true);
      const result = await providerTrackingApi.getCycle(cycleId);
      if (!active) {
        return;
      }
      if (!result.ok) {
        setCycleError(result.error);
        setCycle(null);
      } else {
        setCycleError(null);
        setCycle(result.data);
      }
      setCycleLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [cycleId, cycleToken]);

  useEffect(() => {
    if (!cycleId) {
      return;
    }
    let active = true;
    const load = async () => {
      setPlotQrLoading(true);
      const result = await providerTrackingApi.listPlotQrs(cycleId);
      if (!active) {
        return;
      }
      if (!result.ok) {
        setPlotQrError(result.error);
        setPlotQrs([]);
      } else {
        setPlotQrError(null);
        setPlotQrs(result.data);
      }
      setPlotQrLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [cycleId, plotQrToken]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityScope, activityType]);

  useEffect(() => {
    if (!cycleId) {
      return;
    }
    let active = true;
    const load = async () => {
      setActivityLoading(true);
      const result = await providerTrackingApi.listActivities(cycleId, {
        page: activityPage,
        limit: ACTIVITY_PAGE_SIZE,
        scope: activityScope || null,
        activityType: activityType || null,
      });
      if (!active) {
        return;
      }
      if (!result.ok) {
        setActivityError(result.error);
        setActivities([]);
        setActivityPagination(null);
      } else {
        setActivityError(null);
        setActivities(result.data);
        setActivityPagination(result.pagination);
      }
      setActivityLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [cycleId, activityScope, activityType, activityPage, activityToken]);

  const retryCycle = useCallback(() => setCycleToken((token) => token + 1), []);
  const retryPlotQrs = useCallback(() => setPlotQrToken((token) => token + 1), []);
  const retryActivities = useCallback(() => setActivityToken((token) => token + 1), []);

  const cycleStatus = formatCycleStatus(cycle?.status);
  const farmLocation = [cycle?.farm?.district, cycle?.farm?.province].filter(Boolean).join(' · ');

  return (
    <ProviderLayout title="ติดตามการปลูก" subtitle="รายละเอียดรอบการปลูก">
      <div className="animate-fade-in space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold text-foreground">
              {cycle?.cycleName || 'รายละเอียดรอบการปลูก'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {cycle?.farm?.farmName || 'ยังไม่ทราบชื่อฟาร์ม'}
              {farmLocation ? ` · ${farmLocation}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cycle && <Badge tone={cycleStatus.tone}>{cycleStatus.label}</Badge>}
            <Button
              href="/provider/tracking"
              size="sm"
              variant="outline"
              leftSection={<ArrowLeft className="h-4 w-4" />}
            >
              กลับไปรายการ
            </Button>
          </div>
        </div>

        {/* PDPA ม.39 ข้อ 3 — จอรายละเอียดเปิดข้อมูลของเกษตรกรรายเดียวที่ระบุตัวได้
            การบอกว่ากำลังถูกบันทึกจึงสำคัญกว่าที่หน้ารายการเสียอีก */}
        <FarmAccessNotice />

        {cycleLoading && !cycle && !cycleError && <PanelLoading label="กำลังโหลดรายละเอียดรอบการปลูก" />}

        {cycleError && (
          <PanelError
            title="อ่านรายละเอียดรอบการปลูกไม่สำเร็จ"
            message={cycleError}
            onRetry={retryCycle}
            testId="tracking-detail-read-error"
          />
        )}

        {cycle && (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">ข้อมูลรอบปลูก</TabsTrigger>
              <TabsTrigger value="activities">บันทึกกิจกรรม</TabsTrigger>
              <TabsTrigger value="plot-qrs">QR ประจำแปลง</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="space-y-4">
                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">ข้อมูลรอบการปลูก</h3>
                  <dl>
                    <DetailRow label="ชื่อรอบปลูก" value={cycle.cycleName || '-'} />
                    <DetailRow label="สถานะ" value={cycleStatus.label} />
                    <DetailRow
                      label="ชนิดพืช"
                      value={cycle.plantSpecies?.nameTH || cycle.plantSpecies?.nameEN || '-'}
                    />
                    <DetailRow label="สายพันธุ์" value={cycle.varietyName || '-'} />
                    <DetailRow label="วันเริ่มปลูก" value={formatThaiDate(cycle.startDate)} />
                    <DetailRow label="กำหนดเก็บเกี่ยว" value={formatThaiDate(cycle.expectedHarvestDate)} />
                    <DetailRow label="วันเก็บเกี่ยวจริง" value={formatThaiDate(cycle.actualHarvestDate)} />
                    <DetailRow label="วิธีการปลูก" value={formatCultivationMethod(cycle.cultivationType)} />
                    <DetailRow label="แหล่งเมล็ดพันธุ์" value={cycle.seedSource || '-'} />
                    <DetailRow label="ประเภทดิน" value={cycle.soilType || '-'} />
                    <DetailRow label="ระบบน้ำ" value={cycle.irrigationType || '-'} />
                    <DetailRow
                      label="ผลผลิตจริง (กก.)"
                      value={
                        cycle.actualYield === null || cycle.actualYield === undefined
                          ? '-'
                          : Number(cycle.actualYield).toLocaleString('th-TH', { maximumFractionDigits: 2 })
                      }
                    />
                    <DetailRow
                      label="จำนวนบันทึกกิจกรรม"
                      value={Number(cycle._count?.cultivationLogs || 0).toLocaleString('th-TH')}
                    />
                    <DetailRow
                      label="รุ่นเก็บเกี่ยว"
                      value={Number(cycle._count?.batches || 0).toLocaleString('th-TH')}
                    />
                    <DetailRow label="ล็อตบรรจุ" value={Number(cycle._count?.lots || 0).toLocaleString('th-TH')} />
                    <DetailRow label="หมายเหตุของเกษตรกร" value={cycle.notes || '-'} />
                  </dl>
                </section>

                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">ฟาร์มเจ้าของรอบปลูก</h3>
                  <dl>
                    <DetailRow label="ชื่อฟาร์ม" value={cycle.farm?.farmName || '-'} />
                    <DetailRow label="อำเภอ" value={cycle.farm?.district || '-'} />
                    <DetailRow label="จังหวัด" value={cycle.farm?.province || '-'} />
                  </dl>
                </section>

                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">แปลงที่จัดสรรให้รอบปลูกนี้</h3>
                  {(cycle.cyclePlots || []).length === 0 ? (
                    <PanelMessage>รอบปลูกนี้ยังไม่มีแปลงที่จัดสรรไว้</PanelMessage>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>แปลง</TableHead>
                            <TableHead>วิธีการปลูก</TableHead>
                            <TableHead>พื้นที่ที่จัดสรร (ตร.ม.)</TableHead>
                            <TableHead>จำนวนต้นตามแผน</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(cycle.cyclePlots || []).map((assignment) => (
                            <TableRow key={assignment.id}>
                              <TableCell>{assignment.plot?.name || '-'}</TableCell>
                              <TableCell>{formatCultivationMethod(assignment.plot?.solarSystem)}</TableCell>
                              <TableCell className="tabular-nums">
                                {Number(assignment.allocatedAreaSqm || 0).toLocaleString('th-TH', {
                                  maximumFractionDigits: 2,
                                })}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {Number(assignment.plannedPlantCount || 0).toLocaleString('th-TH')}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>
              </div>
            </TabsContent>

            <TabsContent value="activities">
              <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    ขอบเขตของบันทึก
                    <select
                      value={activityScope}
                      onChange={(event) => setActivityScope(event.target.value)}
                      data-testid="tracking-activity-scope"
                      className="h-10 min-w-[10rem] rounded-md border border-border bg-card px-2 text-sm text-foreground"
                    >
                      <option value="">ทุกขอบเขต</option>
                      {LOGGABLE_ACTIVITY_SCOPE_CODES.map((code) => (
                        <option key={code} value={code}>
                          {formatActivityScope(code)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    ประเภทกิจกรรม
                    <select
                      value={activityType}
                      onChange={(event) => setActivityType(event.target.value)}
                      data-testid="tracking-activity-type"
                      className="h-10 min-w-[10rem] rounded-md border border-border bg-card px-2 text-sm text-foreground"
                    >
                      <option value="">ทุกประเภท</option>
                      {ACTIVITY_TYPE_CODES.map((code) => (
                        <option key={code} value={code}>
                          {formatActivityType(code)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {activityLoading && activities.length === 0 && !activityError ? (
                  <PanelLoading label="กำลังโหลดบันทึกกิจกรรม" />
                ) : activityError ? (
                  <PanelError
                    title="อ่านบันทึกกิจกรรมไม่สำเร็จ"
                    message={activityError}
                    onRetry={retryActivities}
                    testId="tracking-activities-read-error"
                  />
                ) : activities.length === 0 ? (
                  <PanelMessage>ไม่พบบันทึกกิจกรรมที่ตรงกับตัวกรองที่เลือก</PanelMessage>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>วันที่</TableHead>
                            <TableHead>ประเภท</TableHead>
                            <TableHead>ขอบเขต</TableHead>
                            <TableHead>แปลง</TableHead>
                            <TableHead>รายละเอียด</TableHead>
                            <TableHead>ผู้บันทึก</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activities.map((activity) => (
                            <TableRow key={activity.id}>
                              <TableCell>{formatThaiDate(activity.logDate)}</TableCell>
                              <TableCell>{formatActivityType(activity.logType)}</TableCell>
                              <TableCell>{formatActivityScope(activity.scope)}</TableCell>
                              <TableCell>{activity.plot?.name || '-'}</TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="text-sm text-foreground">{activity.productName || '-'}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {[
                                      activity.quantity !== null && activity.quantity !== undefined
                                        ? `ปริมาณ ${Number(activity.quantity).toLocaleString('th-TH')} ${activity.unit || ''}`.trim()
                                        : null,
                                      activity.method ? `วิธี ${activity.method}` : null,
                                      activity.notes || null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ') || 'ไม่มีรายละเอียดเพิ่มเติม'}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {activity.recordedBy || '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {activityPagination && activityPagination.totalPages > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          หน้า {activityPagination.page.toLocaleString('th-TH')} จาก{' '}
                          {activityPagination.totalPages.toLocaleString('th-TH')} · ทั้งหมด{' '}
                          {activityPagination.total.toLocaleString('th-TH')} บันทึก
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={activityLoading || activityPagination.page <= 1}
                            onClick={() => setActivityPage((current) => Math.max(1, current - 1))}
                          >
                            ก่อนหน้า
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={activityLoading || activityPagination.page >= activityPagination.totalPages}
                            onClick={() => setActivityPage((current) => current + 1)}
                          >
                            ถัดไป
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </TabsContent>

            <TabsContent value="plot-qrs">
              <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">
                  รหัสแปลงเป็นรหัสถาวรของพื้นที่ ส่วนรหัส QR ของรอบปลูกเป็นผนึกประจำฤดูกาลนี้
                  ทั้งสองค่าอยู่คนละบรรทัดเพราะเป็นคนละสิ่ง
                </p>
                {plotQrLoading && plotQrs.length === 0 && !plotQrError ? (
                  <PanelLoading label="กำลังโหลด QR ประจำแปลง" />
                ) : plotQrError ? (
                  <PanelError
                    title="อ่าน QR ประจำแปลงไม่สำเร็จ"
                    message={plotQrError}
                    onRetry={retryPlotQrs}
                    testId="tracking-plot-qrs-read-error"
                  />
                ) : plotQrs.length === 0 ? (
                  <PanelMessage>รอบปลูกนี้ยังไม่มีแปลงที่ออก QR ไว้</PanelMessage>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>แปลง</TableHead>
                          <TableHead>รหัสแปลง (ถาวร)</TableHead>
                          <TableHead>รหัส QR รอบปลูกนี้</TableHead>
                          <TableHead>วิธีการปลูก</TableHead>
                          <TableHead>พื้นที่ (ตร.ม.)</TableHead>
                          <TableHead>จำนวนต้นตามแผน</TableHead>
                          <TableHead>หน้าตรวจสอบสาธารณะ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plotQrs.map((row) => (
                          <TableRow key={row.cyclePlotId}>
                            <TableCell>{row.plotName || '-'}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-xs text-foreground">{row.plotCode || 'ยังไม่มีรหัสถาวร'}</span>
                                {row.qrRevokedAt ? (
                                  <span className="text-xs text-muted-foreground">
                                    ยกเลิกป้ายเมื่อ {formatThaiDate(row.qrRevokedAt)}
                                  </span>
                                ) : row.qrIssuedAt ? (
                                  <span className="text-xs text-muted-foreground">
                                    ออกป้ายเมื่อ {formatThaiDate(row.qrIssuedAt)}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{row.seasonalQrCode || row.qrCode || '-'}</TableCell>
                            <TableCell>{formatCultivationMethod(row.cultivationMethod)}</TableCell>
                            <TableCell className="tabular-nums">
                              {Number(row.allocatedAreaSqm || 0).toLocaleString('th-TH', {
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {Number(row.plannedPlantCount || 0).toLocaleString('th-TH')}
                            </TableCell>
                            <TableCell>
                              {row.trackingUrl ? (
                                <Button
                                  href={row.trackingUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  size="compact-sm"
                                  variant="ghost"
                                >
                                  เปิดหน้าสาธารณะ
                                </Button>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ProviderLayout>
  );
}
