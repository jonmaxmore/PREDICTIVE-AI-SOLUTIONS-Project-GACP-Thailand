'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { 
  AlertCircle, 
  MapPin, 
  Package, 
  QrCode, 
  ShieldCheck, 
  Printer, 
  Award} from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { SummaryHeader } from '@/components/feature/summary-header';
import { cn } from '@/lib/utils';
import { fetchTraceEnvelope } from '../../trace-fetch';
import { TraceUnavailable } from '../../trace-unavailable';
import { describeCertificate } from '../../certificate-status';

export type LotTraceData = {
    lotId: string;
    lotNumber: string;
    batchId: string;
    batchNumber: string;
    status: string;
    farm: {
        // ไม่มี `id`: หน้าสาธารณะไม่เคยได้รับมันตั้งแต่ T12 — id ภายในเป็นมือจับสำหรับไล่เดา
        // ชนิดเดิมประกาศไว้ทั้งที่เซิร์ฟเวอร์เลิกส่งแล้ว ซึ่งทำให้คนอ่านโค้ดเข้าใจผิด
        name: string;
        district: string;
        province: string;
        // มติ 2026-09-05 เปิดสี่ช่องนี้ · เซิร์ฟเวอร์ส่งมาตั้งแต่ T12 แต่หน้านี้ไม่เคยประกาศรับ
        address?: string | null;
        subDistrict?: string | null;
        postalCode?: string | null;
        status?: string | null;
    } | null;
    harvestDate: string | null;
    harvestDateTH: string | null;
    /** ผลวิเคราะห์ของรุ่นที่ล็อตนี้มาจาก — ล็อตไม่เคยมี COA ของตัวเอง (T11) */
    labTest?: {
        lot?: {
            tested?: boolean;
            latest?: {
                fileUrl?: string | null; fileName?: string | null;
                labName?: string | null; reportNumber?: string | null;
                verificationStatus?: string | null;
            } | null;
        } | null;
    } | null;
    packaging: {
        type: string;
        unitWeight: number;
        unitCount: number;
        totalWeight: number;
    };
    qrUrl: string | null;
    /** มติ 2026-09-07 ข้อ 7 "บอก" — สี่ฟิลด์จาก toPublicPlant เท่านั้น */
    plant?: { code: string | null; nameTH: string | null; nameEN: string | null; scientificName: string | null } | null;
    /** การเรียกคืน — null เมื่อไม่ถูกเรียกคืน (เซิร์ฟเวอร์ไม่ส่ง {recalled:false}) */
    recall?: { recalled: boolean; messageTh: string } | null;
    certificate: {
        reference: string;
        issuedDate: string | null;
        issuedDateTH: string | null;
        expiryDate: string | null;
        expiryDateTH: string | null;
        isValid: boolean;
    } | null;
    // ไม่มี `source` และไม่มี `healthPlantingUnitsUrl` อีกแล้ว: มติ operator 2026-09-05 ตัด
    // ชื่อแปลง/ชื่อรอบปลูกออกจากหน้าสาธารณะ (เป็นการเรียกขานภายในของฟาร์ม ชื่อแปลงพาชื่อคนมาได้)
    // และ R8 ยกเลิกหน้าติดตามรายต้นที่ลิงก์นั้นชี้ไป · ประกาศชนิดไว้ทั้งที่เซิร์ฟเวอร์เลิกส่งแล้ว
    // ทำให้คนอ่านโค้ดเข้าใจว่ามันยังมา และหน้าจอพิมพ์ "-" ค้างไว้ตลอดกาล
    links?: {
        requiresAuthentication?: boolean;
    } | null;
    traceabilityScope: string;
};

type LotTraceResponse = {
    success: boolean;
    message?: string;
    data?: LotTraceData;
};

function formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '-';
    return parsed.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    });
}

function formatWeight(value: number | null | undefined): string {
    const numeric = Number(value || 0);
    return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`;
}

// Thai display map for raw lot-status values shown to consumers — enum/API values untouched.
const LOT_STATUS_TH: Record<string, string> = {
    'Raw Material (GACP)': 'วัตถุดิบ (GACP)',
    CREATED: 'สร้างแล้ว',
    PACKAGED: 'บรรจุแล้ว',
    COMPLETED: 'เสร็จสิ้น',
};

function lotStatusTH(status: string): string {
    return LOT_STATUS_TH[status] || status;
}

export default function PublicLotTracePage({ initialData = null }: { initialData?: LotTraceData | null }) {
    const params = useParams();
    const lotId = useMemo(() => String((params as Record<string, string | string[] | undefined>)?.['lot-id'] || (params as Record<string, string | string[] | undefined>)?.lotId || ''), [params]);

    // Server-rendered payload (page.tsx). This is the BUYER'S door — the page a
    // scanned lot QR lands on — and the repo's own memory records that the public
    // scan has two doors, of which only the generic one had been moved to the
    // server. Failure paths are untouched: null means the effect below runs
    // exactly as it always did.
    const [loading, setLoading] = useState(initialData === null);
    const [error, setError] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [data, setData] = useState<LotTraceData | null>(initialData);

    useEffect(() => {
        if (initialData !== null) return;
        if (!lotId) {
            setError('รหัสอ้างอิงล็อตไม่ถูกต้อง (Invalid lot reference)');
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function run() {
            setLoading(true);
            setError(null);
            setUnavailable(false);
            // W1-TRACE: only a definitive backend verdict (404/410/2xx
            // envelope) may claim "not found". A transport/5xx failure
            // (backend down) shows the neutral amber unavailable state.
            const outcome = await fetchTraceEnvelope<LotTraceResponse>(`/api/trace/lot/${encodeURIComponent(lotId)}`);
            if (cancelled) return;
            if (outcome.kind === 'unavailable') {
                setUnavailable(true);
            } else if (outcome.kind === 'ok' && outcome.payload.data) {
                setData(outcome.payload.data);
            } else {
                setError(
                    (outcome.kind === 'not-found' && outcome.message) ||
                    'ไม่พบข้อมูลล็อตนี้ในระบบ (Lot trace data not found)'
                );
            }
            setLoading(false);
        }

        void run();
        return () => {
            cancelled = true;
        };
    }, [lotId, initialData]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Spinner className="h-8 w-8 text-primary" />
            </div>
        );
    }

    if (unavailable) {
        return <TraceUnavailable retryHref={`/trace/lot/${encodeURIComponent(lotId)}`} code={lotId} />;
    }

    if (!data || error) {
        // Definitive backend verdict only (the backend ANSWERED not-found /
        // revoked / expired) — transport failures never reach this card.
        return (
            <div className="min-h-screen bg-background px-4 py-20">
                <Card className="mx-auto max-w-md rounded-[2rem] border-none shadow-xl">
                    <CardContent className="p-10 text-center">
                        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-500">
                            <AlertCircle size={40} />
                        </div>
                        <h2 className="mb-1 text-xl font-bold text-foreground">ไม่พบข้อมูลล็อตสินค้า</h2>
                        <p className="mb-4 text-xs font-medium text-muted-foreground">Lot trace record not found</p>
                        <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
                            {error || 'ไม่พบข้อมูลล็อตนี้ในระบบ (Lot trace data not found)'}
                        </p>
                        <Button asChild className="h-12 w-full rounded-xl font-bold">
                            <Link href="/">กลับหน้าแรก / Back to Home</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // F-QA-02: "ยังไม่เคยมีใบรับรอง" กับ "ใบรับรองหมดอายุ/ถูกเพิกถอน" เป็นคนละคำตอบ
    // ตัวตัดสินอยู่ที่ ../../certificate-status เพื่อให้ประตูสาธารณะทุกบานพูดตรงกัน
    const cert = describeCertificate(data.certificate, 'ล็อต');

    const summaryMetrics = [
        { label: 'น้ำหนัก', value: formatWeight(data.packaging.totalWeight), icon: '⚖️' },
        { label: 'จำนวนหน่วย', value: String(data.packaging.unitCount), icon: '📦' },
        { label: 'เก็บเกี่ยวเมื่อ', value: data.harvestDateTH || formatDate(data.harvestDate), icon: '🗓️' },
        { label: 'สถานะ', value: lotStatusTH(data.status), icon: '✨' },
    ];

    return (
        <div className="animate-fade-in min-h-screen bg-background px-4 py-10">
            <div className="mx-auto max-w-5xl space-y-8">
                
                <SummaryHeader
                    eyebrow="ล็อตบรรจุภัณฑ์ GACP"
                    title={`ล็อต: ${data.lotNumber}`}
                    description={`ผลผลิตจาก ${data.farm?.name || 'ฟาร์มที่ได้รับอนุญาต'} จังหวัด${data.farm?.province || '-'} ตรวจสอบย้อนกลับวัตถุดิบตามมาตรฐาน GACP`}
                    metrics={summaryMetrics}
                    actions={
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20"
                            onClick={() => window.print()}
                        >
                            <Printer className="mr-2 h-4 w-4" /> พิมพ์ฉลาก
                        </Button>
                    }
                    className="gov-gradient border-none shadow-xl"
                />

                {data.recall?.recalled ? (
                    // การเรียกคืนคือคำเตือนที่สำคัญที่สุดบนหน้านี้ — มาก่อนทุกการ์ด
                    // และพูดตรง ๆ ว่าให้ทำอะไร (งดบริโภค · ส่งคืน) ไม่ใช่เหตุผลสอบสวน
                    <div role="alert" className="rounded-2xl border-2 border-red-600 bg-red-50 p-5">
                        <p className="text-base font-bold text-red-700">ประกาศเรียกคืนสินค้า</p>
                        <p className="mt-1 text-sm leading-relaxed text-red-800">{data.recall.messageTh}</p>
                    </div>
                ) : null}

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    
                    {/* Source Information */}
                    <Card className="rounded-2xl border-border bg-card shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/30">
                            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <MapPin className="h-4 w-4 text-primary" />
                                ข้อมูลแหล่งที่มา
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6">
                            <div>
                                <p className="text-[10px] font-bold text-muted-foreground">ชื่อฟาร์ม</p>
                                <p className="text-lg font-bold text-foreground">{data.farm?.name || '-'}</p>
                                {data.plant?.nameTH ? (
                                    <p className="mt-1 text-sm font-semibold text-leaf-onSoft">
                                        พืช: {data.plant.nameTH}
                                        {data.plant.scientificName ? (
                                            <span className="ml-1 font-normal italic text-muted-foreground">({data.plant.scientificName})</span>
                                        ) : null}
                                    </p>
                                ) : null}
                                <p className="text-xs font-medium text-muted-foreground">{data.farm?.district}, {data.farm?.province}</p>
                                {/* มติ operator 2026-09-05: "ที่อยู่ติดต่อ...เมื่อสแกนต้องเห็นทั้งหมด"
                                    หลังบ้านส่งมาตั้งแต่ T12 แต่หน้านี้ไม่เคยแสดง — เจอตอนกดผ่าน
                                    เบราว์เซอร์จริง · พิกัด GPS ยังไม่เปิด และไม่เคยถูก select ออกมา */}
                                {data.farm?.address && (
                                    <p className="mt-2 text-sm text-foreground">
                                        {data.farm.address}
                                        {data.farm.subDistrict ? ` ต.${data.farm.subDistrict}` : ''}
                                        {data.farm.district ? ` อ.${data.farm.district}` : ''}
                                        {data.farm.province ? ` จ.${data.farm.province}` : ''}
                                        {data.farm.postalCode ? ` ${data.farm.postalCode}` : ''}
                                    </p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* ผลวิเคราะห์ — มติ 2026-09-05: เอกสารต้องเปิดดูได้จริงจากหน้าสแกน
                        ก่อนหน้านี้หน้านี้ไม่มีการ์ดนี้เลย ทั้งที่ API ส่ง labTest มาแล้ว */}
                    {data.labTest?.lot && (
                        <Card className="rounded-2xl border-border bg-card shadow-sm">
                            <CardHeader className="border-b border-border/50 bg-muted/30">
                                <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
                                    ผลวิเคราะห์ (COA)
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 p-6">
                                {data.labTest.lot.tested
                                    ? (
                                        <>
                                            <p className="text-sm font-semibold text-foreground">
                                                มีผลตรวจแล้ว
                                                {data.labTest.lot.latest?.labName ? ` ตรวจโดย ${data.labTest.lot.latest.labName}` : ''}
                                            </p>
                                            {data.labTest.lot.latest?.fileUrl && (
                                                <a
                                                    href={data.labTest.lot.latest.fileUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-block text-sm font-semibold text-blue-700 underline"
                                                >
                                                    เปิดผลวิเคราะห์
                                                    {data.labTest.lot.latest.reportNumber ? ` เลขที่ ${data.labTest.lot.latest.reportNumber}` : ''}
                                                </a>
                                            )}
                                            {data.labTest.lot.latest?.verificationStatus === 'FARMER_UPLOADED' && (
                                                <p className="text-xs text-muted-foreground">
                                                    เอกสารนี้เกษตรกรเป็นผู้แนบ ยังไม่ได้ผ่านการตรวจสอบโดยเจ้าหน้าที่
                                                </p>
                                            )}
                                        </>
                                    )
                                    : (
                                        // "ยังไม่ได้ตรวจ" คือคำตอบ ไม่ใช่ความว่าง — ผู้ซื้อต้องแยกออกจาก "ระบบไม่รู้"
                                        <p className="text-sm text-muted-foreground">ยังไม่มีผลตรวจสำหรับรุ่นนี้</p>
                                    )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Packaging Information */}
                    <Card className="rounded-2xl border-border bg-card shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/30">
                            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <Package className="h-4 w-4 text-primary" />
                                ข้อมูลการบรรจุ
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="grid grid-cols-2 gap-y-4">
                                <div>
                                    <p className="text-[10px] font-bold text-muted-foreground">ประเภทบรรจุภัณฑ์</p>
                                    <p className="text-sm font-bold text-foreground">{data.packaging.type}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-muted-foreground">จำนวนหน่วย</p>
                                    <p className="text-sm font-bold text-foreground">{data.packaging.unitCount} หน่วย</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-muted-foreground">น้ำหนักต่อหน่วย</p>
                                    <p className="text-sm font-bold text-foreground">{formatWeight(data.packaging.unitWeight)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-muted-foreground">น้ำหนักรวม</p>
                                    <p className="text-sm font-bold text-primary">{formatWeight(data.packaging.totalWeight)}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Certificate Status */}
                    <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm md:col-span-2">
                        <div className="flex flex-col divide-y divide-border/50 md:flex-row md:divide-x md:divide-y-0">
                            <div className="flex-1 space-y-4 p-6">
                                <h4 className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                                    <Award className="h-4 w-4 text-primary" /> การรับรองมาตรฐาน
                                </h4>
                                {/* F-QA-02: แถวเลขที่ใบ/วันหมดอายุพิมพ์เฉพาะเมื่อมีใบรับรองจริง ·
                                    "เลขที่ใบรับรอง: -" บอกผู้ซื้อว่ามีใบอยู่แต่ระบบไม่ยอมบอกเลข */}
                                {cert.hasCertificate ? (
                                    <div className="space-y-2">
                                        <p className="text-sm font-bold">เลขที่ใบรับรอง: <span className="text-foreground">{data.certificate?.reference}</span></p>
                                        <p className="text-sm font-bold">วันหมดอายุ: <span className="text-foreground">{data.certificate?.expiryDateTH || formatDate(data.certificate?.expiryDate)}</span></p>
                                    </div>
                                ) : null}
                                {cert.note ? (
                                    <p className="text-sm text-muted-foreground">{cert.note}</p>
                                ) : null}
                            </div>
                            <div className="flex flex-col items-center justify-center bg-primary/5 p-6 text-center md:w-1/3">
                                <div className={cn(
                                    "mb-3 flex h-12 w-12 items-center justify-center rounded-full shadow-lg",
                                    cert.tone === 'success' && "bg-leaf-700 text-white",
                                    cert.tone === 'danger' && "bg-red-500 text-white",
                                    cert.tone === 'neutral' && "bg-muted text-muted-foreground",
                                )}>
                                    <ShieldCheck size={24} />
                                </div>
                                <p className="text-sm font-bold">สถานะการรับรอง</p>
                                {/* Status-only claim (cert ACTIVE + not expired). This lot surface
                                    carries no cryptographic QR verification, so we deliberately do
                                    NOT assert "Authentic / verified" — only the certificate status.
                                    F-QA-02: และ "ไม่เคยมีใบ" ต้องไม่ถูกอ่านว่า "ใบหมดอายุ" */}
                                <Badge className={cn(
                                    "mt-1 rounded-full border-none px-4 font-bold",
                                    cert.tone === 'success' && "bg-leaf-soft text-leaf-onSoft",
                                    cert.tone === 'danger' && "bg-red-100 text-red-800",
                                    cert.tone === 'neutral' && "bg-muted text-muted-foreground",
                                )}>
                                    {cert.badgeLabel}
                                </Badge>
                            </div>
                        </div>
                    </Card>

                    {/* Action Links */}
                    <div className="flex flex-col gap-4 sm:flex-row md:col-span-2">
                        <Button asChild variant="outline" className="h-12 flex-1 rounded-xl border-border font-bold">
                            <Link href={data.qrUrl || `/trace/lot/${data.lotId}`} target="_blank">
                                <QrCode className="mr-2 h-4 w-4" /> ดูหน้า QR สาธารณะ
                            </Link>
                        </Button>
                    </div>

                </div>
            </div>

            <style jsx global>{`
                @media print {
                    .gov-gradient { background: #006738 !important; color: white !important; }
                    button, .btn-friendly { display: none !important; }
                }
            `}</style>
        </div>
    );
}
