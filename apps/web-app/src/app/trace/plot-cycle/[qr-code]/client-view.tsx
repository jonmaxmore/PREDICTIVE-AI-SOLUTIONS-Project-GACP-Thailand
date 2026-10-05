'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  MapPin,
  Package,
  Printer,
  ShieldCheck,
  Sprout,
  TriangleAlert,
  ChevronRight,
  Database
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { SummaryHeader } from '@/components/feature/summary-header';
import { cn } from '@/lib/utils';
import { fetchTraceEnvelope } from '../../trace-fetch';
import { describeSignCertificate } from '../../certificate-status';
import { TraceUnavailable } from '../../trace-unavailable';

type PlotCycleTraceResponse = {
  success: boolean;
  message?: string;
  data?: {
    qrCode: string;
    requestedQrCode?: string | null;
    trackingUrl?: string | null;
    farm?: {
      name?: string | null;
      alias?: string | null;
      district?: string | null;
      province?: string | null;
    } | null;
    source?: {
      plot?: {
        plotId?: string | null;
        plotName?: string | null;
        cyclePlotId?: string | null;
      };
      cycle?: {
        cycleId?: string | null;
        cycleName?: string | null;
      };
      cultivationMethod?: string | null;
    };
    cycle?: {
      name?: string | null;
      status?: string | null;
      startDateTH?: string | null;
      expectedHarvestDateTH?: string | null;
    };
    plot?: {
      allocatedAreaSqm?: number;
      plannedPlantCount?: number;
    };
    /**
     * สถานะใบรับรองของรอบปลูกนี้ — เซิร์ฟเวอร์ส่งมาตั้งแต่แรก
     * (resolve-plot-cycle.js:620 `certificate: publicCertificateState(...)`)
     * แต่ชนิดข้อมูลตรงนี้ไม่เคยประกาศคีย์นี้ไว้ จึงไม่มีใครอ่าน และหน้าจอประกาศว่า
     * "ได้รับการรับรอง" ทุกครั้งจากข้อความคงที่แทน
     */
    certificate?: {
      status?: string | null;
      isValid?: boolean | null;
    } | null;
    traceSummary?: {
      batchCount?: number;
      lotCount?: number;
      latestBatch?: {
        id?: string | null;
        batchNumber?: string | null;
        trackingUrl?: string | null;
        lotCount?: number;
      } | null;
      latestLots?: Array<{
        id?: string | null;
        lotNumber?: string | null;
        trackingUrl?: string | null;
        qrCode?: string | null;
        batchId?: string | null;
        batchNumber?: string | null;
        createdAt?: string | null;
      }>;
    };
    links?: {
      requiresAuthentication?: boolean;
      latestBatchUrl?: string | null;
    };
    integrity?: {
      available?: boolean;
      valid?: boolean | null;
      signatureValid?: boolean | null;
      hashValid?: boolean | null;
      chainValid?: boolean | null;
      signatureAlgorithm?: string | null;
    };
  };
};

const CYCLE_STATUS_LABEL: Record<string, string> = {
  PLANNING: 'วางแผน',
  PLANTED: 'ปลูกแล้ว',
  GROWING: 'กำลังเติบโต',
  READY_HARVEST: 'พร้อมเก็บเกี่ยว',
  HARVESTED: 'เก็บเกี่ยวแล้ว',
  COMPLETED: 'ปิดรอบแล้ว',
};

const statusColors: Record<string, string> = {
  PLANNING: 'bg-zinc-100 text-zinc-600',
  PLANTED: 'bg-blue-50 text-blue-700',
  GROWING: 'bg-primary/10 text-primary',
  READY_HARVEST: 'bg-amber-50 text-amber-700',
  HARVESTED: 'bg-leaf-soft text-leaf-onSoft',
  COMPLETED: 'bg-leaf-soft text-leaf-onSoft',
};



function formatNumber(value?: number | null) {
  // ค่าที่ระบบตั้งใจไม่เปิดเผยสำหรับพืชควบคุม (จำนวนต้นตามแผน / ขนาดพื้นที่) มาถึงเป็น
  // undefined · พิมพ์เป็น "0" คือการบอกข้อเท็จจริงที่ผิด ไม่ใช่การปกปิด
  if (value === null || value === undefined) { return 'ไม่เปิดเผย'; }
  return Number(value).toLocaleString('th-TH');
}

export default function PlotCycleTracePage() {
  const params = useParams();
  const qrCode = useMemo(() => {
    const value = (params as Record<string, string | string[] | undefined>)?.['qr-code']
      ?? (params as Record<string, string | string[] | undefined>)?.qrCode
      ?? '';
    return Array.isArray(value) ? value[0] || '' : String(value || '');
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [data, setData] = useState<PlotCycleTraceResponse['data'] | null>(null);

  useEffect(() => {
    if (!qrCode) {
      setError('รหัส QR ไม่ถูกต้อง');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setUnavailable(false);
      // W1-TRACE: only a definitive backend verdict (404/410/2xx envelope)
      // may claim "not found". A transport/5xx failure (backend down) shows
      // the neutral amber unavailable state instead.
      const outcome = await fetchTraceEnvelope<PlotCycleTraceResponse>(`/api/trace/plot-cycle/${encodeURIComponent(qrCode)}`);
      if (cancelled) return;
      if (outcome.kind === 'unavailable') {
        setUnavailable(true);
      } else if (outcome.kind === 'ok' && outcome.payload.data) {
        setData(outcome.payload.data);
      } else {
        setError(
          (outcome.kind === 'not-found' && outcome.message) ||
          'ไม่พบข้อมูล Trace สำหรับรหัสนี้'
        );
      }
      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [qrCode]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="animate-pulse text-sm font-medium text-muted-foreground">กำลังตรวจสอบห่วงโซ่ข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (unavailable) {
    return <TraceUnavailable retryHref={`/trace/plot-cycle/${encodeURIComponent(qrCode)}`} code={qrCode} />;
  }

  if (!data || error) {
    // Definitive backend verdict only — transport failures never reach here.
    return (
      <div className="min-h-screen bg-background px-4 py-20">
        <Card className="mx-auto max-w-md rounded-[2rem] border-none shadow-xl">
          <CardContent className="p-10 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-500">
              <TriangleAlert size={40} />
            </div>
            <h2 className="mb-2 text-xl font-bold text-foreground">ไม่พบข้อมูล Trace</h2>
            <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
              ขออภัย รหัสที่ตรวจสอบไม่พบในระบบ หรืออาจเป็นรหัสที่ล้าสมัย กรุณาตรวจสอบอีกครั้ง
            </p>
            <Button asChild className="h-12 w-full rounded-xl font-bold">
              <Link href="/">กลับหน้าหลัก</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cycleStatus = String(data.cycle?.status || '').toUpperCase();
  const cycleStatusLabel = CYCLE_STATUS_LABEL[cycleStatus] || data.cycle?.status || 'กำลังดำเนินการ';


  const latestLots = data.traceSummary?.latestLots || [];
  // สถานะใบรับรองที่ประตูส่งมาจริง — ตัวตัดสินร่วมกับหน้าล็อต
  const cert = describeSignCertificate(data.certificate, 'แปลง');

  const summaryMetrics = [
    // R8 (design note 2026-08-20-planting-tnt-design) retired
    // per-plant tracking permanently, so this tile no longer counts PlantUnit
    // rows. It reports the plant count PLANNED for this plot in this cycle -
    // the only plant number the product still carries.
    { label: 'จำนวนต้นตามแผน', value: formatNumber(data.plot?.plannedPlantCount), icon: '🌿' },
    { label: 'ชุดเก็บเกี่ยว', value: String(data.traceSummary?.batchCount || 0), icon: '📦' },
    { label: 'ล็อตที่สร้าง', value: String(data.traceSummary?.lotCount || 0), icon: '🏷️' },
    { label: 'พื้นที่ (ตร.ม.)', value: formatNumber(data.plot?.allocatedAreaSqm), icon: '📐' },
  ];

  return (
    <div className="animate-fade-in min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-8">

        <SummaryHeader
          eyebrow="การตรวจสอบย้อนกลับสาธารณะ"
          title="รายงานตรวจสอบแปลงและรอบปลูก"
          description={`รายงานแหล่งที่มาที่ตรวจสอบแล้วของ ${data.farm?.name || 'ฟาร์ม GACP'} อำเภอ${data.farm?.district || '-'} จังหวัด${data.farm?.province || '-'} สถานะรอบปลูกปัจจุบัน: ${cycleStatusLabel}`}
          metrics={summaryMetrics}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-white/20 bg-white/10 px-4 text-white hover:bg-white/20"
              onClick={() => window.print()}
            >
              <Printer className="mr-2 h-4 w-4" /> พิมพ์ PDF
            </Button>
          }
          className="gov-gradient border-none shadow-xl"
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">

          {/* Timeline & Flow */}
          <Card className="rounded-2xl border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border/50 bg-muted/30">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Sprout className="h-4 w-4 text-primary" />
                ช่วงเวลาการปลูก
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border/50 py-2">
                  <span className="text-sm font-bold text-muted-foreground">เริ่มรอบปลูก</span>
                  <span className="text-sm font-bold">{data.cycle?.startDateTH || '-'}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border/50 py-2">
                  <span className="text-sm font-bold text-muted-foreground">คาดเก็บเกี่ยว</span>
                  <span className="text-sm font-bold">{data.cycle?.expectedHarvestDateTH || '-'}</span>
                </div>
                <div className="flex items-center justify-between border-b border-border/50 py-2">
                  <span className="text-sm font-bold text-muted-foreground">รูปแบบการปลูก</span>
                  <span className="text-sm font-bold">{data.source?.cultivationMethod || '-'}</span>
                </div>
                <div className="pt-2">
                  <Badge className={cn("rounded-full border-none px-4 py-1 text-[10px] font-bold", statusColors[cycleStatus])}>
                    {cycleStatusLabel}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Farm Details */}
          <Card className="rounded-2xl border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border/50 bg-muted/30">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <MapPin className="h-4 w-4 text-primary" />
                ข้อมูลแหล่งปลูก
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground">ชื่อฟาร์ม</p>
                <p className="text-lg font-bold text-foreground">{data.farm?.name || '-'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground">แปลงที่ปลูก</p>
                <p className="text-base font-bold text-foreground">{data.source?.plot?.plotName || '-'}</p>
              </div>
              {/* คำกล่าวอ้างเรื่องใบรับรองมาจากสถานะที่ประตูส่งมา ไม่ใช่ข้อความคงที่ ·
                  ตัวตัดสินเป็นตัวเดียวกับหน้าล็อต (F-QA-02) เพื่อให้ประตูสาธารณะทุกบาน
                  แยก "ยังไม่เคยมีใบ" ออกจาก "ใบหมดอายุ/ถูกเพิกถอน" ด้วยถ้อยคำชุดเดียวกัน */}
              <div className={cn(
                'flex items-center gap-2 rounded-xl border p-3 text-xs font-bold',
                cert.tone === 'success' && 'border-primary/10 bg-primary/5 text-primary',
                cert.tone === 'danger' && 'border-red-200 bg-red-50 text-red-800',
                cert.tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
              )}>
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>{cert.badgeLabel}</span>
              </div>
              {cert.note ? (
                <p className="text-[11px] font-medium leading-relaxed text-muted-foreground">{cert.note}</p>
              ) : null}
            </CardContent>
          </Card>

          {/* Latest Batches/Lots */}
          <Card className="rounded-2xl border-border bg-card shadow-sm md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/30">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Package className="h-4 w-4 text-primary" />
                ล็อตผลผลิตที่เชื่อมโยง
              </CardTitle>
              <Badge variant="outline" className="border-border bg-card text-[10px] font-bold">
                {latestLots.length} ล็อต
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {latestLots.length === 0 ? (
                <div className="p-12 text-center font-medium text-muted-foreground">ยังไม่พบล็อตจากแปลงนี้</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {latestLots.map((lot) => (
                    <div key={lot.id} className="group flex items-center justify-between p-4 transition-colors hover:bg-muted/30">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                          <Package size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-black uppercase tracking-tight">{lot.lotNumber}</p>
                          <p className="text-[10px] font-bold text-muted-foreground">ชุดเก็บเกี่ยว: {lot.batchNumber || '-'}</p>
                        </div>
                      </div>
                      {lot.trackingUrl && (
                        <Button asChild variant="ghost" size="sm" className="rounded-full">
                          <Link href={lot.trackingUrl} target="_blank" className="flex items-center gap-1">
                            ตรวจสอบ <ChevronRight size={14} />
                          </Link>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Integrity */}
          <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm md:col-span-2">
            <div className="flex flex-col divide-y divide-border/50 md:flex-row md:divide-x md:divide-y-0">
              <div className="flex-1 space-y-4 p-6">
                <h4 className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <Database className="h-3.5 w-3.5" /> รายละเอียดความถูกต้องของข้อมูล
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground">ลายเซ็นดิจิทัล</p>
                    <p className={cn("text-xs font-bold", data.integrity?.signatureValid ? "text-leaf-700" : "text-amber-600")}>
                      {data.integrity?.signatureValid ? "ตรวจสอบแล้ว" : "กำลังตรวจสอบ"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground">ห่วงโซ่แฮช (Hash Chain)</p>
                    <p className={cn("text-xs font-bold", data.integrity?.chainValid ? "text-leaf-700" : "text-amber-600")}>
                      {data.integrity?.chainValid ? "ปลอดภัย" : "กำลังตรวจสอบ"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center bg-primary/5 p-6 text-center md:w-1/3">
                <div className={cn(
                  "mb-3 flex h-12 w-12 items-center justify-center rounded-full shadow-lg",
                  data.integrity?.valid ? "bg-leaf-700 text-white" : "bg-amber-500 text-white"
                )}>
                  <ShieldCheck size={24} />
                </div>
                <p className="text-sm font-bold">สถานะห่วงโซ่ข้อมูล</p>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{data.integrity?.signatureAlgorithm || 'ECDSA-SHA256'}</p>
              </div>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
