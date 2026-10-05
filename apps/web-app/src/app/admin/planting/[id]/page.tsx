'use client';


import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/primitives/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/primitives/tabs';
import { FarmAccessNotice } from '@/components/feature';
import { apiClient } from '@/lib/api/api-client';
import { formatThaiDate } from '@/lib/format/thai-date';

// Thai display labels for raw cycle-status enum values (display-only map,
// mirrors error-code-map/workflow-states pattern; enum values unchanged).
const STATUS_LABEL: Record<string, string> = {
  PLANNING: 'วางแผน',
  PLANTED: 'ปลูกแล้ว',
  GROWING: 'กำลังเติบโต',
  READY_HARVEST: 'พร้อมเก็บเกี่ยว',
  HARVESTED: 'เก็บเกี่ยวแล้ว',
  COMPLETED: 'เสร็จสิ้น',
};
type AdminCycleDetail = {
  id: string;
  cycleName: string;
  status: string;
  startDate: string | null;
  expectedHarvestDate: string | null;
  farm?: {
    id: string;
    farmName?: string | null;
    ownerId?: string | null;
    district?: string | null;
    province?: string | null;
  } | null;
  _count?: {
    batches?: number;
    cultivationLogs?: number;
  };
  // No `plantUnits` count and no `integrity` object. R8 of
  // design note 2026-08-20-planting-tnt-design retired per-plant
  // tracking on 2026-08-25, and routes/api/admin/planting.js stopped producing
  // both with the PlantUnit reads that computed them. Declaring optional fields
  // the server can never send would keep the dead branches below compiling and
  // invite someone to "restore" the data behind them.
};

type AdminPlotQr = {
  cyclePlotId: string;
  plotName: string | null;
  cultivationMethod: string;
  allocatedAreaSqm: number;
  plannedPlantCount: number;
  qrCode: string | null;
  trackingUrl: string | null;
};

// adminRequest removed — use apiClient instead (canonical cookie-based auth)

export default function AdminPlantingDetailPage() {
  const params = useParams();
  const cycleId = String(params?.id || '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<AdminCycleDetail | null>(null);
  const [plotQrs, setPlotQrs] = useState<AdminPlotQr[]>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      const [cycleRes, qrsRes] = await Promise.all([
        apiClient.get<AdminCycleDetail>(`/admin/planting-cycles/${encodeURIComponent(cycleId)}`),
        apiClient.get<AdminPlotQr[]>(`/admin/planting-cycles/${encodeURIComponent(cycleId)}/plot-qrs`),
      ]);

      if (!mounted) {
        return;
      }

      if (!cycleRes.success || !cycleRes.data) {
        setError(cycleRes.error || 'ไม่สามารถโหลดข้อมูลรอบการปลูกได้');
        setCycle(null);
        setPlotQrs([]);
      } else {
        setCycle(cycleRes.data);
        setPlotQrs(qrsRes.success && Array.isArray(qrsRes.data) ? qrsRes.data : []);
      }

      setLoading(false);
    }

    if (cycleId) {
      load();
    }

    return () => {
      mounted = false;
    };
  }, [cycleId]);

  return (
    <div className="flex flex-col gap-5">
      {/* T5 / PDPA ม.39 — this page opens one named farmer's records; say so. */}
      <FarmAccessNotice />

      <div className="rounded-lg bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold text-slate-900">{cycle?.cycleName || 'รายละเอียดรอบการปลูก'}</h2>
            <p className="text-sm text-slate-500">
              {cycle?.farm?.farmName || '-'} · เจ้าของ {cycle?.farm?.ownerId || '-'}
            </p>
          </div>
          <div className="flex flex-wrap items-center">
            <Badge color="blue" >{STATUS_LABEL[String(cycle?.status || '').toUpperCase()] || cycle?.status || '-'}</Badge>
            <Button href="/admin/planting" variant="default" size="sm">ย้อนกลับ</Button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-wrap items-center py-6">
          <Spinner size="sm" />
          <p className="text-sm text-slate-500">กำลังโหลดรายละเอียด...</p>
        </div>
      )}

      {error && (
        <Alert color="red" title="โหลดข้อมูลไม่สำเร็จ">
          {error}
        </Alert>
      )}

      {!loading && cycle && (
        <div className="flex flex-col gap-4">
          {/*
            An integrity Alert stood here reading integrity.traceabilityReady and
            reporting "เกินแผน X · ยังไม่จัดสรร Y". Both numbers counted PlantUnit
            rows against the cycle's declared plan, which spec R8 retired on
            2026-08-25 — with nothing minting those rows the warning has no input
            to warn about. It is deleted rather than pinned to zero: once the
            backend stopped sending `integrity`, the falsy check fired on EVERY
            cycle and showed every admin a red "ต้องทบทวนข้อมูลตรวจสอบย้อนกลับ ·
            เกินแผน 0 · ยังไม่จัดสรร 0" for a condition that cannot occur.
          */}
          <Tabs defaultValue="trace">
            <TabsList>
              <TabsTrigger value="trace">QR ประจำแปลง</TabsTrigger>
              <TabsTrigger value="summary">สรุป</TabsTrigger>
            </TabsList>

            <TabsContent value="trace">
              <div className="rounded-lg bg-card p-4 shadow-sm">
                {plotQrs.length === 0 ? (
                  <p className="text-sm text-slate-500">ไม่พบ QR ระดับแปลง</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>แปลง</TableHead>
                        <TableHead>วิธีการปลูก</TableHead>
                        <TableHead>พื้นที่ (ตร.ม.)</TableHead>
                        <TableHead>จำนวนต้นตามแผน</TableHead>
                        <TableHead>รหัส QR</TableHead>
                        <TableHead>หน้าตรวจสอบสาธารณะ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plotQrs.map((row) => (
                        <TableRow key={row.cyclePlotId}>
                          <TableCell>{row.plotName || '-'}</TableCell>
                          <TableCell>{row.cultivationMethod || '-'}</TableCell>
                          <TableCell>{Number(row.allocatedAreaSqm || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</TableCell>
                          <TableCell>{Number(row.plannedPlantCount || 0).toLocaleString('en-US')}</TableCell>
                          <TableCell><p className="text-xs">{row.qrCode || '-'}</p></TableCell>
                          <TableCell>
                            {row.trackingUrl ? (
                              <Button href={row.trackingUrl} target="_blank" rel="noreferrer" size="compact-xs" variant="ghost">เปิด</Button>
                            ) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            <TabsContent value="summary">
              <div className="rounded-lg bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  <p>สถานะรอบปลูก: <span className="font-bold">{STATUS_LABEL[String(cycle.status || '').toUpperCase()] || cycle.status || '-'}</span></p>
                  <p>วันเริ่มปลูก: <span className="font-bold">{formatThaiDate(cycle.startDate)}</span></p>
                  <p>กำหนดเก็บเกี่ยว: <span className="font-bold">{formatThaiDate(cycle.expectedHarvestDate)}</span></p>
                  <p>ชุดเก็บเกี่ยว: <span className="font-bold">{Number(cycle._count?.batches || 0).toLocaleString('th-TH')}</span></p>
                  <p>กิจกรรม: <span className="font-bold">{Number(cycle._count?.cultivationLogs || 0).toLocaleString('th-TH')}</span></p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
