'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    AlertCircle,
    MapPin,
    Package,
    ShieldCheck,
    Printer,
    ChevronLeft,
    Calendar,
    ExternalLink,
    RefreshCcw
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/primitives/table';
import { SummaryHeader } from '@/components/feature/summary-header';
import { fetchTraceEnvelope } from '../../trace-fetch';
import { TraceUnavailable } from '../../trace-unavailable';
import { describeCertificate } from '../../certificate-status';

type PackagingLot = {
    lotId: string;
    lotNumber: string;
    packagingType: string;
    unitWeight: number;
    unitCount: number;
    totalWeight: number;
    qrUrl: string | null;
};

type BatchTraceData = {
    batchId: string;
    batchNumber: string;
    status: string;
    farm: {
        // ไม่มี `id`: ประตูสาธารณะเลิกส่งคีย์ภายในตั้งแต่ T12 — ประกาศค้างไว้ทำให้คนอ่านโค้ด
        // เข้าใจว่ามันยังมา และเชิญให้มีคนหยิบไปใช้
        name: string;
        district: string;
        province: string;
        // มติ operator 2026-09-05 เปิดที่อยู่เมื่อสแกน · เซิร์ฟเวอร์ส่งมาแล้วตั้งแต่ 2026-09-06
        address?: string | null;
        subDistrict?: string | null;
        postalCode?: string | null;
    } | null;
    /** ผลวิเคราะห์ของ "รุ่นนี้" — ห้องปฏิบัติการตรวจรุ่น เอกสารจึงเป็นของสิ่งที่ถูกสแกนโดยตรง */
    labTest?: {
        batch?: {
            tested?: boolean;
            latest?: {
                fileUrl?: string | null; fileName?: string | null;
                labName?: string | null; reportNumber?: string | null;
                verificationStatus?: string | null;
            } | null;
        } | null;
    } | null;
    harvestDate: string | null;
    harvestDateTH: string | null;
    totalHarvestWeight: number;
    totalPackagedWeight: number;
    packagingLots: PackagingLot[];
    certificate: {
        reference: string;
        issuedDate: string | null;
        issuedDateTH: string | null;
        expiryDate: string | null;
        expiryDateTH: string | null;
        isValid: boolean;
    } | null;
    traceabilityScope: string;
};

type BatchTraceResponse = {
    success: boolean;
    message?: string;
    data?: BatchTraceData;
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

// Thai display map for raw batch-status values shown to consumers — enum/API values untouched.
const BATCH_STATUS_TH: Record<string, string> = {
    'Raw Material (GACP)': 'วัตถุดิบ (GACP)',
    CREATED: 'สร้างแล้ว',
    HARVESTED: 'เก็บเกี่ยวแล้ว',
    PACKAGED: 'บรรจุแล้ว',
    COMPLETED: 'เสร็จสิ้น',
};

function batchStatusTH(status: string): string {
    return BATCH_STATUS_TH[status] || status;
}

function formatWeight(value: number | null | undefined): string {
    const numeric = Number(value || 0);
    return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`;
}

export default function PublicBatchTracePage() {
    const params = useParams();
    const _router = useRouter();
    const batchId = useMemo(() => String((params as Record<string, string | string[] | undefined>)?.['qr-code'] || (params as Record<string, string | string[] | undefined>)?.qrCode || ''), [params]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [data, setData] = useState<BatchTraceData | null>(null);

    const fetchTrace = async (cancelled = false) => {
        if (!batchId) {
            setError('รหัสอ้างอิงชุดเก็บเกี่ยวไม่ถูกต้อง (Invalid batch reference)');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        setUnavailable(false);
        // W1-TRACE: only a definitive backend verdict (404/410/2xx envelope)
        // may claim "not found". A transport/5xx failure (backend down) shows
        // the neutral amber unavailable state instead.
        const outcome = await fetchTraceEnvelope<BatchTraceResponse>(`/api/trace/batch/${encodeURIComponent(batchId)}`);
        if (cancelled) return;
        if (outcome.kind === 'unavailable') {
            setUnavailable(true);
        } else if (outcome.kind === 'ok' && outcome.payload.data) {
            setData(outcome.payload.data);
        } else {
            setError(
                (outcome.kind === 'not-found' && outcome.message) ||
                'ไม่พบข้อมูลชุดเก็บเกี่ยวนี้ในระบบ (Batch trace data not found)'
            );
        }
        setLoading(false);
    };

    useEffect(() => {
        let cancelled = false;
        void fetchTrace(cancelled);
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batchId]);

    const metrics = useMemo(() => {
        if (!data) return [];
        return [
            { label: 'เก็บเกี่ยว', value: formatWeight(data.totalHarvestWeight), icon: '🚜' },
            { label: 'บรรจุแล้ว', value: formatWeight(data.totalPackagedWeight), icon: '📦' },
            { label: 'ล็อต', value: String(data.packagingLots.length), icon: '🏷️' },
            { label: 'รับรองแล้ว', value: data.certificate?.isValid ? 'ใช่' : 'ไม่', icon: '🛡️' },
        ];
    }, [data]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background p-6">
                <div className="flex flex-col items-center gap-4">
                    <RefreshCcw className="h-10 w-10 animate-spin text-primary/30" />
                    <p className="text-sm font-bold text-muted-foreground">กำลังตรวจสอบข้อมูล...</p>
                </div>
            </div>
        );
    }

    if (unavailable) {
        return <TraceUnavailable retryHref={`/trace/batch/${encodeURIComponent(batchId)}`} code={batchId} />;
    }

    if (!data || error) {
        // Definitive backend verdict only (the backend ANSWERED not-found /
        // revoked / expired) — transport failures never reach this card.
        return (
            <div className="flex min-h-screen items-center justify-center bg-background p-6">
                <Card className="w-full max-w-md overflow-hidden rounded-2xl border-destructive/20 shadow-xl">
                    <div className="space-y-4 bg-destructive/5 p-8 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                            <AlertCircle className="h-8 w-8" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-foreground">ไม่พบข้อมูลการตรวจสอบย้อนกลับ</h2>
                            <p className="mt-1 text-xs font-medium text-muted-foreground">Trace record not found</p>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">
                            {error || 'ไม่พบข้อมูลชุดเก็บเกี่ยวนี้ในระบบ (Batch trace data not found)'}
                        </p>
                        <Button asChild variant="outline" className="w-full rounded-xl font-bold">
                            <Link href="/trace">ค้นหาใหม่ / New Search</Link>
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    // F-QA-02: ประตูสาธารณะบานเดียวกับหน้าล็อต และเคยพูดผิดแบบเดียวกัน —
    // "ไม่มีใบรับรอง" ถูกพิมพ์เป็น "หมดอายุหรือไม่มีผล"
    const cert = describeCertificate(data.certificate, 'รุ่น');

    return (
        <div className="min-h-screen bg-background px-4 py-8 md:py-12">
            <div className="animate-fade-in mx-auto max-w-5xl space-y-8">

                <SummaryHeader
                    eyebrow="การตรวจสอบสาธารณะ"
                    title={`ตรวจสอบชุดเก็บเกี่ยว: ${data.batchNumber}`}
                    description="ผลการตรวจสอบชุดเก็บเกี่ยวตามมาตรฐาน GACP ติดตามวัตถุดิบตั้งแต่การปลูกจนถึงการบรรจุ เพื่อความโปร่งใสตลอดห่วงโซ่อุปทาน"
                    metrics={metrics}
                    actions={
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="trace-print-hide rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => window.print()}>
                                <Printer className="mr-2 h-4 w-4" /> พิมพ์
                            </Button>
                            <Button asChild size="sm" className="trace-print-hide rounded-xl bg-card text-primary hover:bg-white/90">
                                <Link href="/trace">
                                    <ChevronLeft className="mr-2 h-4 w-4" /> หน้าหลักตรวจสอบย้อนกลับ
                                </Link>
                            </Button>
                        </div>
                    }
                    className="gov-gradient border-none shadow-xl shadow-primary/20"
                />

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">

                    {/* Basic Info */}
                    <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                                <Calendar className="h-4 w-4 text-primary" /> ลำดับเวลา
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6">
                            <div className="space-y-4">
                                <TraceInfoRow label="วันที่เก็บเกี่ยว" value={data.harvestDateTH || formatDate(data.harvestDate)} />
                                <TraceInfoRow label="สถานะชุดเก็บเกี่ยว" value={batchStatusTH(data.status)} isBadge tone="info" />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Origin Info */}
                    <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                                <MapPin className="h-4 w-4 text-primary" /> ข้อมูลแหล่งที่มา
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6">
                            <div className="space-y-1">
                                <p className="text-xl font-bold text-foreground">{data.farm?.name || '-'}</p>
                                <p className="text-xs font-medium text-muted-foreground">
                                    {data.farm ? `${data.farm.district}, ${data.farm.province}` : 'ไม่ระบุที่ตั้ง'}
                                </p>
                                {data.farm?.address && (
                                    <p className="pt-1 text-sm text-foreground">
                                        {data.farm.address}
                                        {data.farm.subDistrict ? ` ต.${data.farm.subDistrict}` : ''}
                                        {data.farm.district ? ` อ.${data.farm.district}` : ''}
                                        {data.farm.province ? ` จ.${data.farm.province}` : ''}
                                        {data.farm.postalCode ? ` ${data.farm.postalCode}` : ''}
                                    </p>
                                )}
                            </div>
                            {/* Origin certified-area badge — gated on the certification
                                STATUS (data.certificate.isValid). Never asserted when the
                                cert is null/invalid, otherwise an uncertified or
                                revoked/expired batch would falsely read "GACP Certified". */}
                            <div className="pt-2">
                                {cert.state === 'VALID' && (
                                    <Badge tone="primary" className="rounded-lg text-[10px] font-bold">พื้นที่ได้รับการรับรอง GACP</Badge>
                                )}
                                {cert.state === 'NONE' && (
                                    <Badge tone="neutral" className="rounded-lg text-[10px] font-bold">ยังไม่ได้รับการรับรอง GACP</Badge>
                                )}
                                {cert.state === 'LAPSED' && (
                                    <Badge tone="danger" className="rounded-lg text-[10px] font-bold">ใบรับรองหมดอายุหรือถูกเพิกถอน</Badge>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* ผลวิเคราะห์ของรุ่น — สิ่งที่ถูกสแกนคือรุ่น เอกสารจึงเป็นของมันโดยตรง
                        ไม่ได้สืบทอดมาเหมือนหน้าล็อต */}
                    {data.labTest?.batch && (
                        <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
                            <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                                <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                                    <ShieldCheck className="h-4 w-4 text-primary" /> ผลวิเคราะห์ (COA)
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 p-6 text-sm">
                                {data.labTest.batch.tested ? (
                                    <>
                                        <p className="font-bold text-foreground">
                                            มีผลตรวจแล้ว
                                            {data.labTest.batch.latest?.labName ? ` ตรวจโดย ${data.labTest.batch.latest.labName}` : ''}
                                        </p>
                                        {data.labTest.batch.latest?.fileUrl && (
                                            <Link
                                                href={data.labTest.batch.latest.fileUrl}
                                                target="_blank"
                                                className="inline-flex items-center gap-1 font-bold text-primary underline"
                                            >
                                                <ExternalLink className="h-4 w-4" /> เปิดผลวิเคราะห์
                                                {data.labTest.batch.latest.reportNumber ? ` เลขที่ ${data.labTest.batch.latest.reportNumber}` : ''}
                                            </Link>
                                        )}
                                        {data.labTest.batch.latest?.verificationStatus === 'FARMER_UPLOADED' && (
                                            <p className="text-xs text-muted-foreground">
                                                เอกสารนี้เกษตรกรเป็นผู้แนบ ยังไม่ได้ผ่านการตรวจสอบโดยเจ้าหน้าที่
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <p className="font-bold text-foreground">ยังไม่มีผลตรวจ Lab</p>
                                        <p className="text-xs text-muted-foreground">
                                            ผู้รับซื้อขอเอกสารฉบับเต็มจากเกษตรกรได้โดยตรง
                                        </p>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Cert Info */}
                    <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
                            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                                <ShieldCheck className="h-4 w-4 text-primary" /> การรับรองมาตรฐาน
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6">
                            {/* F-QA-02: แถวเลขที่ใบ/วันหมดอายุมีอยู่ก็ต่อเมื่อมีใบรับรองจริง —
                                "รอดำเนินการ" กับ "-" อ่านได้ว่าระบบถือใบอยู่แต่ไม่ยอมบอก */}
                            {cert.hasCertificate && (
                                <>
                                    <TraceInfoRow label="เลขที่ใบรับรอง" value={data.certificate?.reference || ''} />
                                    <TraceInfoRow label="วันหมดอายุ" value={data.certificate?.expiryDateTH || formatDate(data.certificate?.expiryDate)} />
                                </>
                            )}
                            {cert.note && (
                                <p className="text-xs leading-relaxed text-muted-foreground">{cert.note}</p>
                            )}
                            <div className="pt-2">
                                {/* Status-only claim: this batch surface carries no cryptographic
                                    QR verification, so we assert ACTIVE/expiry only — never a
                                    crypto "Authentic" claim that nothing here backs. */}
                                <Badge tone={cert.tone} className="w-full justify-center rounded-lg py-1.5 text-[10px] font-bold">
                                    {cert.badgeLabel}
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="overflow-hidden rounded-2xl border-border bg-card shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-muted/30 px-6 py-4">
                        <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                            <Package className="h-4 w-4 text-primary" /> รายการบรรจุภัณฑ์
                        </CardTitle>
                        <Badge tone="neutral" className="rounded-lg text-[10px] font-bold">สร้างแล้ว {data.packagingLots.length} ล็อต</Badge>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            {/* Wide content scrolls inside its own box, never the page. Measured:
                                a 7-column table made document scrollWidth 444 against a 390px
                                viewport on /health/training, so the whole page slid sideways.
                                Table.ScrollContainer already existed and was simply not used
                                here (evidence/apple-qa-audit-2026-09-07). */}
                            <Table.ScrollContainer>
                                <Table>
                                    {/* light header: explicit text color — the primitive's default
                                        text-primary-foreground (white) must not survive on bg-muted/10 */}
                                    <TableHeader className="bg-muted/10 text-muted-foreground">
                                        <TableRow>
                                            <TableHead className="pl-6">เลขที่ล็อต</TableHead>
                                            <TableHead>ประเภท</TableHead>
                                            <TableHead>จำนวนหน่วย</TableHead>
                                            <TableHead>น้ำหนักรวม</TableHead>
                                            <TableHead className="pr-6 text-right">การตรวจสอบ</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.packagingLots.map((lot) => (
                                            <TableRow key={lot.lotId} className="transition-colors hover:bg-muted/30">
                                                <TableCell className="py-4 pl-6 text-sm font-black">{lot.lotNumber}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="rounded-lg border-primary/20 bg-primary/5 text-[10px] font-black uppercase text-primary">
                                                        {lot.packagingType}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-bold">{lot.unitCount} หน่วย</TableCell>
                                                <TableCell className="font-bold">{formatWeight(lot.totalWeight)}</TableCell>
                                                <TableCell className="pr-6 text-right">
                                                    <Button asChild size="sm" variant="ghost" className="h-8 rounded-xl text-primary hover:bg-primary/10">
                                                        <Link href={lot.qrUrl || `/trace/lot/${lot.lotId}`}>
                                                            <ExternalLink className="mr-2 h-3.5 w-3.5" /> ดูล็อต
                                                        </Link>
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Table.ScrollContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <style jsx global>{`
                @media print {
                    .trace-print-hide { display: none !important; }
                    body { background: white !important; }
                    .max-w-5xl { max-width: 100% !important; margin: 0 !important; }
                    .rounded-2xl { border-radius: 0 !important; border: 1px solid #eee !important; }
                    .gov-gradient { background: #004d2a !important; color: white !important; -webkit-print-color-adjust: exact; }
                }
            `}</style>
        </div>
    );
}

function TraceInfoRow({ label, value, isBadge, tone }: { label: string; value: string; isBadge?: boolean; tone?: 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'primary' }) {
    return (
        <div className="flex items-center justify-between border-b border-border/20 py-1.5 last:border-0">
            <span className="text-[10px] font-bold text-muted-foreground">{label}</span>
            {isBadge ? (
                <Badge tone={tone} className="rounded-lg text-[10px] font-bold">{value}</Badge>
            ) : (
                <span className="text-sm font-bold text-foreground">{value}</span>
            )}
        </div>
    );
}
