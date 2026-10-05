'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { Icons } from '@/components/ui/icons';
import { Button } from '@/components/ui/primitives/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/primitives/select';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/primitives/badge';
import { Card } from '@/components/ui/primitives/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { SummaryHeader } from '@/components/feature';
import { notifications } from '@/lib/notifications';
import { lotStatusLabel } from '@/lib/planting-labels';

interface Lot {
    id: string;
    batchId?: string;
    lotNumber: string;
    packageType: string;
    quantity: number;
    unitWeight: number;
    totalWeight: number;
    status: string;
    packagedAt: string;
    expiryDate: string;
    qrCode: string;
    trackingUrl: string;
    testStatus: string;
    thcContent: number;
    cbdContent: number;
    batch?: {
        batchNumber?: string;
        harvestDate?: string;
        farm?: {
            farmName?: string;
        };
        plant?: {
            nameTH?: string;
        };
    };
}

interface HarvestBatch {
    id: string;
    batchNumber: string;
    harvestDate: string;
    status: string;
    farm?: {
        farmName?: string;
    };
    plant?: {
        nameTH?: string;
    };
}

interface ApiResponse<T> {
    success?: boolean;
    data?: T;
    message?: string;
}

const packageTypes: Record<string, string> = {
    BAG_1KG: 'ถุง 1 กก.',
    BAG_500G: 'ถุง 500 กรัม',
    BOX_5KG: 'กล่อง 5 กก.',
    BOTTLE_100ML: 'ขวด 100 ml',
    BOTTLE_500ML: 'ขวด 500 ml',
};

const POLL_MAX_ATTEMPTS = 30;
const POLL_DELAY_MS = 2000;

function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export default function LotsPage() {
    const searchParams = useSearchParams();
    const batchIdFromUrl = String(searchParams.get('batchId') || '').trim();

    const [lots, setLots] = useState<Lot[]>([]);
    const [lotsError, setLotsError] = useState<string | null>(null);
    const [batches, setBatches] = useState<HarvestBatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [qrDataUrl, setQrDataUrl] = useState<string>('');
    const [selectedBatchId, setSelectedBatchId] = useState<string>(batchIdFromUrl);

    const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [_batchGenerationErrors, _setBatchGenerationErrors] = useState<Record<string, string>>({});

    const lotsCacheRef = useRef<Record<string, Lot[]>>({});
    const qrCacheRef = useRef<Record<string, string>>({});
    const lotsRequestRef = useRef(0);

    const fetchLots = useCallback(async (batchId: string, options?: { force?: boolean; signal?: AbortSignal }) => {
        if (!batchId) {
            setLots([]);
            setLoading(false);
            return;
        }

        const cachedRows = lotsCacheRef.current[batchId];
        if (!options?.force && Array.isArray(cachedRows)) {
            setLots(cachedRows);
            setLoading(false);
            return;
        }

        const requestId = ++lotsRequestRef.current;
        setLoading(true);

        try {
            const response = await fetch(`/api/lots/batch/${batchId}`, {
                ...(options?.signal !== undefined ? { signal: options.signal } : {}),
            });
            const payload = await response.json() as ApiResponse<Lot[]>;
            if (requestId !== lotsRequestRef.current) return;

            const rows = payload.success ? (payload.data || []) : [];
            lotsCacheRef.current[batchId] = rows;
            setLots(rows);
            setLotsError(payload.success ? null : 'ไม่สามารถโหลดข้อมูลล็อตได้ กรุณาลองใหม่อีกครั้ง');
        } catch (error) {
            if (requestId === lotsRequestRef.current) {
                console.error('Error fetching lots:', error);
                setLots([]);
                // A console line is not a message to the farmer. Without this the page
                // rendered "ยังไม่มีข้อมูลล็อต" — telling someone their harvest has no
                // lots because a fetch failed (evidence/apple-qa-audit-2026-09-07).
                setLotsError('ไม่สามารถโหลดข้อมูลล็อตได้ กรุณาลองใหม่อีกครั้ง');
            }
        } finally {
            if (requestId === lotsRequestRef.current) {
                setLoading(false);
            }
        }
    }, []);

    const fetchBatches = useCallback(async (signal?: AbortSignal) => {
        try {
            // Safety check for localStorage in Next.js
            if (typeof window === 'undefined') return;

            // Try farmId from localStorage, but don't block if missing
            const farmId = localStorage.getItem('currentFarmId') || localStorage.getItem('farmId') || '';

            const url = farmId ? `/api/harvest-batches?farmId=${farmId}` : '/api/harvest-batches';
            const response = await fetch(url, { ...(signal !== undefined ? { signal } : {}) });
            const payload = await response.json() as ApiResponse<HarvestBatch[]>;

            if (!payload.success) {
                setBatches([]);
                setLots([]);
                setLoading(false);
                return;
            }

            const rows = payload.data || [];
            setBatches(rows);

            const firstBatch = rows[0];
            if (firstBatch) {
                const initialBatchId = batchIdFromUrl && rows.some(r => r.id === batchIdFromUrl)
                    ? batchIdFromUrl
                    : firstBatch.id;
                setSelectedBatchId(initialBatchId);
            } else {
                setLots([]);
                setLoading(false);
            }
        } catch (error) {
            console.error('Error fetching batches:', error);
            setLoading(false);
        }
    }, [batchIdFromUrl]);

    useEffect(() => {
        const controller = new AbortController();
        void fetchBatches(controller.signal);
        return () => controller.abort();
    }, [fetchBatches]);

    useEffect(() => {
        if (!selectedBatchId) return;
        const controller = new AbortController();
        void fetchLots(selectedBatchId, { signal: controller.signal });
        return () => controller.abort();
    }, [fetchLots, selectedBatchId]);

    async function prepareQR(lot: Lot) {
        setSelectedLot(lot);
        const cached = qrCacheRef.current[lot.id];
        if (cached) {
            setQrDataUrl(cached);
            setIsDialogOpen(true);
            return;
        }

        try {
            const res = await fetch(`/api/lots/${lot.id}/qr/print`);
            const payload = await res.json() as ApiResponse<{ label?: { qrCodeDataUrl?: string } }>;
            if (payload.success && payload.data?.label?.qrCodeDataUrl) {
                const url = payload.data.label.qrCodeDataUrl;
                qrCacheRef.current[lot.id] = url;
                setQrDataUrl(url);
                setIsDialogOpen(true);
            }
        } catch (error) {
            console.error('Error fetching QR:', error);
        }
    }

    if (loading) {
        return (
            <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
                <Spinner className="h-8 w-8 text-leaf-600" />
                <p className="animate-pulse text-sm text-muted-foreground">กำลังโหลดข้อมูลล็อตบรรจุภัณฑ์...</p>
            </div>
        );
    }

    return (
        // Wave E.2-B (batch 7): SummaryHeader replaces the inline
        // h1+p+CTA row. Outer max-w-4xl removed — DashboardLayout
        // already provides max-w-6xl + p-4/lg:p-8 padding.
        <div className="space-y-6">
            <SummaryHeader
                eyebrow="ผู้ขอรับรอง · ติดตามผลผลิต"
                title="ล็อตบรรจุภัณฑ์"
                description="จัดการข้อมูลล็อตและพิมพ์ QR Code ติดตามผลิตภัณฑ์"
                actions={
                    <Button asChild className="bg-leaf-700 hover:bg-leaf-800">
                        <Link href="/health/planting">สร้างล็อตใหม่จากรอบการปลูก</Link>
                    </Button>
                }
            />
            <div className="flex flex-col gap-8">

                {/* Batch Selector */}
                {batches.length > 0 && (
                    <Card className="border-leaf-soft bg-leaf-soft/30">
                        <div className="flex flex-col items-center gap-4 p-4 md:flex-row">
                            <span className="text-sm font-medium text-primary-900">เลือก Batch การเก็บเกี่ยว:</span>
                            <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                                <SelectTrigger className="w-full bg-card md:w-[400px]">
                                    <SelectValue placeholder="เลือก Batch..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {batches.map((batch) => (
                                        <SelectItem key={batch.id} value={batch.id}>
                                            {batch.batchNumber} • {batch.plant?.nameTH || 'ไม่ระบุสายพันธุ์'} • {formatDate(batch.harvestDate)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* ทางเข้าเดียวของหน้าอัปโหลดผลตรวจ (COA) — หน้านั้นมีครบทั้ง
                                page/client-view/ประตูหลังบ้าน แต่ไม่เคยมีลิงก์ใดพาไป
                                (วัด 2026-09-07 — คลาสเดียวกับ work-waiting-has-a-way-in)
                                ผูกกับ batch ที่เลือก เพราะ COA เป็นของรุ่นเก็บเกี่ยว ไม่ใช่ของล็อต */}
                            {selectedBatchId ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link href={`/health/tracking/batches/${selectedBatchId}/lab-results`}>
                                        แนบผลวิเคราะห์ (COA)
                                    </Link>
                                </Button>
                            ) : null}
                        </div>
                    </Card>
                )}

                {lotsError && (
                    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {lotsError}
                        <button
                            type="button"
                            onClick={() => { void fetchLots(selectedBatchId); }}
                            className="ms-2 font-semibold underline underline-offset-2"
                        >
                            ลองใหม่
                        </button>
                    </div>
                )}

                {/* Empty State — only when the read SUCCEEDED and returned nothing. */}
                {!lotsError && lots.length === 0 && (
                    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-muted p-12 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                            <Icons.Package className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold">ยังไม่มีข้อมูลล็อต</h3>
                        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                            {selectedBatchId
                                ? 'ยังไม่ได้สร้างข้อมูลการบรรจุสำหรับ Batch นี้'
                                : 'กรุณาเลือก Batch หรือไปที่หน้าการปลูกเพื่อบันทึกการเก็บเกี่ยว'}
                        </p>
                        <Button asChild variant="outline" className="mt-6">
                            <Link href="/health/planting">ไปที่รอบการปลูก</Link>
                        </Button>
                    </div>
                )}

                {/* Lots Grid */}
                {lots.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {lots.map((lot) => (
                            <Card key={lot.id} className="overflow-hidden border-border/50 transition-all hover:border-leaf-300 hover:shadow-md">
                                <div className="p-5">
                                    <div className="mb-4 flex items-start justify-between">
                                        <div>
                                            <p className="text-sm font-bold text-leaf-700">{lot.lotNumber}</p>
                                            <p className="text-xs text-muted-foreground">{lot.batch?.plant?.nameTH || '-'}</p>
                                        </div>
                                        <Badge variant={lot.status === 'PACKAGED' ? 'default' : 'outline'} className={lot.status === 'PACKAGED' ? 'border-none bg-leaf-soft text-leaf-onSoft hover:bg-leaf-soft' : ''}>
                                            {lotStatusLabel(lot.status)}
                                        </Badge>
                                    </div>

                                    <div className="space-y-2 border-y border-muted/50 py-3">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">บรรจุภัณฑ์</span>
                                            <span className="font-medium">{packageTypes[lot.packageType] || lot.packageType}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">จำนวน/น้ำหนัก</span>
                                            <span className="font-medium">{lot.quantity} ชิ้น ({lot.totalWeight} กก.)</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">วันบรรจุ</span>
                                            <span className="font-medium">{formatDate(lot.packagedAt)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">วันหมดอายุ</span>
                                            <span className="font-bold text-red-600">{formatDate(lot.expiryDate)}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="flex-1 text-xs"
                                            /* หนึ่งล็อต หนึ่ง QR — ไม่ว่าในล็อตจะมีกี่ถุง (R8 เลิก QR
                                               รายหน่วยถาวรแล้ว) เดิมล็อตที่มีมากกว่าหนึ่งหน่วยถูกส่งไป
                                               เรียก /qr/batch-generate ซึ่งไม่เคยมีอยู่จริงในเซิร์ฟเวอร์
                                               ⇒ ล็อตจริงแทบทุกใบกดแล้วไม่ได้ QR เลย */
                                            onClick={() => prepareQR(lot)}
                                        >
                                            พิมพ์ QR Code
                                        </Button>
                                        <Button size="sm" variant="ghost" asChild className="text-xs">
                                            <Link href={lot.trackingUrl || `/trace/lot/${lot.id}`} target="_blank">
                                                Trace
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}

                {/* QR Modal */}
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>QR Code สำหรับผลิตภัณฑ์</DialogTitle>
                        </DialogHeader>
                        {selectedLot && (
                            <div className="flex flex-col items-center gap-6 py-4">
                                <div className="rounded-2xl border-2 border-dashed border-leaf-300 bg-card p-6 shadow-inner">
                                    {qrDataUrl && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={qrDataUrl} alt={`คิวอาร์โค้ดสำหรับล็อตการผลิต ${selectedLot?.lotNumber ?? ''}`} className="mx-auto h-48 w-48" />
                                    )}
                                    <div className="mt-4 text-center">
                                        <p className="text-xl font-black tracking-widest text-primary-900">{selectedLot.lotNumber}</p>
                                        <p className="text-sm font-medium">{selectedLot.batch?.plant?.nameTH || '-'}</p>
                                        <p className="text-xs text-muted-foreground">{selectedLot.batch?.farm?.farmName || '-'}</p>
                                    </div>
                                </div>
                                <div className="flex w-full gap-3">
                                    <Button variant="outline" className="flex-1" onClick={() => setIsDialogOpen(false)}>ปิด</Button>
                                    <Button className="flex-1 bg-leaf-700 hover:bg-leaf-800" onClick={() => window.print()}>
                                        พิมพ์สติกเกอร์
                                    </Button>
                                </div>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
